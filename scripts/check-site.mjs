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
const filesUnder = async directory => {
  const entries = await readdir(join(site, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesUnder(name));
    else { assert.ok(entry.isFile(), `Published asset is not a regular file: ${name}`); files.push(name); }
  }
  return files.sort();
};
const builtFiles = ['index.html', 'offline-shell.json', ...await filesUnder('assets'), ...await filesUnder('artifacts')];
const assetSha256 = Object.fromEntries(await Promise.all(builtFiles.map(async name => [name, createHash('sha256').update(await readFile(join(site, name))).digest('hex')])));
const report = { builtAssetSha256: assetSha256, checks: [], errors: [], errorContexts: [], warnings: [], externalRequests: [] };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/orrery/')) { response.writeHead(404); response.end(); return; }
    const relative = decodeURIComponent(url.pathname.slice('/orrery/'.length)) || 'index.html';
    const file = resolve(site, relative);
    if (!file.startsWith(`${site}/`)) { response.writeHead(403); response.end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : /\.(txt|yaml)$/.test(file) ? 'text/plain' : 'text/html');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
const url = `http://127.0.0.1:${server.address().port}/orrery/`;
const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
function monitor(page) {
  page.on('pageerror', error => { report.errors.push(error.message); report.errorContexts.push({ message: error.message, url: page.url(), afterCheck: report.checks.at(-1) }); });
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
const downloadGraph = async (page, name) => {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const file = join(output, name); await (await event).saveAs(file);
  return JSON.parse(await readFile(file, 'utf8'));
};
const checkCapturedReferences = async graph => {
  const sources = [...graph.nodes, ...graph.edges].flatMap(record => record.sources ?? []);
  const artifacts = graph.artifacts ?? [];
  assert.ok(artifacts.length > 0, 'The Mars graph must expose actual captured artifacts');
  for (const artifact of artifacts) {
    assert.equal(typeof artifact.uri, 'string', `Missing artifact URL: ${artifact.id}`);
    assert.ok(new URL(artifact.uri, url).pathname.startsWith('/orrery/artifacts/mars/'), `Artifact is not a published capture: ${artifact.uri}`);
    assert.match(artifact.sha256 ?? '', /^[a-f0-9]{64}$/);
  }
  const refs = [...artifacts.map(artifact => ({ url: artifact.uri, sha256: artifact.sha256 })), ...sources];
  let checked = 0;
  for (const ref of refs) {
    if (!ref.url) continue;
    const parsed = new URL(ref.url, url);
    if (!parsed.pathname.startsWith('/orrery/artifacts/mars/')) continue;
    const name = parsed.pathname.slice('/orrery/'.length);
    assert.match(ref.sha256 ?? '', /^[a-f0-9]{64}$/, `Missing declared digest: ${ref.url}`);
    assert.equal(assetSha256[name], ref.sha256, `Graph capture declaration differs from built bytes: ${name}`);
    const response = await fetch(new URL(name, url));
    assert.equal(response.status, 200, `Capture is not served: ${name}`);
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), ref.sha256);
    checked += 1;
  }
  assert.ok(checked >= artifacts.length);
  return checked;
};

