/**
 * Чистая логика MyMOC: сборка списка и вставка его в текст заметки.
 * Ни одной зависимости от Obsidian — поэтому покрывается обычным тестом.
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
}

/** Запись о содержимом папки — то, что обвязка вычитывает из vault. */
export interface Entry {
	/** Путь от корня vault: `03_RESOURCES/SERVER/API.md` или `03_RESOURCES/SERVER/Terminal` */
	path: string;
	/** Имя с расширением: `API.md`, `Схема.canvas`, `Terminal` */
	name: string;
	isFolder: boolean;
	/** Для папок: путь к MOC-файлу внутри неё, если он там найден. */
	mocPath?: string;
}

export const DEFAULT_SETTINGS: Settings = {
	marker: 'MOC',
	icons: { note: '📄', canvas: '🎨', folder: '🗂️' },
	descending: false,
};

const stripExtension = (path: string): string => path.replace(/\.md$/, '');

/** `Заметка.md` → `Заметка`, `Схема.canvas` → `Схема`, `Terminal` → `Terminal` */
const displayName = (name: string): string => name.replace(/\.(md|canvas)$/, '');

const link = (target: string, label: string): string => `[[${target}|${label}]]`;

/**
 * Собирает строки оглавления для содержимого одной папки.
 * Отбрасывает вложения и сам MOC-файл, сортирует папки перед файлами.
 */
export function buildIndex(entries: Entry[], selfPath: string, settings: Settings): string[] {
	const keep = entries.filter((e) => {
		if (e.path === selfPath) return false;
		if (e.isFolder) return true;
		return e.name.endsWith('.md') || e.name.endsWith('.canvas');
	});

	const direction = settings.descending ? -1 : 1;
	keep.sort((a, b) => {
		if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1; // папки всегда сверху
		return direction * displayName(a.name).localeCompare(displayName(b.name));
	});

	return keep.map((e) => {
		const label = displayName(e.name);
		if (e.isFolder) {
			// Obsidian не умеет ссылаться на каталог — без MOC внутри остаётся простой строкой.
			return e.mocPath
				? `${settings.icons.folder} ${link(stripExtension(e.mocPath), label)}`
				: `${settings.icons.folder} ${label}`;
		}
		const icon = e.name.endsWith('.canvas') ? settings.icons.canvas : settings.icons.note;
		return `${icon} ${link(stripExtension(e.path), label)}`;
	});
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const startMarker = (marker: string): string => `%% ${marker}:start %%`;
export const endMarker = (marker: string): string => `%% ${marker}:end %%`;

/** Есть ли в тексте маркер — голый `%% MOC %%` или уже развёрнутый блок. */
export function hasMarker(content: string, marker: string): boolean {
	const m = escapeRegExp(marker);
	return new RegExp(`%%\\s*${m}\\s*%%`).test(content)
		|| new RegExp(`%%\\s*${m}:start\\s*%%`).test(content);
}

/**
 * Вставляет список в текст заметки, не трогая ничего вокруг блока.
 * Голый маркер разворачивается в пару ограничителей; уже развёрнутый блок обновляется.
 * Возвращает null, если менять нечего — так обвязка не пишет файл впустую
 * и не зацикливается на собственных изменениях.
 */
export function applyMocBlock(content: string, lines: string[], marker: string): string | null {
	const m = escapeRegExp(marker);
	const block = [startMarker(marker), ...lines, endMarker(marker)].join('\n');

	const expanded = new RegExp(
		`%%\\s*${m}:start\\s*%%[\\s\\S]*?%%\\s*${m}:end\\s*%%`,
	);
	if (expanded.test(content)) {
		const updated = content.replace(expanded, block);
		return updated === content ? null : updated;
	}

	// Голый маркер: разворачиваем первое вхождение, остальные оставляем как есть.
	const bare = new RegExp(`%%\\s*${m}\\s*%%`);
	if (bare.test(content)) return content.replace(bare, block);

	return null;
}
