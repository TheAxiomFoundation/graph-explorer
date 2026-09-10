import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { webkit } from 'playwright';

const execute = promisify(execFile);
const buildScript = String.raw`
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Script } from 'node:vm';
import React from 'react';
assert.equal(React.version, '18.3.1');
const root = process.cwd();
const built = await Bun.build({
  entrypoints: ['lineage-host.tsx'], root, outdir: root, naming: 'lineage-host.bundle.[ext]',
  target: 'browser', format: 'iife', minify: true, metafile: true,
  jsx: { runtime: 'automatic', development: false },
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta.env': JSON.stringify({ MODE: 'production', PROD: true, DEV: false }) },
});
assert.ok(built.success, built.logs.map(String).join('\n'));
const inputs = Object.keys(built.metafile.inputs);
assert.ok(inputs.some(input => input.includes('node_modules/@axiom-foundation/orrery/dist/react/')));
assert.ok(inputs.some(input => input.includes('node_modules/react/cjs/react.production.min.js')));
for (const input of inputs) assert.ok(resolve(root, input).startsWith(root + sep), 'Build escaped installed consumer: ' + input);
new Script(await readFile('lineage-host.bundle.js', 'utf8'));
await writeFile('lineage-host-build.json', JSON.stringify({ react: React.version, inputs }) + '\n');
`;

