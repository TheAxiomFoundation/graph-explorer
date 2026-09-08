import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { webkit } from 'playwright';

const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
async function withDeadline(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

const buildScript = String.raw`
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Script } from 'node:vm';
import React from 'react';
assert.equal(React.version, '18.3.1');
const root = process.cwd();
const built = await Bun.build({
  entrypoints: ['host.tsx'], root, outdir: root, naming: 'host.bundle.[ext]',
  target: 'browser', format: 'iife', minify: true, metafile: true,
  jsx: { runtime: 'automatic', development: false },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production', PROD: true, DEV: false }),
  },
});
assert.ok(built.success, built.logs.map(String).join('\n'));
assert.ok(built.metafile);
const inputs = Object.keys(built.metafile.inputs);
assert.ok(inputs.some(input => input.includes('node_modules/@axiom-foundation/orrery/dist/react/')));
assert.ok(inputs.some(input => input.includes('node_modules/react/cjs/react.production.min.js')));
for (const input of inputs) assert.ok(resolve(root, input).startsWith(root + sep), 'Build escaped installed consumer: ' + input);
try { new Script(await readFile('host.bundle.js', 'utf8'), { filename: 'packed-react18-host.js' }); }
catch (error) { throw new Error('Packed host classic script failed to parse: ' + error.message); }
await writeFile('host-build.json', JSON.stringify({ react: React.version, inputs, classicScriptParsed: true }) + '\n');
`;

/** Exercise public host callbacks in the existing, isolated React 18 consumer. */
export async function checkPackedHost({ root, consumer, runDirectory }) {
  const reportPath = join(runDirectory, 'host-report.json');
  const report = { status: 'running', fixture: 'Synthetic host Locate fixture', checks: [], requests: [], console: [], pageErrors: [] };
  let browser, context, page, server;
  let failure;
  try {
    report.stage = 'build installed host fixture';
    const source = (await readFile(join(root, 'examples/locate.tsx'), 'utf8'))
      .replaceAll("'../src/react'", "'@axiom-foundation/orrery/react'")
      .replaceAll("'../src/core'", "'@axiom-foundation/orrery'")
      .replace("import '@xyflow/react/dist/style.css';\n", '')
      .replace("'../src/react/style.css'", "'@axiom-foundation/orrery/style.css'");
    assert.ok(!source.includes('../src/'), 'The browser fixture must import only public installed package entries');
    const originalHtml = await readFile(join(root, 'examples/locate.html'), 'utf8');
    assert.ok(originalHtml.includes('<script type="module" src="./locate.tsx"></script>'));
    const html = originalHtml.replace('<script type="module" src="./locate.tsx"></script>', '<script src="./host.bundle.js"></script>')
      .replace('</head>', '<link rel="stylesheet" href="./host.bundle.css"></head>');
    await writeFile(join(consumer, 'host.tsx'), source);
    await writeFile(join(consumer, 'host.html'), html);
    await writeFile(join(consumer, 'host-build.mjs'), buildScript);
    await execute('bun', ['host-build.mjs'], { cwd: consumer, env: { ...process.env, NODE_ENV: 'production' }, timeout: 60_000, maxBuffer: 1_000_000 });
    const built = JSON.parse(await readFile(join(consumer, 'host-build.json'), 'utf8'));
    report.react = built.react;
    report.buildInputs = built.inputs;
    report.checks.push('Production React18 host bundles only installed consumer dependencies through public package exports');

    const assets = new Map(await Promise.all([
      ['host.html', 'text/html; charset=utf-8'], ['host.bundle.js', 'text/javascript; charset=utf-8'], ['host.bundle.css', 'text/css; charset=utf-8'],
    ].map(async ([name, contentType]) => ['/' + name, { bytes: await readFile(join(consumer, name)), contentType }])));
    report.assetSha256 = Object.fromEntries([...assets].map(([name, asset]) => [name, hash(asset.bytes)]));
    server = createServer((request, response) => {
      const asset = assets.get(request.url);
      if (!asset) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': asset.contentType, 'Cache-Control': 'no-store' });
      response.end(asset.bytes);
    });
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    report.url = `${origin}/host.html`;
    browser = await webkit.launch({ headless: true });
    report.browserVersion = browser.version();
    context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = route.request().url();
      report.requests.push(url);
      return [...assets.keys()].some(path => url === origin + path) ? route.continue() : route.abort();
    });
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
    const readOutput = name => page.locator(`output[aria-label="${name}"]`).textContent();
    const navigation = async () => ({ location: await readOutput('Host location'), callbacks: await readOutput('Navigation count'), precise: await readOutput('Host precise selection'), url: page.url() });
    const camera = () => page.locator('.react-flow__viewport').getAttribute('style');
    const pane = () => page.locator('.ge-explorer').getAttribute('class');
    const settle = () => withDeadline(page.evaluate(() => new Promise(resolveFrames => requestAnimationFrame(() => requestAnimationFrame(resolveFrames)))), 2_000, 'Host canvas animation frames');
    const expectResult = value => page.waitForFunction(expected => document.querySelector('output[aria-label="Locate result"]')?.textContent === expected, value);
    const expectPane = value => page.waitForFunction(expected => document.querySelector('.ge-explorer')?.classList.contains(`ge-pane-${expected}`), value);
    const expectCentered = id => page.waitForFunction(target => {
      const canvas = document.querySelector('.ge-canvas')?.getBoundingClientRect();
      const node = document.querySelector(`.react-flow__node[data-id="${target}"]`);
      if (!canvas || !node || getComputedStyle(node).visibility !== 'visible') return false;
      const rect = node.getBoundingClientRect();
      return canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0
        && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
        && rect.left >= canvas.left - 1 && rect.right <= canvas.right + 1
        && rect.top >= canvas.top - 1 && rect.bottom <= canvas.bottom + 1
        && Math.abs(rect.x + rect.width / 2 - canvas.x - canvas.width / 2) <= 1
        && Math.abs(rect.y + rect.height / 2 - canvas.y - canvas.height / 2) <= 1;
    }, id);
    report.stage = 'initial installed host render';
    await page.goto(report.url, { waitUntil: 'load' });
    await page.getByRole('heading', { name: 'Host Locate fixture', level: 1, exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 2 && document.querySelectorAll('.react-flow__edge-path').length === 1);
    const initial = await navigation();
    assert.equal(initial.callbacks, '0');
    assert.equal(initial.precise, 'work.phase[0]');
    assert.equal(JSON.parse(initial.location).query, 'host-only query');
    report.initialNavigation = initial;
    const unchanged = async () => { await settle(); assert.deepEqual(await navigation(), initial, 'Locate must preserve location, callback count, precise host selection, and URL'); };

    report.stage = 'toolbar Locate and same-scene pan';
    await page.getByRole('button', { name: 'Locate program', exact: true }).click();
    await expectResult('program:true');
    await expectCentered('program');
    await unchanged();
    const centered = await camera();
    const canvas = await page.locator('.ge-canvas').boundingBox();
    assert.ok(canvas);
    await page.mouse.move(canvas.x + 25, canvas.y + 25);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 95, canvas.y + 65, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(previous => document.querySelector('.react-flow__viewport')?.getAttribute('style') !== previous, centered);
    await settle();
    const panned = await camera();
    await page.getByRole('button', { name: 'Remember Locate', exact: true }).click();
    await expectResult('remembered');
    await unchanged();
    assert.equal(await camera(), panned, 'An unrelated host rerender must preserve the current pan');
    await page.getByRole('button', { name: 'Locate program', exact: true }).click();
    await expectResult('program:true');
    await expectCentered('program');
    await unchanged();
    await page.screenshot({ path: join(runDirectory, 'host-desktop.png'), fullPage: true });
    report.checks.push('Toolbar Locate centers its requested node without navigation; pan survives a host rerender and repeated Locate recenters');

    report.stage = 'custom inspector Locate after hidden mobile resize';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Request Inspect', exact: true }).click();
    await expectPane('inspector');
    await page.setViewportSize({ width: 430, height: 740 });
    assert.equal(await page.locator('.ge-main').isVisible(), false);
    await page.getByRole('button', { name: 'Locate work', exact: true }).click();
    await expectResult('work:true');
    await expectPane('graph');
    await expectCentered('work');
    await unchanged();
    await page.screenshot({ path: join(runDirectory, 'host-mobile.png'), fullPage: true });
    report.checks.push('Custom inspector Locate reveals Graph and centers the target after resizing the hidden mobile canvas');

    report.stage = 'excluded and unknown Locate rejection';
    await page.getByRole('button', { name: 'Request Inspect', exact: true }).click();
    await expectPane('inspector');
    for (const [label, result] of [['Locate excluded detail', 'detail:false'], ['Locate missing', 'missing:false']]) {
      const before = { camera: await camera(), pane: await pane() };
      await page.getByRole('button', { name: label, exact: true }).click();
      await expectResult(result);
      await unchanged();
      assert.deepEqual({ camera: await camera(), pane: await pane() }, before, 'Rejected Locate must not move the camera or switch panels');
    }
    report.checks.push('Excluded and unknown IDs return false without changing camera, pane, or host navigation');

    report.stage = 'stale host callback rejection';
    await page.getByRole('button', { name: 'Remember Locate', exact: true }).click();
    await expectResult('remembered');
    await page.getByRole('button', { name: 'Hide program', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 1);
    await settle();
    const staleBefore = { camera: await camera(), pane: await pane() };
    await page.getByRole('button', { name: 'Call remembered Locate', exact: true }).click();
    await expectResult('remembered:false');
    await unchanged();
    assert.deepEqual({ camera: await camera(), pane: await pane() }, staleBefore, 'A previous scene callback must not move the camera or reveal Graph');
    // Work remains present in both projections. This isolates the stale-scene
    // guard from the separate rejection of program, which is now excluded.
    await page.getByRole('button', { name: 'Call remembered Locate for work', exact: true }).click();
    await expectResult('remembered-work:false');
    await unchanged();
    assert.deepEqual({ camera: await camera(), pane: await pane() }, staleBefore, 'A stale callback must reject even a target retained in the current scene');
    report.checks.push('A remembered callback from the previous projection returns false without moving the camera or changing the pane');

    const loadIndex = async (deep = false) => {
      await page.goto('about:blank');
      await page.goto(report.url + (deep ? '#index-deep' : '#index'), { waitUntil: 'load' });
      await page.getByRole('heading', { name: 'Index selection fixture', exact: true }).waitFor();
      await expectCentered('n0');
    };
    const indexState = () => withDeadline(page.evaluate(() => ({
      page: document.querySelector('.ge-index-pages span')?.textContent,
      selected: document.querySelector('.ge-index-list [aria-current="true"] small')?.textContent ?? null,
      rows: document.querySelectorAll('.ge-index-list > button').length,
      scroll: document.querySelector('.ge-index-list')?.scrollTop,
      camera: document.querySelector('.react-flow__viewport')?.getAttribute('style'),
      canvasNodes: document.querySelectorAll('.react-flow__node').length,
    })), 2_000, 'Index state');
    const expectIndexPage = async (label, selected) => {
      await page.waitForFunction(({ label, selected }) =>
        document.querySelector('.ge-index-pages span')?.textContent === label
        && (document.querySelector('.ge-index-list [aria-current="true"] small')?.textContent ?? null) === selected,
      { label, selected });
      const state = await indexState();
      assert.ok(state.rows <= 100);
      assert.equal(state.canvasNodes, 1, 'Index paging must retain the business canvas projection');
    };
    const externalIndexUpdate = async label => {
      const previous = Number(await readOutput('Index updates'));
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(expected => Number(document.querySelector('output[aria-label="Index updates"]')?.textContent) === expected, previous + 1);
      await settle();
      assert.equal(await readOutput('Index callbacks'), '0', 'External index updates must not emit navigation callbacks');
    };
    const setIndexScroll = async () => {
      // Let the page-change reveal finish before simulating a later user scroll.
      await settle();
      await withDeadline(page.evaluate(() => { document.querySelector('.ge-index-list').scrollTop = 150; }), 2_000, 'Index scroll');
      await settle();
      assert.equal((await indexState()).scroll, 150);
    };

    report.stage = 'equivalent kind filters reveal a changed desktop selection';
    await page.setViewportSize({ width: 1440, height: 960 });
    await loadIndex();
    await expectIndexPage('1–100 of 250 records', 'n0');
    const indexCamera = await camera();
    await externalIndexUpdate('Select last with fresh filter');
    await expectIndexPage('201–250 of 250 records', 'n249');
    assert.equal(await camera(), indexCamera);
    assert.equal(page.url(), report.url + '#index');
    await page.screenshot({ path: join(runDirectory, 'index-desktop.png'), fullPage: true });

    report.stage = 'equivalent filters retain manual pagination and scroll';
    await page.getByRole('button', { name: 'Previous records', exact: true }).click();
    await expectIndexPage('101–200 of 250 records', null);
    await setIndexScroll();
    let beforeIndex = await indexState();
    for (const label of ['Copy filter and change depth', 'Omit filter', 'Empty filter']) {
      await externalIndexUpdate(label);
      assert.deepEqual(await indexState(), beforeIndex, `${label} must preserve index page, scroll, and camera`);
    }
    assert.deepEqual(JSON.parse(await readOutput('Index location')).kinds, [], 'The raw host filter remains unchanged');
    await externalIndexUpdate('Both kinds');
    await expectIndexPage('1–100 of 250 records', null);
    await page.getByRole('button', { name: 'Next records', exact: true }).click();
    await expectIndexPage('101–200 of 250 records', null);
    await setIndexScroll();
    beforeIndex = await indexState();
    await externalIndexUpdate('Equivalent reordered kinds');
    assert.deepEqual(await indexState(), beforeIndex, 'Order and duplicate kinds must not reset the index');
    assert.deepEqual(JSON.parse(await readOutput('Index location')).kinds, ['detail', 'record', 'detail']);
    await externalIndexUpdate('Record kind only');
    await expectIndexPage('1–100 of 125 records', null);
    assert.equal(await camera(), indexCamera, 'A real index-only filter change must preserve the canvas camera');
    report.checks.push('Equivalent fresh, omitted/empty, reordered, and duplicate kind filters preserve selected-row paging and manual scroll; real filter changes reset page one');

    report.stage = 'equivalent filters reveal selection after hidden mobile Browse';
    await page.setViewportSize({ width: 390, height: 844 });
    await loadIndex();
    await expectPane('graph');
    const mobileIndexCamera = await camera();
    await externalIndexUpdate('Select last with fresh filter');
    await expectPane('inspector');
    await page.getByRole('button', { name: 'Browse', exact: true }).click();
    await expectIndexPage('201–250 of 250 records', 'n249');
    await page.waitForFunction(() => {
      const list = document.querySelector('.ge-index-list')?.getBoundingClientRect();
      const selected = document.querySelector('.ge-index-list [aria-current="true"]')?.getBoundingClientRect();
      return list && selected && list.height > 0 && selected.top >= list.top - 1 && selected.bottom <= list.bottom + 1;
    });
    assert.equal(await camera(), mobileIndexCamera);
    await page.screenshot({ path: join(runDirectory, 'index-mobile.png'), fullPage: true });
    await externalIndexUpdate('Select middle with fresh filter');
    await expectPane('inspector');
    await page.setViewportSize({ width: 1440, height: 960 });
    await expectIndexPage('101–200 of 250 records', 'n149');
    await page.waitForFunction(() => {
      const list = document.querySelector('.ge-index-list')?.getBoundingClientRect();
      const selected = document.querySelector('.ge-index-list [aria-current="true"]')?.getBoundingClientRect();
      return list && selected && list.height > 0 && selected.top >= list.top - 1 && selected.bottom <= list.bottom + 1;
    });
    assert.equal(await readOutput('Index callbacks'), '0');
    report.checks.push('Changed selection with an equivalent fresh filter reveals its page after mobile Browse returns or widens to desktop');

    report.stage = 'initial deep index selection';
    await loadIndex(true);
    await expectIndexPage('201–250 of 250 records', 'n249');
    assert.equal(await readOutput('Index callbacks'), '0');
    report.checks.push('Initial controlled deep links retain the selected later index page');
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.console, []);
    assert.ok(report.requests.every(url => [...assets.keys()].some(path => url === origin + path)), 'The host must load only its three served assets');
    report.status = 'passed';
    report.stage = 'complete';
  } catch (error) {
    failure = error;
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    if (page) {
      report.dom = await withDeadline(page.evaluate(() => ({
        pane: document.querySelector('.ge-explorer')?.className,
        canvas: document.querySelector('.ge-canvas')?.getBoundingClientRect().toJSON(),
        viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style'),
        outputs: [...document.querySelectorAll('output')].map(output => ({ label: output.getAttribute('aria-label'), text: output.textContent })),
        index: { page: document.querySelector('.ge-index-pages span')?.textContent,
          selected: document.querySelector('.ge-index-list [aria-current="true"] small')?.textContent,
          selectedBounds: document.querySelector('.ge-index-list [aria-current="true"]')?.getBoundingClientRect().toJSON(),
          listBounds: document.querySelector('.ge-index-list')?.getBoundingClientRect().toJSON(),
          scrollTop: document.querySelector('.ge-index-list')?.scrollTop,
          rows: document.querySelectorAll('.ge-index-list > button').length },
        nodes: [...document.querySelectorAll('.react-flow__node')].map(node => ({ id: node.getAttribute('data-id'), visibility: getComputedStyle(node).visibility, rect: node.getBoundingClientRect().toJSON() })),
      })), 2_000, 'Host failure diagnostics').catch(() => undefined);
      await page.screenshot({ path: join(runDirectory, 'host-failure.png'), fullPage: true, timeout: 5_000 }).catch(() => {});
    }
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (server) await new Promise(resolveClose => server.close(resolveClose));
    await writeJson(reportPath, report);
  }
  if (failure) throw new Error(`Packed host browser check failed during ${report.stage}: ${report.error}. Evidence: ${reportPath}`, { cause: failure });
  return { status: report.status, react: report.react, checks: report.checks, report: reportPath, assetSha256: report.assetSha256 };
}
