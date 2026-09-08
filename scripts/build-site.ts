import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderOfflineHtml, readStandaloneAssets } from '../src/export';
import { marsSignalArtifacts } from '../examples/mars-signal';

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
const titleSlot = 'ORRERY_GRAPH_TITLE_SLOT';
const html = renderOfflineHtml({ graph: JSON.stringify({ schemaVersion: 'graph-explorer/v1', id: 'orrery-offline-shell', title: titleSlot, nodes: [], edges: [] }), assets }).html;
const marker = '<script id="graph-explorer-data" type="application/json">';
const start = html.indexOf(marker) + marker.length;
const end = html.indexOf('</script>', start);
if (start < marker.length || end < start) throw new Error('The trusted offline exporter payload element was not found');
const titleStart = html.indexOf(`<title>${titleSlot}`) + '<title>'.length;
if (titleStart < '<title>'.length || titleStart + titleSlot.length > start) throw new Error('The trusted offline exporter title element was not found');
// Preserve the exporter markup/viewer; only an escaped title and JSON are inserted.
await writeFile(join(out, 'offline-shell.json'), JSON.stringify({ titlePrefix: html.slice(0, titleStart), prefix: html.slice(titleStart + titleSlot.length, start), suffix: html.slice(end) }));
// Publish only reviewed, content-addressed Mars captures referenced by the demo.
// Never copy a source directory or use a graph-supplied path as a build input.
const exampleRoot = await realpath(join(root, 'examples'));
for (const artifact of marsSignalArtifacts) {
  if (!/^examples\/mars-(signal|axiom)(?:[./-])/.test(artifact.sourcePath)
    || artifact.sourcePath.split('/').some(part => part === '.' || part === '..')
    || !/^[a-f0-9]{64}$/.test(artifact.sha256)
    || !['json', 'txt', 'yaml'].includes(artifact.extension)) throw new Error('Invalid Mars artifact allowlist entry');
  const source = resolve(root, artifact.sourcePath);
  const inside = relative(join(root, 'examples'), source);
  if (inside === '..' || inside.startsWith(`..${sep}`) || !(await lstat(source)).isFile()
    || !(await realpath(source)).startsWith(`${exampleRoot}${sep}`)) throw new Error('Mars artifact must be a regular example file');
  const bytes = await readFile(source);
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error(`Mars artifact digest mismatch: ${artifact.sourcePath}`);
  await mkdir(join(out, 'artifacts/mars'), { recursive: true });
  await writeFile(join(out, 'artifacts/mars', `${artifact.sha256}.${artifact.extension}`), bytes);
}
await writeFile(join(out, '.nojekyll'), '');
console.log(`Built public Orrery preview at ${out}. Serve this directory at any path.`);