/** Run only in CI or another environment away from the user's active desktop. */
export async function checkLineageHost({ root, consumer, runDirectory }) {
  if (process.platform === 'darwin') throw new Error('Run lineage browser QA in CI; native macOS browser tests can disturb the active desktop.');
  const reportPath = join(runDirectory, 'lineage-host-report.json');
  const report = { status: 'running', checks: [], requests: [], pageErrors: [], console: [] };
  let browser, context, page, server, failure;
  try {
    report.stage = 'build installed React 18 fixture';
    const source = (await readFile(join(root, 'examples/lineage-host.tsx'), 'utf8'))
      .replaceAll("'../src/react'", "'@axiom-foundation/orrery/react'").replaceAll("'../src/core'", "'@axiom-foundation/orrery'")
      .replace("import '@xyflow/react/dist/style.css';\n", '').replace("'../src/react/style.css'", "'@axiom-foundation/orrery/style.css'");
    assert.ok(!source.includes('../src/'));
    await writeFile(join(consumer, 'lineage-host.tsx'), source);
    await writeFile(join(consumer, 'lineage-fixture.json'), await readFile(join(root, 'examples/lineage-fixture.json')));
    await writeFile(join(consumer, 'lineage-host-build.mjs'), buildScript);
    await execute('bun', ['lineage-host-build.mjs'], { cwd: consumer, env: { ...process.env, NODE_ENV: 'production' }, timeout: 60_000, maxBuffer: 1_000_000 });
    Object.assign(report, JSON.parse(await readFile(join(consumer, 'lineage-host-build.json'), 'utf8')));
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lineage host fixture</title><link rel="stylesheet" href="./lineage-host.bundle.css"><style>body{margin:0}button,input{font:inherit}</style></head><body><div id="root"></div><script src="./lineage-host.bundle.js"></script></body></html>';
    const assets = new Map([
      ['/lineage-host.html', { bytes: Buffer.from(html), contentType: 'text/html' }],
      ['/lineage-host.bundle.js', { bytes: await readFile(join(consumer, 'lineage-host.bundle.js')), contentType: 'text/javascript' }],
      ['/lineage-host.bundle.css', { bytes: await readFile(join(consumer, 'lineage-host.bundle.css')), contentType: 'text/css' }],
    ]);
    report.assetSha256 = Object.fromEntries([...assets].map(([name, asset]) => [name, createHash('sha256').update(asset.bytes).digest('hex')]));
    server = createServer((request, response) => { const asset = assets.get(request.url); if (!asset) { response.writeHead(404); response.end(); return; } response.writeHead(200, { 'Content-Type': asset.contentType }); response.end(asset.bytes); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    report.url = `${origin}/lineage-host.html`;
    browser = await webkit.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
    await context.route('**/*', route => { const url = route.request().url(); report.requests.push(url); return [...assets.keys()].some(path => url === origin + path) ? route.continue() : route.abort(); });
    page = await context.newPage(); page.setDefaultTimeout(10_000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
    const output = name => page.locator(`output[aria-label="${name}"]`).textContent();
    const location = async () => JSON.parse(await output('Host location'));
    const camera = () => page.locator('.react-flow__viewport').getAttribute('style');
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const pane = name => page.waitForFunction(expected => document.querySelector('.ge-explorer')?.classList.contains(`ge-pane-${expected}`), name);
    const expectSets = async (nodes, edges) => {
      await page.waitForFunction(({ nodes, edges }) => {
        const read = label => JSON.parse(document.querySelector(`output[aria-label="${label}"]`)?.textContent ?? '[]').sort();
        return JSON.stringify(read('Host visible nodes')) === JSON.stringify([...nodes].sort()) && JSON.stringify(read('Host visible edges')) === JSON.stringify([...edges].sort());
      }, { nodes, edges });
      await page.waitForFunction(count => [...document.querySelectorAll('.react-flow__node')].filter(node => getComputedStyle(node).visibility === 'visible').length === count, nodes.length);
      await settle();
      assert.equal(await page.locator('.react-flow__edge-path').count(), edges.length);
    };
    const baseNodes = ['source-value', 'amount-normalized', 'transfer', 'amount-final'];
    const baseEdges = ['transfer-input', 'transfer-output'];
    report.stage = 'hidden intermediate and independent inspection';
    await page.goto(report.url, { waitUntil: 'load' });
    await expectSets(baseNodes, baseEdges);
    assert.equal(await output('Host inspected ID'), 'operation');
    assert.equal(await output('Host callback count'), '0');
    assert.match(await page.locator('.ge-trace-details').textContent(), /1 trace record is excluded/);
    const before = await camera();
    await page.getByRole('button', { name: 'Inspect hidden intermediate', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('output[aria-label="Host inspected ID"]')?.textContent === 'normalize');
    await expectSets(baseNodes, baseEdges);
    assert.equal((await location()).traceId, 'amount-final');
    assert.equal(await camera(), before);
    assert.equal(await output('Host callback count'), '0');
    report.checks.push('Exact host projection retains disconnected source and authored edges without shortcuts; an excluded record remains inspectable without trace/camera/callback changes');

    report.stage = 'controlled stage echo and Back';
    await page.getByLabel('Stage · Amount', { exact: true }).selectOption('normalized');
    await expectSets(['source-value', 'amount-normalized'], []);
    assert.equal((await location()).traceId, 'amount-normalized');
    assert.equal((await location()).selectedId, 'amount-normalized');
    assert.equal(await output('Host last reason'), 'focus');
    assert.equal(await output('Host callback count'), '1');
    await page.goBack(); await expectSets(baseNodes, baseEdges);
    assert.equal((await location()).traceId, 'amount-final');
    assert.equal(await output('Host inspected ID'), 'normalize');
    assert.equal(await output('Host callback count'), '1');
    assert.equal(await camera(), before);
    report.checks.push('Controlled stage changes select their authored root; browser Back restores the previous trace and independent inspection without echo callbacks');

    report.stage = 'optional input roles and host projection change';
    await page.getByLabel('Include controls', { exact: true }).check();
    await expectSets([...baseNodes, 'selection-source', 'selection'], [...baseEdges, 'selection-input', 'selection-transfer']);
    await page.getByLabel('Include context', { exact: true }).check();
    await expectSets([...baseNodes, 'selection-source', 'selection', 'operation'], [...baseEdges, 'selection-input', 'selection-transfer', 'operation-context']);
    assert.equal((await location()).selectedId, 'normalize');
    await page.getByRole('button', { name: 'Show intermediate', exact: true }).click();
    await expectSets([...baseNodes, 'normalize', 'selection-source', 'selection', 'operation'], [...baseEdges, 'source-normalize', 'normalize-output', 'selection-input', 'selection-transfer', 'operation-context']);
    await page.screenshot({ path: join(runDirectory, 'lineage-host-desktop.png'), fullPage: true });
    report.checks.push('Controls and one-hop context add only declared relationships, and a changed host projection restores only the actual intermediate edges');

    report.stage = 'mobile deferred controlled reflection';
    await page.getByRole('button', { name: 'Open annotated graph', exact: true }).click(); await expectSets(baseNodes, baseEdges);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Graph', exact: true }).click(); await pane('graph');
    await page.getByLabel('Defer controlled echo', { exact: true }).check();
    await page.getByRole('button', { name: 'Browse', exact: true }).click(); await pane('index');
    const callbackCount = Number(await output('Host callback count'));
    await page.getByLabel('Stage · Amount', { exact: true }).selectOption('normalized');
    await pane('graph');
    assert.equal(await output('Host pending echo'), 'pending');
    assert.equal((await location()).traceId, 'amount-final');
    await page.getByRole('button', { name: 'Reflect pending location', exact: true }).click();
    await expectSets(['source-value', 'amount-normalized'], []); await pane('graph');
    assert.equal(Number(await output('Host callback count')), callbackCount + 1);
    await page.getByLabel('Defer controlled echo', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Inspect operation', exact: true }).click(); await pane('inspector');
    assert.equal((await location()).traceId, 'amount-normalized');
    assert.equal(await output('Host inspected ID'), 'operation');
    await page.getByRole('button', { name: 'Graph', exact: true }).click(); await pane('graph');
    await page.screenshot({ path: join(runDirectory, 'lineage-host-mobile.png'), fullPage: true });
    report.checks.push('A deferred React18 controlled stage echo retains Graph; later external inspection reveals Inspect while keeping the trace root');

    report.stage = 'legacy graph and explicit exploration';
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('button', { name: 'Open unannotated graph', exact: true }).click();
    const fixture = JSON.parse(await readFile(join(root, 'examples/lineage-fixture.json'), 'utf8'));
    await expectSets(fixture.nodes.map(node => node.id), fixture.edges.map(edge => edge.id));
    assert.equal(await page.getByRole('group', { name: 'Browse by', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Trace value', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Open annotated graph', exact: true }).click(); await expectSets(baseNodes, baseEdges);
    await page.getByRole('button', { name: 'Explore inspected record', exact: true }).click();
    assert.equal((await location()).traceId, undefined);
    assert.equal((await location()).traceControls, undefined);
    assert.equal((await location()).traceContext, undefined);
    assert.equal((await location()).traceVariableId, undefined);
    assert.equal((await location()).focusId, 'operation');
    report.checks.push('An unannotated document retains its full native graph and original controls; explicit Explore exits trace without trace fields');

    report.stage = 'bounded variable index reveal and manual scroll';
    await page.getByRole('button', { name: 'Open variable index', exact: true }).click();
    const variableState = () => page.evaluate(() => ({
      range: document.querySelector('nav[aria-label="Variable index pages"]>span')?.textContent,
      rows: document.querySelectorAll('.ge-variable-list>button').length,
      selected: document.querySelector('.ge-variable-list [aria-current="true"] small')?.textContent ?? null,
      scroll: document.querySelector('.ge-variable-list')?.scrollTop,
    }));
    const expectVariablePage = async (range, selected) => {
      await page.waitForFunction(({ range, selected }) => document.querySelector('nav[aria-label="Variable index pages"]>span')?.textContent === range
        && (document.querySelector('.ge-variable-list [aria-current="true"] small')?.textContent ?? null) === selected, { range, selected });
      assert.ok((await variableState()).rows <= 100);
      await settle();
    };
    const expectRevealed = async () => {
      report.predicate = 'Selected variable row fits fully inside the visible variable list';
      await page.waitForFunction(() => {
        const list = document.querySelector('.ge-variable-list')?.getBoundingClientRect();
        const row = document.querySelector('.ge-variable-list [aria-current="true"]')?.getBoundingClientRect();
        return list && row && list.height > 0 && row.top >= list.top - 1 && row.bottom <= list.bottom + 1;
      });
      delete report.predicate;
    };
    const indexCallbacks = await output('Host callback count');
    await expectSets(['value-0'], []);
    await expectVariablePage('1–100 of 250 variables', 'variable-0');
    await page.getByRole('button', { name: 'Trace variable 199', exact: true }).click();
    await expectSets(['value-199'], []);
    await expectVariablePage('101–200 of 250 variables', 'variable-199'); await expectRevealed();
    await page.getByRole('button', { name: 'Previous variables', exact: true }).click();
    await expectVariablePage('1–100 of 250 variables', null);
    await page.waitForFunction(() => document.querySelector('.ge-variable-list')?.scrollTop === 0);
    await page.evaluate(() => { document.querySelector('.ge-variable-list').scrollTop = 150; }); await settle();
    assert.equal((await variableState()).scroll, 150);
    const manuallyScrolled = await variableState();
    const indexCamera = await camera();
    await page.getByRole('button', { name: 'Equivalent document', exact: true }).click(); await settle();
    assert.deepEqual(await variableState(), manuallyScrolled);
    assert.equal(await camera(), indexCamera);
    await page.getByRole('button', { name: 'Next variables', exact: true }).click();
    await expectVariablePage('101–200 of 250 variables', 'variable-199');
    await page.waitForFunction(() => document.querySelector('.ge-variable-list')?.scrollTop === 0);
    // Back changes the authored trace through the host, then Forward must reveal it.
    await page.goBack(); await expectSets(['value-0'], []);
    await expectVariablePage('1–100 of 250 variables', 'variable-0'); await expectRevealed();
    await page.goForward(); await expectSets(['value-199'], []);
    await expectVariablePage('101–200 of 250 variables', 'variable-199'); await expectRevealed();
    assert.equal(await output('Host callback count'), indexCallbacks);
    report.checks.push('Variable index mounts at most100 rows, reveals distant controlled trace/Back/Forward selections, resets manual pages to top, and preserves manual scroll/camera for equivalent documents');

    report.stage = 'variable reveal from hidden mobile Browse and widening';
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok((await page.getByRole('navigation', { name: 'Synthetic host controls', exact: true }).boundingBox()).height <= 108, 'Synthetic controls must leave space for the mobile viewer');
    await page.getByRole('button', { name: 'Inspect', exact: true }).click(); await pane('inspector');
    await page.getByRole('button', { name: 'Trace variable 149', exact: true }).click(); await pane('inspector');
    await page.getByRole('button', { name: 'Browse', exact: true }).click(); await pane('index');
    await expectVariablePage('101–200 of 250 variables', 'variable-149'); await expectRevealed();
    await page.getByRole('button', { name: 'Inspect', exact: true }).click(); await pane('inspector');
    await page.getByRole('button', { name: 'Trace variable 199', exact: true }).click(); await pane('inspector');
    await page.setViewportSize({ width: 1440, height: 960 });
    await expectVariablePage('101–200 of 250 variables', 'variable-199'); await expectRevealed();
    assert.equal(await output('Host callback count'), indexCallbacks);
    await page.screenshot({ path: join(runDirectory, 'lineage-host-variable-index.png'), fullPage: true });
    report.checks.push('An externally chosen far variable reveals its row after hidden mobile Browse returns or widens to desktop without callback loops');
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.console, []);
    assert.ok(report.requests.every(url => [...assets.keys()].some(path => url === origin + path)));
    report.status = 'passed'; report.stage = 'complete';
  } catch (error) {
    failure = error; report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error);
    if (page) {
      report.dom = await page.evaluate(() => ({ pane: document.querySelector('.ge-explorer')?.className, outputs: [...document.querySelectorAll('output')].map(node => ({ label: node.getAttribute('aria-label'), value: node.textContent })), canvas: document.querySelector('.ge-canvas')?.getBoundingClientRect().toJSON(), viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style'), variableIndex: {
        page: document.querySelector('nav[aria-label="Variable index pages"]>span')?.textContent,
        list: document.querySelector('.ge-variable-list')?.getBoundingClientRect().toJSON(),
        selected: document.querySelector('.ge-variable-list [aria-current="true"]')?.getBoundingClientRect().toJSON(),
        selectedId: document.querySelector('.ge-variable-list [aria-current="true"] small')?.textContent,
        scroll: document.querySelector('.ge-variable-list')?.scrollTop,
        rows: document.querySelectorAll('.ge-variable-list>button').length,
      } })).catch(() => undefined);
      await page.screenshot({ path: join(runDirectory, 'lineage-host-failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
    }
  } finally {
    await context?.close().catch(() => {}); await browser?.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  if (failure) throw new Error(`Lineage host check failed during ${report.stage}: ${report.error}. Evidence: ${reportPath}`, { cause: failure });
  return { status: report.status, checks: report.checks, report: reportPath, assetSha256: report.assetSha256 };
}
