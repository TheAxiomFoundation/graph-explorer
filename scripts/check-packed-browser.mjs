import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { checkPackedHost } from './check-packed-host.mjs';

// Test a real consumer artifact, never a Vite-transformed page or source import.
// WebKit only: no Chrome profile, Chromium, or remote-debugging connection.
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--tarball')) {
  throw new Error('Usage: node scripts/check-packed-browser.mjs [--tarball /path/package.tgz]');
}
const output = join(root, 'output/playwright');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(join(output, 'packed-'));
// Outside the checkout so missing package dependencies cannot resolve from the
// repository's ancestor node_modules and make a broken tarball appear usable.
const consumer = await mkdtemp(join(tmpdir(), 'graph-explorer-consumer-'));
const report = { status: 'running', fixture: 'Synthetic only; no application data', browser: 'WebKit', checks: [], requests: [], console: [], pageErrors: [] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
function run(command, commandArgs, cwd = root) {
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8', timeout: 180_000, env: { ...process.env, NODE_ENV: 'production' } });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
async function withDeadline(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Diagnostic deadline exceeded')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
/** Rank complete search results in a real installed production React18 host. */
async function checkPackedSearch({ consumer, runDirectory }) {
  const reportPath = join(runDirectory, 'search-report.json');
  const report = { status: 'running', fixture: 'Invented records only; no application data', checks: [], requests: [], console: [], pageErrors: [] };
  const payloadIds = Array.from({ length: 240 }, (_, index) => `archive-${String(index).padStart(3, '0')}`);
  const graph = {
    schemaVersion: 'graph-explorer/v1', id: 'synthetic-search-relevance', title: 'Search relevance fixture', revision: 'synthetic',
    nodes: [
      ...payloadIds.map((id, index) => ({ id, label: `Archive entry ${index}`, kind: 'archive', data: { owner: { name: 'Mira Solen' } } })),
      { id: 'direct-label', label: 'Mira Solen', kind: 'person' },
      { id: 'Mira Solen', label: 'Identifier record', kind: 'lookup' },
      { id: 'canvas-anchor', label: 'Canvas anchor', kind: 'canvas' },
      { id: 'canvas-output', label: 'Canvas output', kind: 'canvas' },
    ],
    edges: [{ id: 'canvas-edge', source: 'canvas-anchor', target: 'canvas-output', kind: 'prerequisite', category: 'dependency' }],
  };
  let browser, context, page, server, failure;
  try {
    report.stage = 'build installed search host';
    await writeFile(join(consumer, 'search-host.tsx'), `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Orrery } from '@axiom-foundation/orrery/react';
import type { GraphLocation } from '@axiom-foundation/orrery';
import '@axiom-foundation/orrery/style.css';
const graph = ${JSON.stringify(graph)};
function App() {
  const [location, setLocation] = useState<GraphLocation>({ focusId: 'canvas-anchor', direction: 'both', depth: 1 });
  return <section style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <header style={{ padding: 8 }}><button type="button" onClick={() => setLocation(previous => ({ ...previous, selectedId: 'archive-239', selectedType: 'node', kinds: [] }))}>Select last match</button><output hidden aria-label="Search location">{JSON.stringify(location)}</output></header>
    <main style={{ flex: 1, minHeight: 0 }}><Orrery document={graph} location={location} onLocationChange={setLocation} searchFiltersCanvas={false} canvasNodeFilter={node => node.kind === 'canvas'} /></main>
  </section>;
}
createRoot(document.getElementById('root')!).render(<App />);
`);
    await writeFile(join(consumer, 'search-build.mjs'), String.raw`import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Script } from 'node:vm';
import React from 'react';
assert.equal(React.version, '18.3.1');
const root = process.cwd();
const built = await Bun.build({
  entrypoints: ['search-host.tsx'], root, outdir: root, naming: 'search.bundle.[ext]',
  target: 'browser', format: 'iife', minify: true, metafile: true,
  jsx: { runtime: 'automatic', development: false },
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta.env': JSON.stringify({ MODE: 'production', PROD: true, DEV: false }) },
});
assert.ok(built.success, built.logs.map(String).join('\n'));
assert.ok(built.metafile);
const inputs = Object.keys(built.metafile.inputs);
assert.ok(inputs.some(input => input.includes('node_modules/@axiom-foundation/orrery/dist/react/')));
assert.ok(inputs.some(input => input.includes('node_modules/react/cjs/react.production.min.js')));
for (const input of inputs) assert.ok(resolve(root, input).startsWith(root + sep), 'Build escaped installed consumer: ' + input);
new Script(await readFile('search.bundle.js', 'utf8'));
await writeFile('search-build.json', JSON.stringify({ react: React.version, inputs }) + '\n');
`);
    run('bun', ['search-build.mjs'], consumer);
    Object.assign(report, JSON.parse(await readFile(join(consumer, 'search-build.json'), 'utf8')));
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic search relevance</title><link rel="stylesheet" href="/search.bundle.css"><style>html,body,#root{margin:0;height:100%}</style></head><body><div id="root"></div><script src="/search.bundle.js"></script></body></html>';
    const assets = new Map([
      ['/search.html', { bytes: Buffer.from(html), type: 'text/html; charset=utf-8' }],
      ['/search.bundle.js', { bytes: await readFile(join(consumer, 'search.bundle.js')), type: 'text/javascript; charset=utf-8' }],
      ['/search.bundle.css', { bytes: await readFile(join(consumer, 'search.bundle.css')), type: 'text/css; charset=utf-8' }],
    ]);
    report.assetSha256 = Object.fromEntries([...assets].map(([name, asset]) => [name, hash(asset.bytes)]));
    server = createServer((request, response) => {
      const asset = assets.get(request.url);
      if (!asset) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store' }); response.end(asset.bytes);
    });
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    report.url = `${origin}/search.html`;
    browser = await webkit.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = route.request().url(); report.requests.push(url);
      return [...assets.keys()].some(path => url === origin + path) ? route.continue() : route.abort();
    });
    page = await context.newPage(); page.setDefaultTimeout(10_000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
    const settle = () => withDeadline(page.evaluate(() => new Promise(resolveFrames => requestAnimationFrame(() => requestAnimationFrame(resolveFrames)))), 2_000);
    const rows = () => page.locator('.ge-index-list > button small').allTextContents();
    const camera = () => page.locator('.react-flow__viewport').getAttribute('style');
    const expectCanvas = async () => {
      assert.equal(await page.locator('.react-flow__node').count(), 2);
      assert.equal(await page.locator('.react-flow__edge-path').count(), 1);
      assert.ok(await page.locator('.ge-index-list > button').count() <= 100);
    };
    const expectPage = label => page.waitForFunction(expected => document.querySelector('.ge-index-pages span')?.textContent === expected, label);
    const collectAll = async expectedTotal => {
      const ids = [], visited = new Set();
      const expectedPages = Math.ceil(expectedTotal / 100);
      // A broken Next action must produce bounded failure evidence, not loop
      // forever through changing or repeated pages until the CI job is killed.
      for (let index = 0; index < expectedPages; index++) {
        await expectCanvas();
        const before = await page.locator('.ge-index-pages span').textContent();
        assert.ok(!visited.has(before), 'Pagination must not revisit an earlier page'); visited.add(before);
        ids.push(...await rows());
        const next = page.getByRole('button', { name: 'Next records', exact: true });
        assert.equal(await next.isDisabled(), index === expectedPages - 1, 'Next must end exactly at the expected final page');
        if (index === expectedPages - 1) break;
        await next.click();
        await page.waitForFunction(previous => document.querySelector('.ge-index-pages span')?.textContent !== previous, before);
      }
      return ids;
    };
    await page.goto(report.url, { waitUntil: 'load' });
    await page.getByRole('heading', { name: graph.title, exact: true, level: 1 }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 2
      && [...document.querySelectorAll('.react-flow__node')].every(node => node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility === 'visible'));
    await expectPage('1–100 of 244 records');
    assert.deepEqual(await rows(), payloadIds.slice(0, 100), 'Blank query begins in document order, even with direct matches later');
    await settle();
    const initialCamera = await camera();
    const canvas = await page.locator('.ge-canvas').boundingBox();
    assert.ok(canvas);
    await page.mouse.move(canvas.x + 25, canvas.y + 25); await page.mouse.down();
    await page.mouse.move(canvas.x + 95, canvas.y + 65, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(previous => document.querySelector('.react-flow__viewport')?.getAttribute('style') !== previous, initialCamera);
    await settle(); const pannedCamera = await camera();
    const search = page.getByRole('searchbox');
    report.stage = 'direct label and ID ranking';
    await search.fill('Mira Solen');
    await expectPage('1–100 of 242 records'); await settle(); await expectCanvas();
    const firstRows = await rows();
    assert.deepEqual(new Set(firstRows.slice(0, 2)), new Set(['direct-label', 'Mira Solen']), 'Exact label and ID records must precede every payload-only mention');
    assert.equal(await camera(), pannedCamera, 'Index-only query must preserve the manually panned camera');
    report.firstResults = firstRows.slice(0, 10);
    report.checks.push('Exact label and exact ID rank ahead of 240 earlier payload-only mentions in the installed React18 viewer');
    report.stage = 'complete ranked matching set';
    const ranked = await collectAll(242);
    assert.equal(ranked.length, 242);
    assert.equal(new Set(ranked).size, ranked.length, 'Pagination must not duplicate matching records');
    assert.deepEqual([...ranked].sort(), [...payloadIds, 'direct-label', 'Mira Solen'].sort(), 'Ranking must retain every matching payload record');
    assert.equal(await camera(), pannedCamera);
    report.checks.push('All 242 matches remain reachable exactly once across three pages; no more than 100 rows mount');
    report.stage = 'clear query restores document order and camera';
    await search.fill(''); await expectPage('1–100 of 244 records'); await settle();
    assert.equal(await camera(), pannedCamera, 'Clearing an index-only query must not move the camera');
    const all = await collectAll(244);
    assert.deepEqual(all, graph.nodes.map(node => node.id), 'Empty query restores the complete original document order');
    assert.equal(await camera(), pannedCamera);
    report.checks.push('Clearing the query restores all 244 records in document order while the two-node/one-edge canvas and manual camera remain unchanged');
    report.stage = 'selected ranked result reveals its page';
    await search.fill('Mira Solen'); await expectPage('1–100 of 242 records');
    await page.getByRole('button', { name: 'Select last match', exact: true }).click();
    await expectPage('201–242 of 242 records');
    await page.waitForFunction(() => {
      const row = document.querySelector('.ge-index-list [aria-current="true"]');
      const list = document.querySelector('.ge-index-list')?.getBoundingClientRect();
      const selected = row?.getBoundingClientRect();
      return row?.querySelector('small')?.textContent === 'archive-239' && list && selected
        && selected.top >= list.top - 1 && selected.bottom <= list.bottom + 1;
    });
    await settle(); await expectCanvas();
    assert.equal(await camera(), pannedCamera, 'Revealing an excluded matching record must not reframe the canvas');
    report.checks.push('External selection with an equivalent fresh filter reveals the selected ranked record on its later page and scrolls it into view');
    await page.screenshot({ path: join(runDirectory, 'search-desktop.png'), fullPage: true });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.console, []);
    assert.equal(report.requests.length, 3, 'The host requires only its three local built assets');
    assert.ok(report.requests.every(url => [...assets.keys()].some(path => url === origin + path)));
    report.status = 'passed'; report.stage = 'complete';
  } catch (error) {
    failure = error; report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error);
    if (page) {
      report.dom = await withDeadline(page.evaluate(() => ({
        page: document.querySelector('.ge-index-pages span')?.textContent,
        ids: [...document.querySelectorAll('.ge-index-list > button small')].map(node => node.textContent),
        selection: document.querySelector('.ge-index-list [aria-current="true"] small')?.textContent,
        camera: document.querySelector('.react-flow__viewport')?.getAttribute('style'),
      })), 2_000).catch(() => undefined);
      await page.screenshot({ path: join(runDirectory, 'search-failure.png'), fullPage: true, timeout: 5_000 }).catch(() => {});
    }
  } finally {
    await context?.close().catch(() => {}); await browser?.close().catch(() => {});
    if (server) await new Promise(resolveClose => server.close(resolveClose));
    await writeJson(reportPath, report);
  }
  if (failure) throw new Error(`Packed search check failed during ${report.stage}: ${report.error}. Evidence: ${reportPath}`, { cause: failure });
  return { status: report.status, react: report.react, checks: report.checks, report: reportPath };
}
let browser, context, page, server;
try {
  let tarball;
  if (args.length) tarball = resolve(args[1]);
  else {
    const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', runDirectory]));
    assert.equal(packed.length, 1);
    tarball = join(runDirectory, packed[0].filename);
  }
  report.tarball = tarball;
  report.tarballSha256 = hash(await readFile(tarball));
  await writeJson(join(consumer, 'package.json'), {
    private: true, type: 'module', dependencies: {
      '@axiom-foundation/orrery': `file:${tarball}`,
      '@axiom-foundation/graph-explorer': `file:${tarball}`, react: '18.3.1', 'react-dom': '18.3.1',
    },
  });
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], consumer);
  const packageDirectory = join(consumer, 'node_modules/@axiom-foundation/orrery');
  const installedPackage = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  assert.equal(installedPackage.name, '@axiom-foundation/orrery');
  report.packageVersion = installedPackage.version;
  for (const command of ['orrery', 'graph-explorer']) {
    assert.match(run(join(consumer, 'node_modules/.bin', command), ['--help'], consumer), /^Usage: orrery /);
  }
  report.checks.push('Both Orrery and legacy graph-explorer CLI entrypoints work');
  report.reactEntrySha256 = hash(await readFile(join(packageDirectory, 'dist/react/index.js')));

  const hostile = '</script><script>globalThis.graphExplorerInjected = true</script>';
  const graph = {
    schemaVersion: 'graph-explorer/v1', id: 'packed-browser-fixture', title: 'Packed browser fixture', revision: 'after',
    nodes: [
      { id: 'input', label: 'Input record', kind: 'fixture', revision: 'before' },
      { id: 'output', label: 'Output record', kind: 'fixture', revision: 'after', description: 'Packed output detail', data: { hostile } },
    ],
    edges: [{ id: 'dependency', source: 'input', target: 'output', kind: 'prerequisite', category: 'dependency' }],
    receipts: [{ id: 'declared-receipt', label: 'Declared receipt', sha256: 'a'.repeat(64),
      subjects: [{ type: 'node', id: 'output', revision: 'after' }], status: 'verified' }],
    assessments: [{ receiptId: 'declared-receipt', status: 'verified', documentSha256: 'b'.repeat(64) }],
  };
  const baseline = structuredClone(graph);
  baseline.revision = 'before';
  baseline.nodes[1].label = 'Earlier output record';
  baseline.nodes[1].revision = 'before';
  baseline.receipts = [];
  const input = join(runDirectory, 'graph.json');
  const before = join(runDirectory, 'before.json');
  const htmlPath = join(runDirectory, 'comparison.html');
  await writeJson(input, graph);
  await writeJson(before, baseline);
  const cliResult = JSON.parse(run(process.execPath, [join(packageDirectory, 'dist/cli.js'), '--input', input, '--baseline', before, '--output', htmlPath], consumer));
  const html = await readFile(htmlPath);
  report.documentSha256 = hash(await readFile(input));
  report.htmlSha256 = hash(html);
  report.htmlBytes = html.length;
  assert.equal(cliResult.documentSha256, report.documentSha256);
  assert.equal(cliResult.offline, true);
  report.checks.push('Fresh installed Node CLI generated the tested HTML and exact input digest');

  // Serve the exact bytes emitted by the installed CLI. No HTML/JS transforms.
  server = createServer((request, response) => {
    if (request.url !== '/comparison.html') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const url = `http://127.0.0.1:${server.address().port}/comparison.html`;
  report.url = url;
  browser = await webkit.launch({ headless: true });
  report.browserVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    report.requests.push(route.request().url());
    // Rendering must need only the report document, with no resource fetches.
    return route.request().url() === url ? route.continue() : route.abort();
  });
  page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
  page.setDefaultTimeout(10_000);
  await page.goto(url, { waitUntil: 'load' });
  assert.deepEqual(report.pageErrors, [], 'The emitted classic script must execute without errors');
  await page.getByRole('heading', { name: 'Packed browser fixture', exact: true, level: 1 }).waitFor();
  async function assertRenderedGraph(fullyInside = true) {
    report.stage = 'mounted graph';
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 2 && document.querySelectorAll('.react-flow__edge').length === 1);
    report.stage = 'visible graph geometry';
    await page.waitForFunction(fullyInside => {
      const canvas = document.querySelector('.ge-canvas').getBoundingClientRect();
      return [...document.querySelectorAll('.react-flow__node')].every(node => {
        const box = node.getBoundingClientRect();
        return getComputedStyle(node).visibility === 'visible' && box.width > 0 && box.height > 0
          && [box.x, box.y, box.width, box.height].every(Number.isFinite)
          && (!fullyInside || (box.left >= canvas.left - 1 && box.right <= canvas.right + 1
          && box.top >= canvas.top - 1 && box.bottom <= canvas.bottom + 1));
      });
    }, fullyInside);
    report.stage = 'visible authored edge';
    await page.waitForFunction(() => {
      const edge = document.querySelector('.react-flow__edge-path');
      if (!(edge instanceof SVGPathElement)) return false;
      const style = getComputedStyle(edge);
      return Boolean(edge.getAttribute('d')) && !/NaN|Infinity/.test(edge.getAttribute('d'))
        && edge.getTotalLength() > 0 && style.visibility === 'visible' && style.stroke !== 'none' && Number(style.opacity) > 0;
    });
  }
  await assertRenderedGraph();
  assert.equal(await page.locator('script[src], link[rel="stylesheet"][href]').count(), 0);
  assert.equal(await page.evaluate(() => globalThis.graphExplorerInjected), undefined);
  report.checks.push('Actual WebKit renders both nodes and the authored edge with inline assets and inert hostile text');
  // Each load must render. These are independent assertions, never retries of
  // a failed assertion; size changes exercise node measurement during mounting.
  report.reloads = 20;
  for (let attempt = 0; attempt < report.reloads; attempt++) {
    const mode = attempt % 5;
    await page.setViewportSize(mode === 1 ? { width: 390, height: 844 } : mode === 2 ? { width: 1600, height: 1050 } : mode === 3 ? { width: 640, height: 480 } : { width: 1440, height: 960 });
    // Resize while React/XYFlow initialize, including the sequence that left
    // style-sized nodes permanently hidden when measured sizes were discarded.
    // Observe both failures immediately so a navigation rejection during resize
    // still reaches our evidence capture and cleanup instead of escaping Node.
    const results = await Promise.allSettled([
      page.reload({ waitUntil: 'load' }),
      (async () => {
        if (mode === 4) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.setViewportSize({ width: 760, height: 600 });
        }
        await page.setViewportSize({ width: 1440, height: 960 });
      })(),
    ]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    await page.setViewportSize({ width: 1440, height: 960 });
    await assertRenderedGraph();
  }
  report.checks.push('All 20 repeated loads and mounting resizes retain visible nodes and an authored edge');
  report.stage = 'inspection and history';

  await page.locator('.ge-index-list').getByRole('button', { name: /Output record/ }).click();
  await page.locator('.ge-inspector').getByRole('heading', { name: 'Output record', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash.includes('selectedId=output'), true);
  await page.getByRole('tab', { name: 'Receipts', exact: true }).click();
  await page.getByRole('heading', { name: 'Declared receipt', exact: true }).waitFor();
  assert.equal(await page.locator('.ge-receipt .ge-badge').textContent(), 'Not verified');
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.locator('.ge-inspector').getByText(/Earlier output record/).waitFor();
  report.checks.push('Selection updates inspector/URL, producer Receipt stays unverified, and baseline History renders');
  await assertRenderedGraph();
  await page.screenshot({ path: join(runDirectory, 'desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  report.stage = 'mobile navigation';
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.locator('.ge-inspector').waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: 'Record', exact: true }).click();
  await page.getByRole('button', { name: 'Explore neighbors', exact: true }).click();
  await page.locator('.ge-main').waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).hash.includes('focusId=output'), true);
  await assertRenderedGraph(false);
  // Focus framing applies after the newly revealed mobile canvas is measured.
  // Wait for the requested record, not just offscreen-but-visible DOM nodes.
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.ge-canvas').getBoundingClientRect();
    const focus = document.querySelector('.react-flow__node[data-id="output"]').getBoundingClientRect();
    return focus.left >= canvas.left - 1 && focus.right <= canvas.right + 1
      && focus.top >= canvas.top - 1 && focus.bottom <= canvas.bottom + 1;
  });
  await page.screenshot({ path: join(runDirectory, 'mobile.png'), fullPage: true });
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.console, []);
  assert.deepEqual(report.requests, Array(1 + report.reloads).fill(url), 'The entire browser interaction must require only the HTML document');
  report.checks.push('Mobile Inspect/exploration works without browser errors, warnings, or additional network requests');

  // Actually render the public React entry in a production React18 host;
  // a successful import alone misses incompatible jsxDEV calls.
  await writeFile(join(consumer, 'production.mjs'), `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, version } from 'react';
import { renderToString } from 'react-dom/server';
import { GraphExplorer, Orrery } from '@axiom-foundation/orrery/react';
import { GraphExplorer as LegacyGraphExplorer } from '@axiom-foundation/graph-explorer/react';
assert.equal(Orrery, GraphExplorer);
import { parseGraphDocument } from '@axiom-foundation/orrery';
const document = parseGraphDocument(JSON.parse(readFileSync(process.argv[2], 'utf8')));
for (const Viewer of [Orrery, GraphExplorer, LegacyGraphExplorer]) {
  assert.ok(renderToString(createElement(Viewer, { document, location: { selectedId: 'output' } })).includes('Packed output detail'));
}
console.log(JSON.stringify({ react: version, productionRender: 'passed' }));
`);
  report.productionReact = JSON.parse(run(process.execPath, ['production.mjs', input], consumer));
  report.checks.push('Installed public React entry renders under production React18');
  await context.close(); context = undefined;
  await browser.close(); browser = undefined; page = undefined;
  report.stage = 'host Locate and index navigation';
  report.hostEmbedding = await checkPackedHost({ root, consumer, runDirectory });
  report.checks.push('Installed React18 host Locate and index selection work through mobile resizing and equivalent controlled filters without unintended navigation');
  report.stage = 'ranked search in installed React18 host';
  report.searchRelevance = await checkPackedSearch({ consumer, runDirectory });
  report.checks.push('Installed React18 search ranks direct label/ID matches before payload mentions, preserves all results and empty-query order, and retains camera/pagination/selected-row reveal');
  report.status = 'passed';
  report.stage = 'complete';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  if (page) report.dom = await withDeadline(page.evaluate(() => ({
    canvas: document.querySelector('.ge-canvas')?.getBoundingClientRect().toJSON(),
    viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style'),
    nodes: [...document.querySelectorAll('.react-flow__node')].map(node => ({ id: node.getAttribute('data-id'), style: node.getAttribute('style'), visibility: getComputedStyle(node).visibility, rect: node.getBoundingClientRect().toJSON() })),
    edges: [...document.querySelectorAll('.react-flow__edge-path')].map(edge => ({ path: edge.getAttribute('d'), visibility: getComputedStyle(edge).visibility, stroke: getComputedStyle(edge).stroke })),
  })), 2_000).catch(() => undefined);
  if (page) await page.screenshot({ path: join(runDirectory, 'failure.png'), fullPage: true, timeout: 5_000 }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  await rm(consumer, { recursive: true, force: true });
  await writeJson(join(runDirectory, 'report.json'), report);
  console.log(JSON.stringify({ status: report.status, tarballSha256: report.tarballSha256, report: join(runDirectory, 'report.json'), checks: report.checks.length, error: report.error }, null, 2));
}
