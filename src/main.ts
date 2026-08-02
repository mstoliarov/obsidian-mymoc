import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	TFolder,
	debounce,
} from 'obsidian';
import {
	Entry,
	Settings,
	DEFAULT_SETTINGS,
	buildIndex,
	applyMocBlock,
	hasMarker,
} from './buildIndex';

export default class MyMocPlugin extends Plugin {
	settings!: Settings; // присваивается в onload до любого использования

	/**
	 * Папки, ожидающие пересборки. Syncthing приносит файлы пачками,
	 * поэтому события копятся и обрабатываются одним заходом.
	 */
	private pending = new Set<string>();
	private flush = debounce(() => void this.processPending(), 400, true);

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MyMocSettingTab(this.app, this));

		this.addCommand({
			id: 'update-moc',
			name: 'Обновить MOC в этой заметке',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (!checking) void this.updateMocFile(file);
				return true;
			},
		});

		// Подписка после готовности layout: иначе Obsidian при старте
		// выдаёт `create` на каждый файл vault и плагин перепишет всё подряд.
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

	/** Обновляет все MOC-файлы, лежащие в этой папке. */
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

	/** Обновляет один конкретный файл, если в нём есть маркер. */
	private async updateMocFile(file: TFile) {
		const content = await this.app.vault.cachedRead(file);
		if (!hasMarker(content, this.settings.marker)) return;
		const parent = file.parent ?? this.app.vault.getRoot();
		await this.rewrite(file, await this.collectEntries(parent));
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

	/** Первый по алфавиту файл с маркером — чтобы выбор был предсказуемым. */
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

		new Setting(containerEl)
			.setName('Слово маркера')
			.setDesc(
				'Плагин обновляет только заметки, содержащие %% СЛОВО %%. ' +
					'Имя файла и папка значения не имеют.',
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
			['note', 'Значок заметки'],
			['canvas', 'Значок canvas'],
			['folder', 'Значок папки'],
		];
		for (const [key, label] of icons) {
			new Setting(containerEl).setName(label).addText((text) =>
				text.setValue(this.plugin.settings.icons[key]).onChange(async (value) => {
					this.plugin.settings.icons[key] = value;
					await this.plugin.saveSettings();
				}),
			);
		}

		new Setting(containerEl)
			.setName('Обратный порядок')
			.setDesc('По умолчанию А→Я. Папки в любом случае остаются сверху.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.descending).onChange(async (value) => {
					this.plugin.settings.descending = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
