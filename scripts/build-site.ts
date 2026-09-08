import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderOfflineHtml, readStandaloneAssets } from '../src/export';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'site-dist');
try { if ((await lstat(out)).isSymbolicLink()) throw new Error('Refusing to clean a symlinked site-dist directory'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const assets = await readStandaloneAssets(join(root, 'dist/standalone'));
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'assets'), { recursive: true });
const result = await Bun.build({
  entrypoints: [join(root, 'site/main.tsx')], outdir: join(out, 'assets'),
  target: 'browser', format: 'esm', minify: true,
  naming: '[name]-[hash].[ext]', jsx: { runtime: 'automatic', development: false },
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta.env': JSON.stringify({ MODE: 'production', PROD: true, DEV: false }) },
});
if (!result.success) throw new Error(result.logs.map(String).join('\n'));
const assetTags = result.outputs.map(file => {
  const path = `./assets/${file.path.split('/').at(-1)}`;
  return file.path.endsWith('.css') ? `<link rel="stylesheet" href="${path}">` : file.path.endsWith('.js') ? `<script type="module" src="${path}"></script>` : '';
}).filter(Boolean).join('\n    ');
const template = await readFile(join(root, 'site/index.html'), 'utf8');
await writeFile(join(out, 'index.html'), template.replace('<!-- ORRERY_ASSETS -->', assetTags));
const html = renderOfflineHtml({ graph: JSON.stringify({ schemaVersion: 'graph-explorer/v1', id: 'orrery-offline-shell', title: 'Orrery offline report', nodes: [], edges: [] }), assets }).html;
const marker = '<script id="graph-explorer-data" type="application/json">';
const start = html.indexOf(marker) + marker.length;
const end = html.indexOf('</script>', start);
if (start < marker.length || end < start) throw new Error('The trusted offline exporter payload element was not found');
// Preserve the package exporter HTML and bundled viewer exactly. Only JSON changes.
await writeFile(join(out, 'offline-shell.json'), JSON.stringify({ prefix: html.slice(0, start), suffix: html.slice(end) }));
await writeFile(join(out, '.nojekyll'), '');
console.log(`Built public Orrery preview at ${out}. Serve this directory at any path.`);
