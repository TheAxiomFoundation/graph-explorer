import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Script } from 'node:vm';
import { webkit } from 'playwright';

const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** CI-only browser acceptance of the installed package, using invented data. */
export async function checkPackedLineage({ root, consumer, runDirectory }) {
  const reportPath = join(runDirectory, 'lineage-report.json');
  const report = { status: 'running', fixture: 'Invented value lineage; no computation claimed', checks: [], requests: [], errors: [], warnings: [] };
  let browser, context, page, server, failure;
  try {
    const input = join(runDirectory, 'lineage.json');
    const original = await readFile(join(root, 'examples/lineage-fixture.json'));
    await writeFile(input, original);
    const htmlPath = join(runDirectory, 'lineage.html');
    const cli = join(consumer, 'node_modules/@axiom-foundation/orrery/dist/cli.js');
    await execute(process.execPath, [cli, '--input', input, '--output', htmlPath], { cwd: consumer, env: { ...process.env, NODE_ENV: 'production' }, timeout: 60_000, maxBuffer: 1_000_000 });
    const html = await readFile(htmlPath);
    report.htmlSha256 = hash(html);
    report.graphSha256 = hash(original);
    // Parse every executable inline script as a classic script, before launching.
    for (const match of html.toString().matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!match[1].includes('application/json')) new Script(match[2]);
    }
    await writeFile(join(consumer, 'lineage-probe.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, version } from 'react';
import { renderToString } from 'react-dom/server';
import { Orrery } from '@axiom-foundation/orrery/react';
import { parseGraphDocument, prepareGraphExport, traceLineage, getDefaultLineageLocation } from '@axiom-foundation/orrery';
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const document = parseGraphDocument(raw);
assert.deepEqual(document.lineage, raw.lineage);
const location = getDefaultLineageLocation(document);
assert.equal(location.traceId, 'amount-final');
assert.equal(traceLineage(document, location.traceId).edgeIds.length, 4);
assert.deepEqual(JSON.parse(prepareGraphExport(document).json).lineage, raw.lineage);
const markup = renderToString(createElement(Orrery, { document, location }));
assert.ok(markup.includes('Find a variable') && markup.includes('Value trace'));
console.log(JSON.stringify({ react: version, checks: 'installed core, export, and production SSR passed' }));
`);
    const probe = await execute(process.execPath, ['lineage-probe.mjs', input], { cwd: consumer, env: { ...process.env, NODE_ENV: 'production' }, timeout: 60_000, maxBuffer: 1_000_000 });
    report.production = JSON.parse(probe.stdout);
    assert.equal(report.production.react, '18.3.1');
    report.checks.push('Installed annotations survive parsing/export and production React18 rendering; offline classic scripts parse');
    server = createServer((request, response) => {
      if (request.url !== '/lineage.html') { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}/lineage.html`;
    browser = await webkit.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      report.requests.push(route.request().url());
      return route.request().url() === url ? route.continue() : route.abort();
    });
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) report.warnings.push(message.text()); });
    const state = () => new URL(page.url()).hash;
    const camera = () => page.locator('.react-flow__viewport').getAttribute('style');
    const graph = async (nodes, edges) => {
      await page.waitForFunction(({ nodes, edges }) => document.querySelectorAll('.react-flow__node').length === nodes && document.querySelectorAll('.react-flow__edge').length === edges, { nodes, edges });
      await page.waitForFunction(() => [...document.querySelectorAll('.react-flow__node')].every(node => {
        const rect = node.getBoundingClientRect();
        return getComputedStyle(node).visibility === 'visible' && rect.width > 0 && rect.height > 0 && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);
      }) && [...document.querySelectorAll('.react-flow__edge-path')].every(edge => edge.getAttribute('d') && !/NaN|Infinity/.test(edge.getAttribute('d'))));
    };
    const selectVariable = label => page.locator('.ge-variable-list > button').filter({ has: page.getByText(label, { exact: true }) }).click();
    report.stage = 'initial value trace';
    await page.goto(url, { waitUntil: 'load' });
    await graph(5, 4);
    assert.match(state(), /traceId=amount-final/);
    assert.equal(await page.getByLabel('Stage · Amount').inputValue(), 'selected');
    assert.match(await page.locator('.ge-trace-details summary').textContent(), /1 source boundary · 0 unknown/);
    assert.equal(await page.locator('.react-flow__node[data-id="operation"]').count(), 0);
    assert.equal(await page.locator('.react-flow__node[data-id="unrelated"]').count(), 0);
    report.checks.push('Standalone defaults to the authored stage and traces only explicit per-value edges');
    await page.getByLabel('Include controls', { exact: true }).check(); await graph(7, 6);
    await page.getByLabel('Include context', { exact: true }).check(); await graph(8, 7);
    assert.equal(await page.locator('.react-flow__node[data-id="unrelated"]').count(), 0);
    assert.equal(await page.locator('.react-flow__edge[data-id="legacy-output"]').count(), 0);
    await page.getByLabel('Include controls', { exact: true }).uncheck(); await graph(6, 5);
    await page.getByLabel('Include context', { exact: true }).uncheck(); await graph(5, 4);
    report.checks.push('Controls include their inputs; context adds one hop without promoting operation fan-in to value lineage');
    report.stage = 'stage and independent inspection';
    await page.getByLabel('Stage · Amount').selectOption('normalized'); await graph(3, 2);
    const normalizedUrl = page.url();
    await page.getByLabel('Stage · Amount').selectOption('selected'); await graph(5, 4);
    await page.goBack(); await graph(3, 2); assert.equal(page.url(), normalizedUrl);
    await page.goForward(); await graph(5, 4);
    await page.getByRole('button', { name: 'Fit all', exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const inspectCamera = await camera();
    await page.locator('.react-flow__node[data-id="source-value"]').click();
    await page.locator('.ge-inspector').getByRole('heading', { name: 'Source amount', exact: true }).waitFor();
    assert.match(state(), /traceId=amount-final/);
    assert.equal(await camera(), inspectCamera);
    await page.getByRole('searchbox', { name: /Find a variable/ }).fill('amount');
    await graph(5, 4); assert.equal(await camera(), inspectCamera);
    await page.getByRole('searchbox', { name: /Find a variable/ }).fill('');
    report.checks.push('Stages and history change trace root; record inspection and variable search preserve trace and camera');
    await page.screenshot({ path: join(runDirectory, 'lineage-desktop.png'), fullPage: true });
    report.stage = 'unknown mappings and cycles';
    await selectVariable('Unmapped amount'); await graph(1, 0);
    await page.locator('.ge-trace-details summary').click();
    await page.getByText('Per-output mapping has not been supplied.', { exact: true }).waitFor();
    await selectVariable('Undeclared origin'); await graph(1, 0);
    assert.match(await page.locator('.ge-trace-details summary').textContent(), /0 source boundaries · 1 unknown/);
    await selectVariable('Feedback value'); await graph(2, 2);
    assert.match(await page.locator('.ge-trace-details summary').textContent(), /1 cycle/);
    report.checks.push('Declared gaps, unannotated leaves and cyclic inputs remain explicitly unresolved');
    report.stage = 'whole graph and restored trace';
    await selectVariable('Amount'); await graph(5, 4);
    await page.getByRole('button', { name: 'Whole graph', exact: true }).click(); await graph(13, 11);
    assert.ok(!state().includes('traceId='));
    await page.reload(); await graph(13, 11);
    await page.goBack(); await graph(5, 4);
    report.checks.push('Whole graph restores every authored record/edge and persists on reload; Back restores value trace');
    report.stage = 'mobile trace navigation';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Browse', exact: true }).click();
    await page.getByRole('searchbox', { name: /Find a variable/ }).fill('unmapped');
    await selectVariable('Unmapped amount');
    await page.locator('.ge-main').waitFor({ state: 'visible' }); await graph(1, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    await page.locator('.ge-inspector').getByRole('heading', { name: 'Unmapped amount', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Graph', exact: true }).click(); await graph(1, 0);
    await page.screenshot({ path: join(runDirectory, 'lineage-mobile.png'), fullPage: true });
    assert.deepEqual(report.errors, []); assert.deepEqual(report.warnings, []);
    assert.ok(report.requests.every(request => request === url));
    report.checks.push('Mobile variable search opens the chosen trace, inspection stays available, and no external resources or browser errors occur');
    report.status = 'passed'; report.stage = 'complete';
  } catch (error) {
    failure = error; report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error);
    if (page) {
      report.url = page.url();
      await page.screenshot({ path: join(runDirectory, 'lineage-failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
    }
  } finally {
    await context?.close().catch(() => {}); await browser?.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  if (failure) throw new Error(`Packed lineage check failed during ${report.stage}: ${report.error}. Evidence: ${reportPath}`, { cause: failure });
  return { status: report.status, checks: report.checks, report: reportPath, htmlSha256: report.htmlSha256 };
}
