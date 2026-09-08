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
