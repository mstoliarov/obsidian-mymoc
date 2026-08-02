import {
	App,
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	debounce,
} from 'obsidian';
import {
	Entry,
	FolderNode,
	Settings,
	DEFAULT_SETTINGS,
	buildIndex,
	applyMocBlock,
	hasMarker,
	hasRecursiveMarker,
	planMocCreation,
	startMarker,
	endMarker,
} from './buildIndex';

export default class MyMocPlugin extends Plugin {
	settings!: Settings; // assigned in onload before any use

	/**
	 * Folders awaiting a rebuild. File-sync tools deliver files in bursts,
	 * so events are collected and processed in one pass.
	 */
	private pending = new Set<string>();
	/**
	 * The recursive pass is async and runs for seconds on a large tree. Without
	 * this guard a second pass starts while the first is mid-flight, computes its
	 * plan from state the first has not written yet, and calls create() on paths
	 * that already exist.
	 */
	private recursing = false;
	private flush = debounce(() => void this.processPending(), 400, true);

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MyMocSettingTab(this.app, this));

		this.addCommand({
			id: 'update-moc',
			name: 'Update table of contents in this note',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (!checking) void this.updateMocFile(file);
				return true;
			},
		});

		// Subscribe once the layout is ready: on startup Obsidian fires `create`
		// for every file in the vault, which would rewrite everything at once.
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on('create', (f) => this.queueParentOf(f.path)),
			);
			this.registerEvent(
				this.app.vault.on('delete', (f) => this.queueParentOf(f.path)),
			);
			this.registerEvent(
				this.app.vault.on('rename', (f, oldPath) => {
					this.queueParentOf(f.path);
					this.queueParentOf(oldPath);
				}),
			);
			this.registerEvent(
				this.app.workspace.on('file-open', (file) => {
					if (file && file.extension === 'md') void this.updateMocFile(file);
				}),
			);
			// A marker typed into an open note fires neither `create` nor `file-open`,
			// and `modify` only arrives after autosave — hence the former delay.
			this.registerEvent(
				this.app.workspace.on('editor-change', (editor, info) =>
					this.editorChanged(editor, info),
				),
			);
		});
	}

	private queueParentOf(path: string) {
		const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/';
		this.pending.add(parent);
		this.flush();
	}

	private async processPending() {
		const folders = [...this.pending];
		this.pending.clear();
		for (const path of folders) {
			const folder = this.app.vault.getAbstractFileByPath(path === '/' ? '' : path);
			if (folder instanceof TFolder) await this.updateFolder(folder);
			else if (path === '/') await this.updateFolder(this.app.vault.getRoot());
		}
	}

	/** Updates every index note living in this folder. */
	private async updateFolder(folder: TFolder) {
		const mocFiles: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md') {
				const content = await this.app.vault.cachedRead(child);
				if (hasMarker(content, this.settings.marker)) mocFiles.push(child);
			}
		}
		if (mocFiles.length === 0) return;

		const entries = await this.collectEntries(folder);
		for (const moc of mocFiles) await this.rewrite(moc, entries);
	}

	private editorChanged(editor: Editor, info: MarkdownView | MarkdownFileInfo) {
		const file = info.file;
		if (file) this.queueEditor(editor, file);
	}

	/**
	 * Edits go through the editor rather than vault.modify: the file on disk still
	 * holds the previous version, so writing there would discard unsaved text.
	 */
	private queueEditor = debounce(
		(editor: Editor, file: TFile) => void this.updateInEditor(editor, file),
		250, // reading a single folder is cheaper than the batched vault-event rebuild
	);

	private async updateInEditor(editor: Editor, file: TFile) {
		const content = editor.getValue();
		if (!hasMarker(content, this.settings.marker)) return;
		if (hasRecursiveMarker(content, this.settings.marker)) await this.recursiveThenReport(file);

		const parent = file.parent ?? this.app.vault.getRoot();
		const lines = buildIndex(await this.collectEntries(parent), file.path, this.settings);
		const updated = applyMocBlock(content, lines, this.settings.marker);
		// null means the list is unchanged — ordinary typing never reaches past here,
		// so the cursor is left alone.
		if (updated === null) return;

		const cursor = editor.getCursor();
		editor.setValue(updated);
		editor.setCursor(cursor);

		this.queueParentOf(parent.path);
	}

	/** Updates one specific note, if it carries a marker. */
	private async updateMocFile(file: TFile) {
		const content = await this.app.vault.cachedRead(file);
		if (!hasMarker(content, this.settings.marker)) return;
		if (hasRecursiveMarker(content, this.settings.marker)) await this.recursiveThenReport(file);
		const parent = file.parent ?? this.app.vault.getRoot();
		await this.rewrite(file, await this.collectEntries(parent));

		// In the parent's index this folder shows as plain text until it has an index
		// of its own. Adding a marker is a `modify`, which we do not subscribe to,
		// so the folder one level up is queued explicitly.
		this.queueParentOf(parent.path);
	}

	/** Runs the recursive pass and tells the user what happened. */
	private async recursiveThenReport(file: TFile) {
		if (this.recursing) return;
		this.recursing = true;
		try {
			const { created, skipped, failed } = await this.runRecursivePass(file);
			const parts = [];
			if (created > 0) parts.push(`created ${created}`);
			if (skipped > 0) parts.push(`skipped ${skipped}`);
			if (failed > 0) parts.push(`failed ${failed}`);
			new Notice(
				parts.length > 0
					? `MyMOC: ${parts.join(', ')}`
					: 'MyMOC: nothing to create — subfolders already have indexes or are empty',
			);
		} finally {
			this.recursing = false;
		}
	}

	/**
	 * One-off pass for `%% MOC+ %%`: creates an index in every subfolder below
	 * the note. Deepest folders go first, so by the time a parent index is built
	 * its children already have indexes to link to.
	 */
	private async runRecursivePass(
		file: TFile,
	): Promise<{ created: number; skipped: number; failed: number }> {
		const parent = file.parent ?? this.app.vault.getRoot();
		const nodes: FolderNode[] = [];

		const walk = async (folder: TFolder): Promise<void> => {
			for (const child of folder.children) {
				if (!(child instanceof TFolder)) continue;
				const targetName = `${this.settings.createdPrefix}${child.name}.md`;
				nodes.push({
					path: child.path,
					name: child.name,
					hasContent: child.children.some(
						(c) =>
							c instanceof TFolder ||
							(c instanceof TFile && (c.extension === 'md' || c.extension === 'canvas')),
					),
					hasMoc: (await this.findMocIn(child)) !== null,
					nameTaken: child.children.some((c) => c.name === targetName),
				});
				await walk(child);
			}
		};
		await walk(parent);

		const plan = planMocCreation(nodes, this.settings.createdPrefix);
		let created = 0;
		let failed = 0;
		for (const item of [...plan].reverse()) {
			const folder = this.app.vault.getAbstractFileByPath(item.folderPath);
			if (!(folder instanceof TFolder)) continue;
			const lines = buildIndex(
				await this.collectEntries(folder),
				item.path,
				this.settings,
			);
			const body = [
				startMarker(this.settings.marker),
				...lines,
				endMarker(this.settings.marker),
				'',
			].join('\n');
			// One unwritable path must not abort the rest of the pass, and the
			// marker has to collapse afterwards either way — otherwise the same
			// failure repeats on every subsequent event.
			try {
				await this.app.vault.create(item.path, body);
				created++;
			} catch {
				failed++;
			}
		}
		return { created, skipped: nodes.length - plan.length, failed };
	}

	private async collectEntries(folder: TFolder): Promise<Entry[]> {
		const entries: Entry[] = [];
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				entries.push({
					path: child.path,
					name: child.name,
					isFolder: true,
					mocPath: (await this.findMocIn(child))?.path,
				});
			} else if (child instanceof TFile) {
				entries.push({ path: child.path, name: child.name, isFolder: false });
			}
		}
		return entries;
	}

	/** First marked note alphabetically, so the choice is predictable. */
	private async findMocIn(folder: TFolder): Promise<TFile | null> {
		const notes = folder.children
			.filter((c): c is TFile => c instanceof TFile && c.extension === 'md')
			.sort((a, b) => a.name.localeCompare(b.name));
		for (const note of notes) {
			const content = await this.app.vault.cachedRead(note);
			if (hasMarker(content, this.settings.marker)) return note;
		}
		return null;
	}

	private async rewrite(moc: TFile, entries: Entry[]) {
		const content = await this.app.vault.read(moc);
		const lines = buildIndex(entries, moc.path, this.settings);
		const updated = applyMocBlock(content, lines, this.settings.marker);
		if (updated !== null) await this.app.vault.modify(moc, updated);
	}

	async loadSettings() {
		const stored = await this.loadData();
		this.settings = {
			...DEFAULT_SETTINGS,
			...stored,
			icons: { ...DEFAULT_SETTINGS.icons, ...(stored?.icons ?? {}) },
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class MyMocSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: MyMocPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		// Настройки кладутся в собственный div, а не прямо в containerEl:
		// у контейнера вкладки отступы задаёт тема, и правило из styles.css
		// с ними конфликтует по специфичности. Отступ ставится здесь же,
		// а не только в таблице стилей, — так он не зависит от того,
		// подхватился ли styles.css при установке.
		const root = containerEl.createDiv({ cls: 'mymoc-settings' });

		new Setting(root)
			.setName('Marker word')
			.setDesc(
				'The plugin only updates notes containing %% WORD %%. ' +
					'File name and folder do not matter.',
			)
			.addText((text) =>
				text
					.setPlaceholder('MOC')
					.setValue(this.plugin.settings.marker)
					.onChange(async (value) => {
						this.plugin.settings.marker = value.trim() || 'MOC';
						await this.plugin.saveSettings();
					}),
			);

		const icons: Array<[keyof Settings['icons'], string]> = [
			['note', 'Note icon'],
			['canvas', 'Canvas icon'],
			['folder', 'Folder icon'],
		];
		for (const [key, label] of icons) {
			new Setting(root).setName(label).addText((text) =>
				text.setValue(this.plugin.settings.icons[key]).onChange(async (value) => {
					this.plugin.settings.icons[key] = value;
					await this.plugin.saveSettings();
				}),
			);
		}

		new Setting(root)
			.setName('Prefix for created notes')
			.setDesc(
				'Used by the %% MOC+ %% marker when it creates indexes in subfolders. ' +
					'A leading dash keeps them together at the top of the file list.',
			)
			.addText((text) =>
				text
					.setPlaceholder('-')
					.setValue(this.plugin.settings.createdPrefix)
					.onChange(async (value) => {
						this.plugin.settings.createdPrefix = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(root)
			.setName('Reverse order')
			.setDesc('Sorts Z to A instead of A to Z. Folders always stay on top.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.descending).onChange(async (value) => {
					this.plugin.settings.descending = value;
					await this.plugin.saveSettings();
				}),
			);

		// Отступ ставится внутри каждой строки настройки, а не вокруг колонки:
		// прижат к краям именно текст внутри блоков. Через style, а не styles.css,
		// чтобы не зависеть от того, доехала ли таблица стилей при установке.
		root.querySelectorAll('.setting-item').forEach((el) => {
			const item = el as HTMLElement;
			item.style.paddingLeft = '10px';
			item.style.paddingRight = '10px';
		});

		const version = root.createEl('p', {
			text: `MyMOC v${this.plugin.manifest.version}`,
		});
		version.style.paddingLeft = '10px';
		version.style.opacity = '0.5';
		version.style.fontSize = 'var(--font-ui-smaller)';
	}
}
