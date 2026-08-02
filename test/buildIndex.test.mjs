import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildIndex,
	applyMocBlock,
	hasMarker,
	hasRecursiveMarker,
	planMocCreation,
	maskCode,
	DEFAULT_SETTINGS,
} from '../build/buildIndex.mjs';

const S = DEFAULT_SETTINGS;
const file = (path, name) => ({ path, name, isFolder: false });
const folder = (path, name, mocPath) => ({ path, name, isFolder: true, mocPath });

test('папки идут перед файлами, внутри групп — по алфавиту', () => {
	const entries = [
		file('F/Яблоко.md', 'Яблоко.md'),
		folder('F/Зета', 'Зета'),
		file('F/Апельсин.md', 'Апельсин.md'),
		folder('F/Альфа', 'Альфа'),
	];
	assert.deepEqual(buildIndex(entries, 'F/-F.md', S), [
		'🗂️ Альфа',
		'🗂️ Зета',
		'📄 [[F/Апельсин|Апельсин]]',
		'📄 [[F/Яблоко|Яблоко]]',
	]);
});

test('кириллица сортируется по алфавиту, а не по кодам символов', () => {
	const entries = [file('F/ёж.md', 'ёж.md'), file('F/Ананас.md', 'Ананас.md')];
	const out = buildIndex(entries, 'F/-F.md', S);
	assert.match(out[0], /Ананас/);
	assert.match(out[1], /ёж/);
});

test('вложения отбрасываются, canvas остаётся со своим значком', () => {
	const entries = [
		file('F/скрин.png', 'скрин.png'),
		file('F/док.pdf', 'док.pdf'),
		file('F/Схема.canvas', 'Схема.canvas'),
		file('F/Заметка.md', 'Заметка.md'),
	];
	assert.deepEqual(buildIndex(entries, 'F/-F.md', S), [
		'📄 [[F/Заметка|Заметка]]',
		'🎨 [[F/Схема.canvas|Схема]]',
	]);
});

test('сам MOC-файл не попадает в свой список', () => {
	const entries = [file('F/Оглавление.md', 'Оглавление.md'), file('F/Другая.md', 'Другая.md')];
	assert.deepEqual(buildIndex(entries, 'F/Оглавление.md', S), ['📄 [[F/Другая|Другая]]']);
});

test('подпапка с MOC даёт ссылку, без MOC — простую строку', () => {
	const entries = [
		folder('F/С индексом', 'С индексом', 'F/С индексом/Оглавление.md'),
		folder('F/Без индекса', 'Без индекса'),
	];
	assert.deepEqual(buildIndex(entries, 'F/-F.md', S), [
		'🗂️ Без индекса',
		'🗂️ [[F/С индексом/Оглавление|С индексом]]',
	]);
});

test('пустая папка даёт пустой список', () => {
	assert.deepEqual(buildIndex([], 'F/-F.md', S), []);
});

test('обратная сортировка переворачивает порядок, но папки остаются сверху', () => {
	const entries = [
		file('F/А.md', 'А.md'),
		file('F/Б.md', 'Б.md'),
		folder('F/Папка', 'Папка'),
	];
	const out = buildIndex(entries, 'F/-F.md', { ...S, descending: true });
	assert.deepEqual(out, ['🗂️ Папка', '📄 [[F/Б|Б]]', '📄 [[F/А|А]]']);
});

test('голый маркер разворачивается в блок', () => {
	const content = '# Заголовок\n\n%% MOC %%\n\nхвост';
	const out = applyMocBlock(content, ['📄 [[F/А|А]]'], 'MOC');
	assert.equal(
		out,
		'# Заголовок\n\n%% MOC:start %%\n📄 [[F/А|А]]\n%% MOC:end %%\n\nхвост',
	);
});

test('обновление блока не трогает текст вокруг', () => {
	const content = 'мой текст\n%% MOC:start %%\nстарое\n%% MOC:end %%\nподпись';
	const out = applyMocBlock(content, ['новое'], 'MOC');
	assert.equal(out, 'мой текст\n%% MOC:start %%\nновое\n%% MOC:end %%\nподпись');
});

test('без изменений возвращается null — файл не переписывается', () => {
	const content = 'x\n%% MOC:start %%\n📄 [[F/А|А]]\n%% MOC:end %%\ny';
	assert.equal(applyMocBlock(content, ['📄 [[F/А|А]]'], 'MOC'), null);
});

test('файл без маркера не трогается', () => {
	assert.equal(applyMocBlock('просто заметка', ['что-то'], 'MOC'), null);
	assert.equal(hasMarker('просто заметка', 'MOC'), false);
});

test('маркер распознаётся и голым, и развёрнутым', () => {
	assert.equal(hasMarker('a %% MOC %% b', 'MOC'), true);
	assert.equal(hasMarker('a %% MOC:start %% b', 'MOC'), true);
	assert.equal(hasMarker('a %% ОГЛАВЛЕНИЕ %% b', 'ОГЛАВЛЕНИЕ'), true);
});

