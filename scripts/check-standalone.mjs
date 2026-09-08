import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { readStandaloneAssets, renderOfflineHtml } from '../dist/export.js';

// Exercise the distributed exporter and its real bundle. Compilation with Script
// uses the browser's classic-script grammar without executing the React runtime.
const document = {
  schemaVersion: 'graph-explorer/v1',
  id: 'standalone-smoke',
  title: 'Offline <viewer> & </title><script src="https://example.invalid/title.js">',
  nodes: [{
    id: 'synthetic-record',
    label: 'Synthetic record',
    kind: 'record',
    data: {
      closingTag: '</script><script src="https://example.invalid/data.js"></script>',
      unicode: 'café \u2028 \u2029',
      ordinaryText: 'import.meta is harmless inside a string',
    },
  }],
  edges: [],
};
// Whitespace deliberately differs from the embedded JSON: the digest must bind
// the input bytes, not a parsed and reserialized version of the document.
const graph = Buffer.from(` \n${JSON.stringify(document, null, 2)}\n\t`, 'utf8');
const expectedDigest = createHash('sha256').update(graph).digest('hex');

function attributes(source) {
  const result = new Map();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    result.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function checkHtml(assets, label) {
  const output = renderOfflineHtml({ graph, assets });
  assert.equal(output.documentSha256, expectedDigest, `${label}: exact input-byte digest`);
  assert.equal(output.bytes, Buffer.byteLength(output.html), `${label}: HTML byte count`);
  assert.equal(output.nodes, document.nodes.length);
  assert.equal(output.edges, document.edges.length);
  assert.equal(output.offline, true);

  const scripts = [];
  const styles = [];
  // HTML raw-text elements end at literal closing tags. In particular, <\/script
  // is retained verbatim inside the source handed to the classic-script parser.
  const shell = output.html.replace(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
    (_element, tag, attrs, body) => {
      (tag.toLowerCase() === 'script' ? scripts : styles).push({ attrs: attributes(attrs), body });
      return '';
    });
  assert.doesNotMatch(shell, /<(?:script|style)\b/i, `${label}: unmatched raw-text element`);
  assert.doesNotMatch(shell, /<link\b/i, `${label}: offline report must not request external styles or scripts`);
  assert.equal(scripts.length, 2, `${label}: exactly one data block and one bundled runtime`);
  assert.equal(styles.length, 1, `${label}: one embedded stylesheet`);
  for (const { body } of styles) {
    assert.doesNotMatch(body.replace(/\/\*[\s\S]*?\*\//g, ''), /@import\b/i,
      `${label}: stylesheet must not import another stylesheet`);
  }

  let dataBlocks = 0;
  let executableScripts = 0;
  for (const { attrs, body } of scripts) {
    assert.ok(!attrs.has('src'), `${label}: script must be embedded`);
    const type = (attrs.get('type') ?? '').trim().toLowerCase();
    if (type === 'application/json') {
      dataBlocks++;
      assert.equal(attrs.get('id'), 'graph-explorer-data');
      const embedded = JSON.parse(body);
      assert.deepEqual(embedded.document, document, `${label}: embedded graph round-trip`);
      assert.equal(embedded.documentSha256, expectedDigest, `${label}: embedded digest`);
      assert.deepEqual(Object.keys(embedded).sort(), ['document', 'documentSha256']);
      continue;
    }
    assert.ok(['', 'text/javascript', 'application/javascript'].includes(type),
      `${label}: runtime must be an executable classic script, received ${type}`);
    executableScripts++;
    try {
      // Do not run this Script. Parsing rejects import.meta and static imports or
      // exports while accepting those same characters in ordinary strings.
      new Script(body, { filename: `${label}-runtime-${executableScripts}.js` });
    } catch (error) {
      // VM stacks can include the entire minified bundle; keep CI failure useful.
      throw new Error(`${label}: bundled classic script failed to parse: ${error.message}`);
    }
  }
  assert.equal(dataBlocks, 1, `${label}: one embedded graph`);
  assert.equal(executableScripts, 1, `${label}: one parsed classic runtime`);
  return output;
}

try {
  const assets = await readStandaloneAssets();
  const output = checkHtml(assets, 'built-standalone');
  // Also exercise raw-text escaping inside the actual bundle and stylesheet,
  // beyond the hostile closing tags already present in the embedded graph.
  const sentinel = '</script><script src="https://example.invalid/runtime.js"></script> import.meta';
  checkHtml({
    javascript: `${assets.javascript}\n;void ${JSON.stringify(sentinel)};\n`,
    css: `${assets.css}\n/* </style><link rel="stylesheet" href="https://example.invalid/style.css"> */\n`,
  }, 'escaped-standalone');
  console.log(`Standalone HTML passed: classic runtime parses, assets are inline, graph bytes bind to ${output.documentSha256}.`);
} catch (error) {
  console.error(`Standalone HTML check failed: ${error.message}`);
  process.exitCode = 1;
}
