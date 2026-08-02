/**
 * Pure MyMOC logic: building the list and inserting it into note text.
 * No dependency on Obsidian, so it is covered by plain unit tests.
 */

export interface Icons {
	note: string;
	canvas: string;
	folder: string;
}

export interface Settings {
	marker: string;
	icons: Icons;
	descending: boolean;
	/** Prefix for files created by the recursive marker. */
	createdPrefix: string;
}

/** One item of folder contents, as read from the vault by the wiring layer. */
export interface Entry {
	/** Path from the vault root: `Projects/Notes/API.md` or `Projects/Notes/Archive` */
	path: string;
	/** Name with extension: `API.md`, `Diagram.canvas`, `Archive` */
	name: string;
	isFolder: boolean;
	/** For folders: path to the index note inside it, when one exists. */
	mocPath?: string;
}

export const DEFAULT_SETTINGS: Settings = {
	marker: 'MOC',
	icons: { note: '📄', canvas: '🎨', folder: '🗂️' },
	descending: false,
	createdPrefix: '-',
};

/** A subfolder as seen by the recursive planner. */
export interface FolderNode {
	/** Path from the vault root: `Projects/Notes/Archive` */
	path: string;
	name: string;
	/** Holds notes, canvases or subfolders — empty folders get no index. */
	hasContent: boolean;
	/** Already contains a note carrying the marker. */
	hasMoc: boolean;
	/** A file with the target name already exists, whatever its contents. */
	nameTaken: boolean;
}

export interface PlannedMoc {
	/** Full path of the file to create. */
	path: string;
	/** Folder it indexes, used for the display name. */
	folderPath: string;
}

const stripExtension = (path: string): string => path.replace(/\.md$/, '');

/** `Note.md` -> `Note`, `Diagram.canvas` -> `Diagram`, `Archive` -> `Archive` */
const displayName = (name: string): string => name.replace(/\.(md|canvas)$/, '');

const link = (target: string, label: string): string => `[[${target}|${label}]]`;

/**
 * Builds the table-of-contents lines for the contents of a single folder.
 * Drops attachments and the index note itself; folders sort before files.
 */
export function buildIndex(entries: Entry[], selfPath: string, settings: Settings): string[] {
	const keep = entries.filter((e) => {
		if (e.path === selfPath) return false;
		if (e.isFolder) return true;
		return e.name.endsWith('.md') || e.name.endsWith('.canvas');
	});

	const direction = settings.descending ? -1 : 1;
	keep.sort((a, b) => {
		if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1; // folders always on top
		return direction * displayName(a.name).localeCompare(displayName(b.name));
	});

	return keep.map((e) => {
		const label = displayName(e.name);
		if (e.isFolder) {
			// Obsidian cannot link to a directory — without an index inside it stays plain text.
			return e.mocPath
				? `${settings.icons.folder} ${link(stripExtension(e.mocPath), label)}`
				: `${settings.icons.folder} ${label}`;
		}
		const icon = e.name.endsWith('.canvas') ? settings.icons.canvas : settings.icons.note;
		return `${icon} ${link(stripExtension(e.path), label)}`;
	});
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Blanks out fenced and inline code, preserving length so that match indices
 * still point into the original text.
 *
 * Without this, a note that merely *mentions* the marker — documentation about
 * this plugin, a changelog entry — would be treated as an index and rewritten
 * mid-sentence. Wrapping the marker in backticks is the natural way to write
 * about it, so that has to be the way to opt out.
 */
export function maskCode(content: string): string {
	const blank = (m: string) => m.replace(/[^\n]/g, ' ');
	return content
		.replace(/^([`~]{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank) // ``` fenced ```
		.replace(/`[^`\n]+`/g, blank); // `inline`
}

export const startMarker = (marker: string): string => `%% ${marker}:start %%`;
export const endMarker = (marker: string): string => `%% ${marker}:end %%`;

/**
 * Whether the text carries a marker: bare `%% MOC %%`, recursive `%% +MOC %%`,
 * or an expanded block. Markers inside code spans and fences do not count.
 */
export function hasMarker(content: string, marker: string): boolean {
	const masked = maskCode(content);
	const m = escapeRegExp(marker);
	return new RegExp(`%%\\s*\\+?${m}\\s*%%`).test(masked)
		|| new RegExp(`%%\\s*${m}:start\\s*%%`).test(masked);
}

/**
 * Whether the text asks for a one-off recursive pass: `%% +MOC %%`.
 *
 * The plus goes in front deliberately. Obsidian closes `%%` as you type, so the
 * word is typed inside an existing pair: a trailing plus would mean passing
 * through `%% MOC %%` first, and the plain marker would fire and collapse the
 * line before the plus could be typed.
 */
export function hasRecursiveMarker(content: string, marker: string): boolean {
	return new RegExp(`%%\\s*\\+${escapeRegExp(marker)}\\s*%%`).test(maskCode(content));
}

/**
 * Decides which index files the recursive marker should create.
 *
 * Pure: takes a description of the subtree, returns a list of files. Every skip
 * rule lives here rather than in the traversal, so the awkward cases — a folder
 * that already has an index, a name already taken by an unrelated note — are
 * covered by ordinary tests.
 */
export function planMocCreation(folders: FolderNode[], prefix: string): PlannedMoc[] {
	return folders
		.filter((f) => f.hasContent && !f.hasMoc && !f.nameTaken)
		.map((f) => ({
			path: `${f.path}/${prefix}${f.name}.md`,
			folderPath: f.path,
		}));
}

/**
 * Inserts the list into note text without touching anything around the block.
 * A bare marker expands into a delimiter pair; an existing block is updated.
 * Returns null when there is nothing to change, so the caller never writes
 * needlessly and cannot loop on its own edits.
 */
export function applyMocBlock(content: string, lines: string[], marker: string): string | null {
	// Searching happens in the masked copy so markers inside code are invisible,
	// while the replacement is spliced into the original by index.
	const masked = maskCode(content);
	const m = escapeRegExp(marker);
	const block = [startMarker(marker), ...lines, endMarker(marker)].join('\n');

	const splice = (at: number, length: number) =>
		content.slice(0, at) + block + content.slice(at + length);

	const expanded = new RegExp(
		`%%\\s*${m}:start\\s*%%[\\s\\S]*?%%\\s*${m}:end\\s*%%`,
	).exec(masked);
	if (expanded) {
		const updated = splice(expanded.index, expanded[0].length);
		return updated === content ? null : updated;
	}

	// Bare marker: expand the first occurrence only, leave any others as they are.
	// `\+?` also consumes the recursive form, so %% +MOC %% collapses into a plain
	// block once its one-off pass is done and never fires again.
	const bare = new RegExp(`%%\\s*\\+?${m}\\s*%%`).exec(masked);
	if (bare) return splice(bare.index, bare[0].length);

	return null;
}
