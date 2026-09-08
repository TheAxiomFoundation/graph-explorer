import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { webkit } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site-dist');
await mkdir(join(root, 'output/playwright'), { recursive: true });
const output = await mkdtemp(join(root, 'output/playwright/site-'));
const builtFiles = ['index.html', 'offline-shell.json', ...(await readdir(join(site, 'assets'))).sort().map(name => `assets/${name}`)];
const assetSha256 = Object.fromEntries(await Promise.all(builtFiles.map(async name => [name, createHash('sha256').update(await readFile(join(site, name))).digest('hex')])));
const report = { builtAssetSha256: assetSha256, checks: [], errors: [], warnings: [], externalRequests: [] };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/orrery/')) { response.writeHead(404); response.end(); return; }
    const relative = decodeURIComponent(url.pathname.slice('/orrery/'.length)) || 'index.html';
    const file = resolve(site, relative);
    if (!file.startsWith(`${site}/`)) { response.writeHead(403); response.end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
const url = `http://127.0.0.1:${server.address().port}/orrery/`;
const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
function monitor(page) {
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning') report.warnings.push(message.text()); if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(url)) report.externalRequests.push(request.url()); });
}
const mark = value => report.checks.push(value);
const settled = page => page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
const canvasReady = async page => {
  await page.locator('.react-flow__node').first().waitFor({ state: 'attached' });
  await page.waitForFunction(() => {
    const pane = document.querySelector('.ge-canvas');
    const viewport = document.querySelector('.react-flow__viewport');
    return pane && pane.getBoundingClientRect().width > 0 && pane.getBoundingClientRect().height > 0 && viewport && !viewport.getAttribute('style')?.includes('NaN');
  });
  await settled(page);
};

try {
  const page = await context.newPage(); monitor(page);
  await page.goto(url); await canvasReady(page);
  assert.equal(await page.title(), 'Orrery, by Axiom — See the system. Trace the work.');
  assert.match(await page.locator('.example-caveat summary').innerText(), /source-review issues remain/);
  assert.match(await page.locator('.ge-document-meta').innerText(), /44 records.*84 relationships/s);
  assert.equal(await page.locator('.ge-index-list > button').count(), 44);
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true, animations: 'disabled' });
  mark('Public Thesis graph: native 44/84 records, visible unresolved-review label, bounded index, relative deployment path');

  await page.getByRole('button', { name: /Read the unresolved review/ }).click();
  await page.waitForFunction(() => document.querySelector('.ge-inspector-heading h2')?.textContent?.includes('Revised review'));
  const reviewUrl = page.url();
  await page.getByRole('button', { name: /Compare the two attempts/ }).click();
  await page.waitForFunction(() => document.querySelector('.ge-inspector-heading h2')?.textContent?.includes('Original → revised comparison'));
  await page.goBack();
  assert.equal(page.url(), reviewUrl);
  await page.waitForFunction(() => document.querySelector('.ge-inspector-heading h2')?.textContent?.includes('Revised review'));
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  assert.match(await page.locator('.ge-inspector-body').innerText(), /Added|baseline|snapshot|revision/i);
  mark('Guided review/comparison navigation, browser Back, and baseline History');

  await page.selectOption('#example-picker', 'axiom'); await canvasReady(page);
  assert.match(await page.locator('.example-context').innerText(), /actual compiled Axiom/);
  await page.selectOption('#example-picker', 'source'); await canvasReady(page);
  assert.match(await page.locator('.ge-document-meta').innerText(), /6 records.*9 relationships/s);
  mark('Axiom compiled-artifact and Thesis source-replay examples remain available');

  const upload = page.getByLabel('Open a local graph JSON file');
  await upload.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{ nope') });
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /not valid JSON/);
  assert.match(await page.locator('.ge-document-meta').innerText(), /6 records/);
  mark('Invalid local JSON reports a readable error and preserves the open graph');

  const hostile = '</script><script>globalThis.__orreryInjected = true</script><img src="https://example.invalid/probe" onerror="globalThis.__orreryInjected=true">';
  const graph = {
    schemaVersion: 'graph-explorer/v1', id: 'site-hostile-fixture', title: hostile,
    nodes: [{ id: 'input', kind: 'fixture', label: hostile }, { id: 'output', kind: 'fixture', label: 'Locally imported output', description: hostile }],
    edges: [{ id: 'edge', source: 'input', target: 'output', kind: 'dependency', label: hostile }],
    receipts: [{ id: 'fixture-receipt', label: 'Synthetic unverified declaration', subjects: [{ type: 'node', id: 'output' }], sha256: 'a'.repeat(64) }],
    assessments: [{ receiptId: 'fixture-receipt', status: 'verified' }],
  };
  const { assessments: untrustedAssessment, ...portableGraph } = graph;
  await upload.setInputFiles({ name: 'local-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(graph)) });
  await page.waitForFunction(() => document.querySelector('.ge-document-meta')?.textContent?.includes('2 records'));
  await canvasReady(page);
  assert.match(await page.locator('.status-message').innerText(), /Nothing was uploaded/);
  assert.equal(await page.evaluate(() => globalThis.__orreryInjected), undefined);
  await page.locator('.ge-index-list > button').filter({ hasText: 'Locally imported output' }).click();
  await page.getByRole('tab', { name: 'Receipts', exact: true }).click();
  assert.match(await page.locator('.ge-inspector-body').innerText(), /Not verified/);
  assert.equal(await page.locator('.ge-inspector-body').getByText('Verified', { exact: true }).count(), 0);
  mark('Local import retains literal hostile strings and does not inherit graph-supplied verification');

  // Import identities isolate even files that declare the same native graph ID.
  const secondGraph = { schemaVersion: 'graph-explorer/v1', id: graph.id, title: 'A different local graph', nodes: [{ id: 'another', kind: 'fixture', label: 'Another local record' }], edges: [] };
  await upload.setInputFiles({ name: 'second-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(secondGraph)) });
  await page.waitForFunction(() => document.querySelector('.ge-brand h1')?.textContent === 'A different local graph');
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.ge-document-meta')?.textContent?.includes('2 records'));
  assert.equal(await page.locator('#example-picker').inputValue(), 'local');
  assert.match(await page.locator('#example-picker').innerText(), /local-fixture.json/);
  assert.equal(await page.locator('.ge-inspector-heading h2').innerText(), 'Locally imported output');
  assert.match(page.url(), /selectedId=output/);
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('.ge-brand h1')?.textContent === 'A different local graph');
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.ge-document-meta')?.textContent?.includes('2 records'));
  mark('Two local imports with the same declared graph ID restore the correct document, filename and selection on Back and Forward');

  const jsonDownloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const jsonDownload = await jsonDownloadEvent;
  const jsonPath = join(output, 'local-graph.json'); await jsonDownload.saveAs(jsonPath);
  assert.deepEqual(JSON.parse(await readFile(jsonPath, 'utf8')), portableGraph);
  const htmlDownloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: /Save offline report/ }).click();
  const htmlDownload = await htmlDownloadEvent;
  const htmlPath = join(output, 'local-report.html'); await htmlDownload.saveAs(htmlPath);
  const html = await readFile(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 2);
  const embedded = scripts.find(match => match[1].includes('application/json'));
  const payload = JSON.parse(embedded[2]);
  assert.deepEqual(payload.document, portableGraph);
  assert.equal(payload.assessments, undefined);
  assert.match(payload.documentSha256, /^[a-f0-9]{64}$/);
  assert.equal(html.includes(hostile), false);
  for (const script of scripts.filter(match => !match[1].includes('application/json'))) new Script(script[2]);
  mark('JSON download preserves portable graph and omits untrusted assessments; offline HTML safely escapes closing tags and parses as a classic script');

  // The actual downloaded report is opened directly, not regenerated by the test.
  const offline = await context.newPage(); monitor(offline);
  await offline.goto(pathToFileURL(htmlPath).href); await canvasReady(offline);
  assert.equal(await offline.locator('.react-flow__node').count(), 2);
  assert.equal(await offline.evaluate(() => globalThis.__orreryInjected), undefined);
  await offline.locator('.ge-index-list > button').filter({ hasText: 'Locally imported output' }).click();
  await offline.getByRole('tab', { name: 'Receipts', exact: true }).click();
  assert.match(await offline.locator('.ge-inspector-body').innerText(), /Not verified/);
  await offline.screenshot({ path: join(output, 'offline.png'), animations: 'disabled' });
  mark('Actual downloaded file:// HTML renders and supports selection and unverified Receipt inspection without network assets');

  await page.reload(); await canvasReady(page);
  assert.match(await page.locator('.status-message').innerText(), /Open your graph JSON again/);
  await page.getByLabel('Open a local graph JSON file').setInputFiles({ name: 'after-reload.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(secondGraph)) });
  await page.waitForFunction(() => document.querySelector('.ge-brand h1')?.textContent === 'A different local graph');
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('Open your graph JSON again'));
  assert.match(await page.locator('.ge-document-meta').innerText(), /44 records/);
  assert.notEqual(await page.locator('.ge-brand h1').innerText(), 'A different local graph');
  mark('After reload, stale local-history entries show the re-open reminder and cannot alias a newly imported file');

  const mobile = await context.newPage(); monitor(mobile);
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(url); await canvasReady(mobile);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await mobile.getByRole('button', { name: /Read the unresolved review/ }).click();
  await mobile.waitForFunction(() => document.querySelector('.ge-explorer')?.classList.contains('ge-pane-inspector'));
  await mobile.getByRole('button', { name: 'Graph', exact: true }).click(); await canvasReady(mobile);
  await mobile.screenshot({ path: join(output, 'mobile.png'), fullPage: true, animations: 'disabled' });
  await mobile.getByRole('button', { name: 'Browse', exact: true }).click();
  await mobile.getByRole('searchbox', { name: /Find a record/ }).fill('2024');
  assert.ok(await mobile.locator('.ge-index-list > button').count() > 0);
  mark('390px mobile layout: no horizontal overflow, guided selection reveals Inspect, Graph/Browse/search operate');

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.externalRequests, []);
  report.passed = true;
  console.log(`Orrery public site passed ${report.checks.length} browser checks. Evidence: ${output}`);
} catch (error) {
  report.passed = false; report.failure = error.stack ?? String(error);
  throw error;
} finally {
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close(); await new Promise(resolveClosed => server.close(resolveClosed));
}