try {
  const page = await context.newPage(); monitor(page);
  await page.goto(url); await canvasReady(page);
  assert.equal(await page.title(), 'Orrery, by Axiom — See the system. Trace the work.');
  assert.equal(await page.locator('#example-picker').inputValue(), 'mars');
  assert.equal(await page.locator('.answer-question h2').innerText(), 'How long would a message take to reach Mars?');
  assert.match(await page.locator('.answer-question p').innerText(), /One-way light travel estimate/);
  assert.equal(await page.locator('.answer-approximation').innerText(), 'About');
  assert.equal(await page.locator('.answer-value').innerText(), '15 min 4 sec');
  assert.match(await page.locator('.answer-date').innerText(), /2026/);
  assert.doesNotMatch(await page.locator('.example-caveat summary').innerText(), /review issues/);
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  assert.equal(await page.locator('.ge-inspector-body h3').innerText(), 'Changed');
  assert.match(await page.locator('.ge-inspector-body').innerText(), /Previous record/);
  await page.getByRole('tab', { name: 'Record', exact: true }).click();
  const marsGraph = await downloadGraph(page, 'mars-current.json');
  assert.equal(marsGraph.nodes.length, 10);
  assert.equal(marsGraph.edges.length, 11);
  assert.equal(marsGraph.artifacts.length, 19);
  assert.ok(marsGraph.activities.length > 0);
  const referencesChecked = await checkCapturedReferences(marsGraph);
  const firstAnswer = await page.locator('.answer-value').innerText();
  const firstSelection = await page.locator('.ge-inspector-heading .ge-record-id').innerText();
  mark(`Mars is the neutral default with an approximate one-way answer, ${marsGraph.nodes.length} nodes and ${referencesChecked} matching captured-byte references`);

  await page.locator('.recorded-dates button[data-example="mars-comparison"]').focus();
  await page.keyboard.press('Enter'); await canvasReady(page);
  assert.equal(await page.locator('.recorded-dates button[data-example="mars-comparison"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#example-picker').inputValue(), 'mars-comparison');
  assert.equal(await page.locator('.answer-value').innerText(), '5 min 21 sec');
  assert.match(await page.locator('.answer-date').innerText(), /2025/);
  assert.equal(await page.locator('.ge-inspector-heading .ge-record-id').innerText(), firstSelection);
  const comparisonGraph = await downloadGraph(page, 'mars-comparison.json');
  assert.equal(comparisonGraph.nodes.length, 10);
  assert.equal(comparisonGraph.edges.length, 11);
  assert.equal(comparisonGraph.artifacts.length, 19);
  await checkCapturedReferences(comparisonGraph);
  assert.deepEqual(comparisonGraph.nodes.map(node => node.id), marsGraph.nodes.map(node => node.id));
  await page.goBack(); await canvasReady(page);
  assert.equal(await page.locator('#example-picker').inputValue(), 'mars');
  assert.equal(await page.locator('.answer-value').innerText(), firstAnswer);
  mark('Two date epochs change the answer, preserve native IDs and show revision History; Back restores the first date');

  await page.selectOption('#example-picker', 'thesis'); await canvasReady(page);
  assert.match(await page.locator('.example-caveat summary').innerText(), /source-review issues remain/);
  assert.match(await page.locator('.ge-document-meta').innerText(), /44 records.*87 relationships/s);
  assert.equal(await page.locator('.ge-index-list > button').count(), 44);
  await page.screenshot({ path: join(output, 'desktop-thesis.png'), fullPage: true, animations: 'disabled' });
  mark('Public Thesis graph: native 44/87 records, visible unresolved-review label, bounded index, relative deployment path');

  await page.getByRole('button', { name: /Read the unresolved review/ }).click();
  await page.waitForFunction(() => document.querySelector('.ge-inspector-heading h2')?.textContent?.includes('Revised review'));
  const reviewUrl = page.url();
  const legacy = await context.newPage(); monitor(legacy);
  await legacy.goto(`${url}${new URL(reviewUrl).hash}`); await canvasReady(legacy);
  assert.equal(await legacy.locator('#example-picker').inputValue(), 'thesis');
  assert.equal(new URL(legacy.url()).searchParams.get('example'), 'thesis');
  assert.equal(new URL(legacy.url()).hash, new URL(reviewUrl).hash);
  assert.match(await legacy.locator('.ge-inspector-heading h2').innerText(), /Revised review/);
  await legacy.reload(); await canvasReady(legacy);
  assert.equal(await legacy.locator('#example-picker').inputValue(), 'thesis');
  const thesisGraph = await downloadGraph(legacy, 'thesis-legacy.json');
  const edgeLocation = new URLSearchParams({ selectedId: thesisGraph.edges[0].id, selectedType: 'edge' });
  await legacy.goto(`${url}#${edgeLocation}`); await canvasReady(legacy);
  assert.equal(await legacy.locator('#example-picker').inputValue(), 'thesis');
  assert.equal(await legacy.locator('.ge-inspector-heading .ge-record-id').innerText(), thesisGraph.edges[0].id);
  mark('Legacy Thesis node and edge hashes infer the correct dataset and canonicalize without losing selection');
  await legacy.goto(`${url}#query=2024&depth=2&showContainment=false`); await canvasReady(legacy);
  assert.equal(await legacy.locator('#example-picker').inputValue(), 'thesis');
  assert.equal(await legacy.getByRole('searchbox', { name: /Find a record/ }).inputValue(), '2024');
  assert.equal(new URL(legacy.url()).searchParams.get('example'), 'thesis');
  await legacy.selectOption('#example-picker', 'mars'); await canvasReady(legacy);
  await legacy.goBack(); await canvasReady(legacy);
  assert.equal(await legacy.locator('#example-picker').inputValue(), 'thesis');
  assert.equal(await legacy.getByRole('searchbox', { name: /Find a record/ }).inputValue(), '2024');
  mark('Legacy search/view-only hashes retain the previous Thesis default, including Back after switching to Mars');
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
  // Hold real File.text() results so intent ordering is tested deterministically.
  await page.evaluate(() => {
    const nativeText = File.prototype.text;
    globalThis.__orreryPendingReads = new Map();
    File.prototype.text = async function () {
      const text = await nativeText.call(this);
      if (!this.name.startsWith('delayed-')) return text;
      return new Promise(resolveRead => globalThis.__orreryPendingReads.set(this.name, () => resolveRead(text)));
    };
  });
  const delayedGraph = title => ({ schemaVersion: 'graph-explorer/v1', id: title, title, nodes: [{ id: 'one', kind: 'fixture', label: title }], edges: [] });
  const holdRead = async (name, bytes) => {
    await upload.setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(bytes) });
    await page.waitForFunction(key => globalThis.__orreryPendingReads.has(key), name);
  };
  const releaseRead = async name => {
    await page.evaluate(key => { globalThis.__orreryPendingReads.get(key)(); globalThis.__orreryPendingReads.delete(key); }, name);
    await settled(page);
  };
  await holdRead('delayed-example.json', JSON.stringify(delayedGraph('Superseded by example')));
  await page.selectOption('#example-picker', 'axiom');
  const chosenExampleUrl = page.url();
  await releaseRead('delayed-example.json');
  assert.equal(await page.locator('#example-picker').inputValue(), 'axiom');
  assert.equal(page.url(), chosenExampleUrl);
  await holdRead('delayed-invalid.json', '{ invalid');
  await page.selectOption('#example-picker', 'source');
  await releaseRead('delayed-invalid.json');
  assert.equal(await page.getByRole('alert').count(), 0);
  mark('Delayed successful or invalid file reads cannot replace a newer example choice or its error state');

  await holdRead('delayed-older.json', JSON.stringify(delayedGraph('Older import')));
  await holdRead('delayed-newer.json', JSON.stringify(delayedGraph('Newer import')));
  await releaseRead('delayed-older.json');
  assert.equal(await page.getByRole('button', { name: /Opening/ }).isDisabled(), true);
  assert.equal(await page.locator('#example-picker').inputValue(), 'source');
  await releaseRead('delayed-newer.json');
  await page.waitForFunction(() => document.querySelector('.ge-brand h1')?.textContent === 'Newer import');
  assert.match(await page.locator('#example-picker').innerText(), /delayed-newer.json/);
  mark('A newer import supersedes an older read; the old completion cannot clear the newer loading state');

  await page.selectOption('#example-picker', 'axiom');
  await page.selectOption('#example-picker', 'source');
  await holdRead('delayed-history.json', JSON.stringify(delayedGraph('Superseded by history')));
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#example-picker')?.value === 'axiom');
  const historyUrl = page.url();
  await releaseRead('delayed-history.json');
  assert.equal(await page.locator('#example-picker').inputValue(), 'axiom');
  assert.equal(page.url(), historyUrl);
  await page.selectOption('#example-picker', 'source');
  mark('Browser history navigation cancels a pending file import without changing the restored URL');

  await upload.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{ nope') });
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /not valid JSON/);
  assert.match(await page.locator('.ge-document-meta').innerText(), /6 records/);
  mark('Invalid local JSON reports a readable error and preserves the open graph');

  const invalidGraph = { schemaVersion: 'graph-explorer/v1', id: 'invalid-many-issues', title: 'Invalid graph', nodes: Array.from({ length: 120 }, (_, index) => ({ id: `node-${index}-${'x'.repeat(300)}` })), edges: [] };
  await upload.setInputFiles({ name: 'many-issues.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalidGraph)) });
  const banner = page.locator('.site-error');
  await page.waitForFunction(() => document.querySelector('.site-error')?.textContent?.includes('240 validation issues'));
  const errorText = await banner.innerText();
  assert.match(errorText, /And 235 more/);
  assert.match(errorText, /\.label: Expected a nonempty string/);
  assert.ok(errorText.length < 1100);
  assert.ok((await banner.boundingBox()).height <= 200);
  await page.screenshot({ path: join(output, 'validation-error.png'), animations: 'disabled' });
  assert.match(await page.locator('.ge-document-meta').innerText(), /6 records/);
  mark('Validation errors show five shortened issues plus the omitted count in a bounded banner');

  const hostile = '</title><script>globalThis.__orreryInjected = true</script></script><img src="https://example.invalid/probe" onerror="globalThis.__orreryInjected=true">';
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
  assert.equal(await offline.title(), `${graph.title} · Orrery`);
  assert.equal(await offline.locator('.react-flow__node').count(), 2);
  assert.equal(await offline.evaluate(() => globalThis.__orreryInjected), undefined);
  await offline.locator('.ge-index-list > button').filter({ hasText: 'Locally imported output' }).click();
  await offline.getByRole('tab', { name: 'Receipts', exact: true }).click();
  assert.match(await offline.locator('.ge-inspector-body').innerText(), /Not verified/);
  await offline.screenshot({ path: join(output, 'offline.png'), animations: 'disabled' });
  mark('Actual downloaded file:// HTML uses the graph title safely and supports selection and unverified Receipt inspection without network assets');

  await page.reload(); await canvasReady(page);
  assert.match(await page.locator('.status-message').innerText(), /Open your graph JSON again/);
  assert.equal(new URL(page.url()).searchParams.get('example'), 'mars');
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('selectedId'), await page.locator('.ge-inspector-heading .ge-record-id').innerText());
  await page.getByLabel('Open a local graph JSON file').setInputFiles({ name: 'after-reload.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(secondGraph)) });
  await page.waitForFunction(() => document.querySelector('.ge-brand h1')?.textContent === 'A different local graph');
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('Open your graph JSON again'));
  assert.match(await page.locator('.ge-document-meta').innerText(), new RegExp(`${marsGraph.nodes.length} records`));
  assert.notEqual(await page.locator('.ge-brand h1').innerText(), 'A different local graph');
  assert.equal(new URL(page.url()).searchParams.get('example'), 'mars');
  mark('After reload and Back, expired local links show the reminder and a canonical URL matching the public fallback');

  const directLocal = await context.newPage(); monitor(directLocal);
  await directLocal.goto(`${url}?example=local#selectedId=unknown-private-id`); await canvasReady(directLocal);
  assert.match(await directLocal.locator('.status-message').innerText(), /Open your graph JSON again/);
  assert.equal(new URL(directLocal.url()).searchParams.get('example'), 'mars');
  assert.equal(new URLSearchParams(new URL(directLocal.url()).hash.slice(1)).get('selectedId'), await directLocal.locator('.ge-inspector-heading .ge-record-id').innerText());
  assert.equal(await directLocal.evaluate(() => window.history.state.orreryLocalId), undefined);
  mark('A direct unknown local URL replaces stale navigation with the rendered public example while keeping the re-open reminder');

  const retention = await context.newPage(); monitor(retention);
  await retention.goto(url); await canvasReady(retention);
  for (let index = 0; index < 6; index += 1) {
    const title = `Retained import ${index}`;
    await retention.getByLabel('Open a local graph JSON file').setInputFiles({ name: `retained-${index}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(delayedGraph(title))) });
    await retention.waitForFunction(expected => document.querySelector('.ge-brand h1')?.textContent === expected, title);
  }
  for (let index = 4; index >= 1; index -= 1) {
    await retention.goBack();
    await retention.waitForFunction(expected => document.querySelector('.ge-brand h1')?.textContent === expected, `Retained import ${index}`);
  }
  const historyLength = await retention.evaluate(() => window.history.length);
  await retention.goBack();
  await retention.waitForFunction(() => document.querySelector('.status-message')?.textContent?.includes('Open your graph JSON again'));
  assert.equal(new URL(retention.url()).searchParams.get('example'), 'mars');
  assert.match(await retention.locator('.ge-document-meta').innerText(), new RegExp(`${marsGraph.nodes.length} records`));
  assert.equal(await retention.evaluate(() => window.history.length), historyLength);
  await retention.goForward();
  await retention.waitForFunction(() => document.querySelector('.ge-brand h1')?.textContent === 'Retained import 1');
  assert.equal(await retention.locator('.status-message').innerText(), '');
  mark('Only the last five imports remain available; evicted history safely falls back without adding history, and retained Forward restores its file');

  const mobile = await context.newPage(); monitor(mobile);
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.emulateMedia({ reducedMotion: 'reduce' });
  await mobile.goto(url); await canvasReady(mobile);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await mobile.locator('#example-picker').inputValue(), 'mars');
  assert.equal(await mobile.locator('.answer-value').innerText(), firstAnswer);
  assert.equal(await mobile.locator('.hero').evaluate(element => getComputedStyle(element).animationName), 'none');
  await mobile.locator('.walkthrough button[data-selected-id="mars-signal/answer"]').click();
  await mobile.waitForFunction(() => document.querySelector('.ge-explorer')?.classList.contains('ge-pane-inspector'));
  await mobile.getByRole('button', { name: 'Graph', exact: true }).click(); await canvasReady(mobile);
  const sameAnswerUrl = mobile.url();
  await mobile.locator('.walkthrough button[data-selected-id="mars-signal/answer"]').click();
  await mobile.waitForFunction(() => document.querySelector('.ge-explorer')?.classList.contains('ge-pane-inspector'));
  assert.equal(mobile.url(), sameAnswerUrl);
  await mobile.locator('.recorded-dates button[data-example="mars-comparison"]').click(); await canvasReady(mobile);
  assert.notEqual(await mobile.locator('.answer-value').innerText(), firstAnswer);
  await mobile.locator('.walkthrough button[data-selected-id="mars-signal/horizons"]').click();
  await mobile.waitForFunction(() => document.querySelector('.ge-explorer')?.classList.contains('ge-pane-inspector'));
  assert.equal(await mobile.locator('.ge-inspector-heading .ge-record-id').innerText(), 'mars-signal/horizons');
  await mobile.getByRole('button', { name: 'Graph', exact: true }).click(); await canvasReady(mobile);
  await mobile.screenshot({ path: join(output, 'mobile.png'), fullPage: true, animations: 'disabled' });
  mark('Mars mobile question/answer/date controls and source inspection work without overflow and respect reduced motion');
  await mobile.selectOption('#example-picker', 'thesis'); await canvasReady(mobile);
  await mobile.getByRole('button', { name: /Read the unresolved review/ }).click();
  await mobile.waitForFunction(() => document.querySelector('.ge-explorer')?.classList.contains('ge-pane-inspector'));
  await mobile.getByRole('button', { name: 'Graph', exact: true }).click(); await canvasReady(mobile);
  await mobile.screenshot({ path: join(output, 'mobile-thesis.png'), fullPage: true, animations: 'disabled' });
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
