import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportGraphHtml, renderOfflineHtml, type StandaloneAssets } from '../src/export';
import type { GraphDocument, ReceiptAssessment } from '../src/core/types';

const assets: StandaloneAssets = { javascript: 'document.getElementById("root").textContent = "viewer";', css: 'html,body,#root{height:100%;margin:0}' };
const document: GraphDocument = { schemaVersion: 'graph-explorer/v1', id: 'test', title: 'Export test', nodes: [{ id: 'node', label: 'Record', kind: 'test', revision: 'rev-1' }], edges: [], artifacts: [{ id: 'artifact', label: 'Recorded file', sha256: 'a'.repeat(64) }], receipts: [{ id: 'receipt', label: 'Receipt reference', sha256: 'b'.repeat(64), artifactIds: ['artifact'], subjects: [{ type: 'node', id: 'node', revision: 'rev-1' }] }] };
const raw = JSON.stringify(document);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const report = (overrides: Partial<ReceiptAssessment> = {}) => JSON.stringify({ schemaVersion: 'graph-explorer/receipt-assessment/v1', assessments: [{ receiptId: 'receipt', status: 'verified', verifier: 'operator-test-verifier', scope: 'Fixture custody only', documentSha256: digest(raw), receiptSha256: 'b'.repeat(64), subjects: [{ type: 'node', id: 'node', revision: 'rev-1' }], artifacts: [{ id: 'artifact', sha256: 'a'.repeat(64) }], ...overrides }] });
const embedded = (html: string) => JSON.parse(html.match(/<script id="graph-explorer-data" type="application\/json">([\s\S]*?)<\/script>/)![1]);
const scratch: string[] = [];
afterEach(async () => { await Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('offline HTML export', () => {
  test('is deterministic and self-contained with exact raw-byte hashing', () => {
    const graph = `${raw}\n`;
    const first = renderOfflineHtml({ graph, assets });
    expect(first).toEqual(renderOfflineHtml({ graph: Buffer.from(graph), assets }));
    expect(first.documentSha256).toBe(digest(graph));
    expect(first.documentSha256).not.toBe(digest(raw));
    expect(first.html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|<iframe|<img/i);
    expect(first.html).toContain(`<style>${assets.css}</style>`);
    expect(first.bytes).toBe(Buffer.byteLength(first.html));
    expect(embedded(first.html).document).toEqual(document);
  });

  test('preserves malicious text without allowing HTML or script termination', () => {
    const text = '</script><script src="https://attacker.invalid/x">alert(1)</script><!--\u2028\u2029';
    const graph = JSON.stringify({ ...document, title: text, nodes: [{ id: 'node', revision: 'rev-1', kind: 'test', label: text, data: { formula: text } }] });
    const result = renderOfflineHtml({ graph, assets: { javascript: 'console.log("</script>");', css: 'body:after{content:"</style><img src=x>"}' } });
    expect(result.html.match(/<script\b/g)).toHaveLength(2);
    expect(result.html.match(/<\/script>/g)).toHaveLength(2);
    expect(result.html.match(/<\/style>/g)).toHaveLength(1);
    expect(result.html).not.toContain('<script src=');
    expect(embedded(result.html).document.nodes[0].data.formula).toBe(text);
    expect(result.html).toContain('\\u003c/script>');
  });

  test('includes a separately validated baseline', () => {
    const baseline = JSON.stringify({ ...document, title: 'Before' });
    expect(embedded(renderOfflineHtml({ graph: raw, baseline, assets }).html).baseline.title).toBe('Before');
    expect(() => renderOfflineHtml({ graph: raw, baseline: '{}', assets })).toThrow();
  });

  test('rejects invalid graph JSON and structural references', () => {
    expect(() => renderOfflineHtml({ graph: '{broken', assets })).toThrow();
    expect(() => renderOfflineHtml({ graph: JSON.stringify({ ...document, edges: [{ id: 'dangling', source: 'unknown', target: 'node', kind: 'dependency' }] }), assets })).toThrow('Unknown source node');
    expect(() => renderOfflineHtml({ graph: Buffer.from([0xff]), assets })).toThrow();
  });

  test('strips producer-supplied assessments from graph JSON', () => {
    const graph = JSON.stringify({ ...document, assessments: JSON.parse(report()).assessments });
    const payload = embedded(renderOfflineHtml({ graph, assets }).html);
    expect(payload.assessments).toBeUndefined();
    expect(payload.document.assessments).toBeUndefined();
  });

  test('accepts separately supplied assessments only for exact bytes and revisions', () => {
    const payload = embedded(renderOfflineHtml({ graph: raw, assessment: report(), assets }).html);
    expect(payload.assessments[0].status).toBe('verified');
    expect(() => renderOfflineHtml({ graph: `${raw}\n`, assessment: report(), assets })).toThrow('different graph bytes');
    expect(() => renderOfflineHtml({ graph: raw, assessment: report({ subjects: [{ type: 'node', id: 'node', revision: 'other' }] }), assets })).toThrow('exact subjects/artifacts');
    expect(() => renderOfflineHtml({ graph: raw, assessment: report({ receiptSha256: 'c'.repeat(64) }), assets })).toThrow('exact subjects/artifacts');
    expect(() => renderOfflineHtml({ graph: raw, assessment: report({ artifacts: [] }), assets })).toThrow('exact subjects/artifacts');
  });

  test('refuses malformed, duplicate, or unknown receipt assessments', () => {
    expect(() => renderOfflineHtml({ graph: raw, assessment: '{}', assets })).toThrow('Receipt bridge');
    expect(() => renderOfflineHtml({ graph: raw, assessment: report({ scope: '' }), assets })).toThrow('Malformed');
    expect(() => renderOfflineHtml({ graph: raw, assessment: report({ receiptId: 'unknown' }), assets })).toThrow('unknown receipt');
    const duplicate = JSON.parse(report()); duplicate.assessments.push(duplicate.assessments[0]);
    expect(() => renderOfflineHtml({ graph: raw, assessment: JSON.stringify(duplicate), assets })).toThrow('Duplicate');
  });

  test('filesystem export runs without source compilation and refuses input aliases', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-export-test-')); scratch.push(directory);
    const input = join(directory, 'graph.json'), output = join(directory, 'report.html'), assetsDirectory = join(directory, 'assets');
    await mkdir(assetsDirectory);
    await Promise.all([writeFile(input, raw), writeFile(join(assetsDirectory, 'viewer.js'), assets.javascript), writeFile(join(assetsDirectory, 'viewer.css'), assets.css)]);
    const summary = await exportGraphHtml({ input, output, assetsDirectory });
    expect(summary.documentSha256).toBe(digest(raw));
    expect(await readFile(output, 'utf8')).toBe(renderOfflineHtml({ graph: raw, assets }).html);
    await expect(exportGraphHtml({ input, output: input, assetsDirectory })).rejects.toThrow('overwrite an input');
    const hardlink = join(directory, 'hardlink.html'); await link(input, hardlink);
    await expect(exportGraphHtml({ input, output: hardlink, assetsDirectory })).rejects.toThrow('filesystem alias');
    const symbolic = join(directory, 'symlink.html'); await symlink(input, symbolic);
    await expect(exportGraphHtml({ input, output: symbolic, assetsDirectory })).rejects.toThrow('filesystem alias');
    await expect(exportGraphHtml({ input, output: join(assetsDirectory, 'viewer.js'), assetsDirectory })).rejects.toThrow('overwrite an input');
    expect(await readFile(input, 'utf8')).toBe(raw);
  });
});
