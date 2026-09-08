import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectThirdPartyNotices } from './third-party-notices';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
if (JSON.parse(await readFile('package.json', 'utf8')).name !== '@axiom-foundation/graph-explorer') throw new Error('Unexpected package root');
const dist = join(root, 'dist');
try { if ((await lstat(dist)).isSymbolicLink()) throw new Error('Refusing to clean a symlinked dist directory'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
// Only this package's generated dist is removed, never an arbitrary cwd/output path.
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'react'), { recursive: true });
const adapters = (await readdir('src/adapters')).filter(file => file.endsWith('.ts')).map(file => join('src/adapters', file));
const browser = await Bun.build({
  entrypoints: ['src/core/index.ts', 'src/react/index.ts', ...adapters], root: 'src', outdir: dist,
  target: 'browser', format: 'esm', splitting: true, sourcemap: 'external',
  // Bun 1.3.12 selects the JSX runtime from this define; jsx.development alone
  // does not switch its output. React stays external and uses the host's mode.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  jsx: { runtime: 'automatic', development: false },
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@xyflow/react', '@dagrejs/dagre'],
});
if (!browser.success) throw new Error(browser.logs.map(String).join('\n'));
const node = await Bun.build({ entrypoints: ['src/export.ts', 'src/cli.ts'], root: 'src', outdir: dist, target: 'node', format: 'esm', splitting: false });
if (!node.success) throw new Error(node.logs.map(String).join('\n'));
await chmod(join(dist, 'cli.js'), 0o755);
const standalone = await Bun.build({
  entrypoints: ['examples/main.tsx'], target: 'browser', format: 'iife', minify: true,
  jsx: { runtime: 'automatic', development: false },
  metafile: true,
  // The offline report runs as a classic script, without Vite's import.meta.env
  // transform. Resolve dependencies' environment guards during bundling.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production', PROD: true, DEV: false }),
  },
});
if (!standalone.success) throw new Error(standalone.logs.map(String).join('\n'));
const javascript = (await Promise.all(standalone.outputs.filter(file => file.path.endsWith('.js')).map(file => file.text()))).join('\n');
const css = (await Promise.all(standalone.outputs.filter(file => file.path.endsWith('.css')).map(file => file.text()))).join('\n');
if (!javascript || !css) throw new Error('Standalone build must produce JavaScript and CSS');
if (!standalone.metafile) throw new Error('Standalone build must provide a dependency inventory');
const notices = await collectThirdPartyNotices(root, standalone.metafile);
await writeFile(join(root, 'THIRD_PARTY_NOTICES'), notices.text);
const projectLicense = await readFile(join(root, 'LICENSE'), 'utf8');
if (projectLicense.includes('*/')) throw new Error('Project license cannot be embedded in a JavaScript comment');
await mkdir(join(dist, 'standalone'), { recursive: true });
await writeFile(join(dist, 'standalone/viewer.js'), `/*!\nGraph explorer - Apache-2.0\n${projectLicense}\n${notices.text}\n*/\n${javascript}`);
await writeFile(join(dist, 'standalone/viewer.css'), css);
await writeFile(join(dist, 'standalone/dependencies.json'), `${JSON.stringify({ packages: notices.packages }, null, 2)}\n`);
const types = Bun.spawn(['bun', 'x', 'tsc', '-p', 'tsconfig.build.json'], { stdout: 'inherit', stderr: 'inherit' });
if (await types.exited) process.exit(1);
const flowCss = await readFile('node_modules/@xyflow/react/dist/style.css', 'utf8');
const ownCss = await readFile('src/react/style.css', 'utf8');
await writeFile(join(dist, 'react/style.css'), `${flowCss}\n${ownCss}`);
console.log('Built core, React viewer, adapters, declarations, Node exporter/CLI, and standalone assets.');
