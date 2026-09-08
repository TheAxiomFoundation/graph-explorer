import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getReceiptAssessment } from './core/graph.js';
import { isReceiptAssessment, parseGraphDocument } from './core/validate.js';
import type { GraphDocument, ReceiptAssessment, SubjectRef } from './core/types.js';

export interface StandaloneAssets { javascript: string; css: string }
export interface OfflineHtmlInput {
  /** Exact JSON bytes, hashed without rewriting. */
  graph: string | Uint8Array;
  baseline?: string | Uint8Array;
  /** Separately supplied operator/verifier report, never extracted from graph JSON. */
  assessment?: string | Uint8Array;
  assets: StandaloneAssets;
}
export interface OfflineHtmlResult { html: string; documentSha256: string; nodes: number; edges: number; bytes: number; offline: true }
export interface ExportGraphOptions {
  input: string; output: string; baseline?: string; assessment?: string;
  /** Host-controlled override for custom distributions. */
  assetsDirectory?: string | URL;
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bytesOf = (value: string | Uint8Array) => typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
const jsonOf = (value: string | Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytesOf(value)));
const htmlEscape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const jsonEscape = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function assessmentsFrom(raw: string | Uint8Array, document: GraphDocument, digest: string): ReceiptAssessment[] {
  const report = jsonOf(raw);
  if (!object(report) || report.schemaVersion !== 'graph-explorer/receipt-assessment/v1' || !Array.isArray(report.assessments)) throw new Error('Expected a Receipt bridge assessment report');
  const seen = new Set<string>();
  const parsed = report.assessments.map((item: unknown): ReceiptAssessment => {
    if (!isReceiptAssessment(item)) throw new Error('Malformed Receipt assessment');
    if (item.documentSha256 !== digest) throw new Error('Assessment belongs to different graph bytes');
    if (seen.has(item.receiptId)) throw new Error(`Duplicate assessment for receipt ${item.receiptId}`);
    seen.add(item.receiptId);
    if (!document.receipts?.some(receipt => receipt.id === item.receiptId)) throw new Error(`Assessment references unknown receipt ${item.receiptId}`);
    if (item.checkedAt !== undefined && (!nonempty(item.checkedAt) || !Number.isFinite(Date.parse(item.checkedAt)))) throw new Error('Assessment checkedAt must be a timestamp');
    return {
      receiptId: item.receiptId, verifier: item.verifier, scope: item.scope,
      status: item.status as ReceiptAssessment['status'], documentSha256: digest,
      ...(item.receiptSha256 !== undefined ? { receiptSha256: item.receiptSha256 as string } : {}),
      ...(item.subjects !== undefined ? { subjects: item.subjects as SubjectRef[] } : {}),
      ...(item.artifacts !== undefined ? { artifacts: item.artifacts as { id: string; sha256: string }[] } : {}),
      ...(item.checkedAt !== undefined ? { checkedAt: item.checkedAt as string } : {}),
      ...(item.detail !== undefined ? { detail: item.detail as string } : {}),
      ...(item.reportUri !== undefined ? { reportUri: item.reportUri as string } : {}),
    };
  });
  for (const item of parsed) {
    const receipt = document.receipts!.find(receipt => receipt.id === item.receiptId)!;
    if (item.status === 'verified' && !getReceiptAssessment(document, receipt, [item], digest)) throw new Error(`Verified assessment does not bind receipt ${item.receiptId} and its exact subjects/artifacts`);
  }
  return parsed;
}

/** Deterministic self-contained HTML; assets come from the trusted package/host. */
export function renderOfflineHtml(input: OfflineHtmlInput): OfflineHtmlResult {
  const document = parseGraphDocument(jsonOf(input.graph));
  const documentSha256 = createHash('sha256').update(bytesOf(input.graph)).digest('hex');
  const baseline = input.baseline === undefined ? undefined : parseGraphDocument(jsonOf(input.baseline));
  const assessments = input.assessment === undefined ? undefined : assessmentsFrom(input.assessment, document, documentSha256);
  if (!nonempty(input.assets.javascript) || typeof input.assets.css !== 'string') throw new Error('Standalone viewer assets are missing; build the package before exporting');
  const css = input.assets.css.replace(/<\/style/gi, '<\\/style');
  const javascript = input.assets.javascript.replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${htmlEscape(document.title)} · Orrery</title>\n<style>${css}</style></head><body><div id="root"></div>\n<script id="graph-explorer-data" type="application/json">${jsonEscape({ document, baseline, assessments, documentSha256 })}</script>\n<script>${javascript}</script></body></html>\n`;
  return { html, documentSha256, nodes: document.nodes.length, edges: document.edges.length, bytes: Buffer.byteLength(html), offline: true };
}

function assetDirectory(directory?: string | URL): string {
  return directory instanceof URL ? fileURLToPath(directory) : directory ? resolve(directory) : fileURLToPath(new URL('./standalone/', import.meta.url));
}

export async function readStandaloneAssets(directory?: string | URL): Promise<StandaloneAssets> {
  const root = assetDirectory(directory);
  const [javascript, css] = await Promise.all([readFile(join(root, 'viewer.js'), 'utf8'), readFile(join(root, 'viewer.css'), 'utf8')]);
  return { javascript, css };
}

async function distinctOutput(output: string, inputs: string[]): Promise<void> {
  for (const input of inputs) if (resolve(output) === resolve(input)) throw new Error('Output must not overwrite an input');
  let outputStat;
  try { outputStat = await stat(output); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!outputStat) return;
  const outputReal = await realpath(output);
  for (const input of inputs) {
    const inputStat = await stat(input);
    if (outputReal === await realpath(input) || (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino)) throw new Error('Output must not overwrite an input or its filesystem alias');
  }
}

/** Installed Node runtime: no Bun, JSX compiler, source checkout, or network. */
export async function exportGraphHtml(options: ExportGraphOptions): Promise<Omit<OfflineHtmlResult, 'html'> & { output: string }> {
  const input = resolve(options.input), output = resolve(options.output);
  const assetsRoot = assetDirectory(options.assetsDirectory);
  const inputPaths = [input, ...(options.baseline ? [resolve(options.baseline)] : []), ...(options.assessment ? [resolve(options.assessment)] : []), join(assetsRoot, 'viewer.js'), join(assetsRoot, 'viewer.css')];
  await distinctOutput(output, inputPaths);
  const [graph, baseline, assessment, assets] = await Promise.all([
    readFile(input), options.baseline ? readFile(options.baseline) : undefined,
    options.assessment ? readFile(options.assessment) : undefined, readStandaloneAssets(assetsRoot),
  ]);
  const result = renderOfflineHtml({ graph, baseline, assessment, assets });
  await mkdir(dirname(output), { recursive: true });
  await distinctOutput(output, inputPaths);
  try { if ((await lstat(output)).isSymbolicLink()) throw new Error('Output must not be a symbolic link'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = join(dirname(output), `.${randomUUID()}.graph-explorer.tmp`);
  try {
    await writeFile(temporary, result.html, { flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  }
  const { html: _, ...summary } = result;
  return { output, ...summary };
}
