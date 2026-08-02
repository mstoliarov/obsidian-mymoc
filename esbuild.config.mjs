import esbuild from 'esbuild';

await esbuild.build({
	entryPoints: ['src/main.ts'],
	bundle: true,
	// Obsidian предоставляет эти модули сам — в бандл не включаем.
	external: ['obsidian', 'electron'],
	format: 'cjs',
	target: 'es2020',
	outfile: 'main.js',
	logLevel: 'info',
});