test('пустой список сохраняет ограничители', () => {
	const out = applyMocBlock('%% MOC %%', [], 'MOC');
	assert.equal(out, '%% MOC:start %%\n%% MOC:end %%');
});

test('второй маркер в файле остаётся нетронутым', () => {
	const content = '%% MOC %%\nсередина\n%% MOC %%';
	const out = applyMocBlock(content, ['x'], 'MOC');
	assert.equal(out, '%% MOC:start %%\nx\n%% MOC:end %%\nсередина\n%% MOC %%');
});

test('маркер в inline-коде не срабатывает', () => {
	const content = 'Пишу про плагин: `%% MOC %%` — вот такой маркер.';
	assert.equal(hasMarker(content, 'MOC'), false);
	assert.equal(applyMocBlock(content, ['x'], 'MOC'), null);
});

test('маркер в блоке кода не срабатывает', () => {
	const content = '# Док\n\n```\n%% MOC %%\n```\n\nконец';
	assert.equal(hasMarker(content, 'MOC'), false);
	assert.equal(applyMocBlock(content, ['x'], 'MOC'), null);
});

test('настоящий маркер после кодового блока всё равно срабатывает', () => {
	const content = '```\n%% MOC %%\n```\n\n%% MOC %%';
	assert.equal(hasMarker(content, 'MOC'), true);
	const out = applyMocBlock(content, ['📄 [[F/А|А]]'], 'MOC');
	assert.equal(out, '```\n%% MOC %%\n```\n\n%% MOC:start %%\n📄 [[F/А|А]]\n%% MOC:end %%');
});

test('развёрнутый блок обновляется, даже если выше есть пример в коде', () => {
	const content = 'Пример: `%% MOC:start %%`\n\n%% MOC:start %%\nстарое\n%% MOC:end %%';
	const out = applyMocBlock(content, ['новое'], 'MOC');
	assert.equal(out, 'Пример: `%% MOC:start %%`\n\n%% MOC:start %%\nновое\n%% MOC:end %%');
});

test('маскировка кода сохраняет длину текста', () => {
	const content = 'a `%% MOC %%` b\n```\n%% MOC %%\n```\n';
	assert.equal(maskCode(content).length, content.length);
});

// --- рекурсивный маркер %% MOC+ %% ---

const node = (path, name, over = {}) => ({
	path, name, hasContent: true, hasMoc: false, nameTaken: false, ...over,
});

test('папка с содержимым и без оглавления попадает в план', () => {
	assert.deepEqual(planMocCreation([node('A/B', 'B')], '-'), [
		{ path: 'A/B/-B.md', folderPath: 'A/B' },
	]);
});

test('папка с уже существующим оглавлением пропускается', () => {
	assert.deepEqual(planMocCreation([node('A/B', 'B', { hasMoc: true })], '-'), []);
});

test('занятое имя файла пропускается — существующее не перезаписываем', () => {
	assert.deepEqual(planMocCreation([node('A/B', 'B', { nameTaken: true })], '-'), []);
});

test('пустая папка пропускается', () => {
	assert.deepEqual(planMocCreation([node('A/B', 'B', { hasContent: false })], '-'), []);
});

test('вложенность обрабатывается на всех уровнях', () => {
	const plan = planMocCreation(
		[node('A/B', 'B'), node('A/B/C', 'C'), node('A/B/C/D', 'D')],
		'-',
	);
	assert.deepEqual(plan.map((p) => p.path), [
		'A/B/-B.md',
		'A/B/C/-C.md',
		'A/B/C/D/-D.md',
	]);
});

test('префикс берётся из настроек', () => {
	assert.equal(planMocCreation([node('A/B', 'B')], '_Index_of_')[0].path, 'A/B/_Index_of_B.md');
});

test('рекурсивный маркер отличается от обычного', () => {
	assert.equal(hasRecursiveMarker('%% MOC+ %%', 'MOC'), true);
	assert.equal(hasRecursiveMarker('%% MOC %%', 'MOC'), false);
	assert.equal(hasRecursiveMarker('`%% MOC+ %%`', 'MOC'), false); // в коде не считается
});

test('обычный hasMarker распознаёт и рекурсивную форму', () => {
	assert.equal(hasMarker('%% MOC+ %%', 'MOC'), true);
});

test('после прохода MOC+ схлопывается в обычный блок и больше не сработает', () => {
	const out = applyMocBlock('текст\n%% MOC+ %%\nхвост', ['📄 [[A/Б|Б]]'], 'MOC');
	assert.equal(out, 'текст\n%% MOC:start %%\n📄 [[A/Б|Б]]\n%% MOC:end %%\nхвост');
	assert.equal(hasRecursiveMarker(out, 'MOC'), false);
});
