import { describe, expect, test } from 'bun:test';
import { parseGraphDocument, validateGraphDocument, traverse, diffGraphs, safeUrl, encodeLocation, decodeLocation, getReceiptAssessment } from '../src/core/index.js';
import type { GraphDocument, ReceiptAssessment } from '../src/core/types.js';

const graph = (): GraphDocument => ({
  schemaVersion: 'graph-explorer/v1', id: 'g', title: 'Evidence graph',
  nodes: ['source', 'a', 'b', 'result'].map(id => ({ id, label: id, kind: 'record', revision: 'v1' })),
  edges: [
    { id: 'sa', source: 'source', target: 'a', kind: 'provided', category: 'evidence' },
    { id: 'sb', source: 'source', target: 'b', kind: 'provided', category: 'evidence' },
    { id: 'ar', source: 'a', target: 'result', kind: 'produced', category: 'dependency' },
  ],
});

describe('portable snapshot validation', () => {
  test('allows typed multigraphs and semantic cycles', () => {
    const g = graph(); g.edges.push({ id: 'ra', source: 'result', target: 'a', kind: 'reviewed' });
    g.edges.push({ id: 'sa2', source: 'source', target: 'a', kind: 'cited' });
    expect(parseGraphDocument(g).edges).toHaveLength(5);
  });
  test('rejects duplicate ids, dangling edges, and nonfinite data', () => {
    const g = graph(); g.nodes.push({...g.nodes[0], data: { bad: NaN }});
    g.edges[0].target = 'missing';
    const r = validateGraphDocument(g);
    expect(r.valid).toBe(false);
    expect(r.issues.some(x=>x.message.includes('Duplicate'))).toBe(true);
    expect(r.issues.some(x=>x.message.includes('Unknown target'))).toBe(true);
  });
  test('rejects cyclic containment while permitting graph cycles', () => {
    const g = graph(); g.nodes[0].parentId='a'; g.nodes[1].parentId='source';
    expect(validateGraphDocument(g).issues.some(i=>i.message.includes('Containment'))).toBe(true);
  });
  test('rejects explicit and mixed containment cycles', () => {
    const g=graph();g.nodes[1].parentId='source';
    g.edges.push({id:'contains',source:'a',target:'source',kind:'contains',category:'containment'});
    expect(validateGraphDocument(g).valid).toBe(false);
    delete g.nodes[1].parentId;
    g.edges.push({id:'contains-back',source:'source',target:'a',kind:'contains',category:'containment'});
    expect(validateGraphDocument(g).valid).toBe(false);
  });
  test('rejects dangling provenance and stale subject revisions', () => {
    const g = graph();
    g.activities=[{id:'run',label:'Run',kind:'execution',inputs:[{role:'consumed',subject:{type:'node',id:'a',revision:'v0'}}],artifactIds:['missing']}];
    expect(validateGraphDocument(g).issues).toHaveLength(2);
  });
  test('strips producer-supplied verifier results from the top-level input', () => {
    const parsed = parseGraphDocument({...graph(), assessments:[{status:'verified'}], command:'never execute'});
    expect('assessments' in parsed).toBe(false); expect('command' in parsed).toBe(false);
  });
  test('requires tagged exact large integers and preserves the literal', () => {
    const g=graph();g.nodes[0].data={seed:9007199254740992};
    expect(validateGraphDocument(g).valid).toBe(false);
    g.nodes[0].data={seed:{integer_literal:'18446744073709551615'}};
    expect(parseGraphDocument(g).nodes[0].data).toEqual(g.nodes[0].data);
  });
  test('rejects coerced enums and numeric subject identities', () => {
    for (const patch of [
      (g:any)=>{g.edges[0].category=['containment'];},
      (g:any)=>{g.nodes[0].statuses=[{label:'Gate',tone:['positive']}];},
      (g:any)=>{g.activities=[{id:'run',label:'Run',kind:'execution',inputs:[{role:['consumed'],subject:{type:'node',id:'a'}}]}];},
      (g:any)=>{g.nodes.push({id:'1',label:'One',kind:'record'});g.activities=[{id:'run',label:'Run',kind:'execution',outputs:[{type:'node',id:1}]}];},
    ]) {const g=graph();patch(g);expect(validateGraphDocument(g).valid).toBe(false);}
  });
});

describe('navigation and comparison', () => {
  test('lineage excludes sibling consumers and terminates through cycles', () => {
    const g=graph();
    expect([...traverse(g,'a','both')].sort()).toEqual(['a','result','source']);
    g.edges.push({id:'loop',source:'result',target:'a',kind:'feedback'});
    expect([...traverse(g,'result','upstream')].sort()).toEqual(['a','result','source']);
  });
  test('depth and category restrict traversal', () => {
    expect([...traverse(graph(),'source','downstream',{maxDepth:1})]).toEqual(['source','a','b']);
    expect([...traverse(graph(),'a','upstream',{categories:['dependency']})]).toEqual(['a']);
  });
  test('diff detects edited edges and data with stable key order', () => {
    const a=graph(),b=graph(); a.nodes[0].data={x:1,y:2}; b.nodes[0].data={y:2,x:1};
    b.nodes[1].revision='v2'; b.edges[0].kind='cited'; b.nodes.pop(); b.edges.pop();
    const d=diffGraphs(a,b);
    expect(d.nodes.changed).toEqual(['a']); expect(d.nodes.removed).toEqual(['result']);
    expect(d.edges.changed).toEqual(['sa']); expect(d.edges.removed).toEqual(['ar']);
  });
  test('deep links round-trip punctuation and unicode', () => {
    const state={selectedId:'a/#?税',selectedType:'node' as const,focusId:'source',direction:'upstream' as const,depth:3,showContainment:false,kinds:['a,b','x&y'],query:'income tax',collapsedIds:['a/b']};
    expect(decodeLocation(encodeLocation(state))).toEqual(state);
    expect(decodeLocation('#kinds=not-json&direction=nonsense')).toEqual({});
  });
  test('links reject executable and ambiguous schemes but preserve offline paths', () => {
    for (const bad of ['javascript:alert(1)','data:text/html,<script>','//evil.test','\\\\evil.test',' https://example.org','https://user:pass@host','java\nscript:evil','%6aavascript:evil']) expect(safeUrl(bad)).toBeNull();
    for (const good of ['https://example.org/page?q=hello','artifacts/report.json','#record','../sources/a.pdf']) expect(safeUrl(good)).toBe(good);
  });
});

describe('Receipt assessment boundary', () => {
  const digest='a'.repeat(64), artifactHash='b'.repeat(64),receiptHash='c'.repeat(64);
  const setup=()=>{
    const g=graph(); g.artifacts=[{id:'artifact',label:'Artifact',sha256:artifactHash}];
    g.receipts=[{id:'receipt',label:'Receipt',subjects:[{type:'node',id:'a',revision:'v1'}],artifactIds:['artifact'],sha256:receiptHash}];
    const a:ReceiptAssessment={receiptId:'receipt',status:'verified',verifier:'receipt',documentSha256:digest,receiptSha256:receiptHash,scope:'Artifact custody; association with node is host-declared',subjects:[{type:'node',id:'a',revision:'v1'}],artifacts:[{id:'artifact',sha256:artifactHash}]};
    return {g,a,r:g.receipts[0]};
  };
  test('accepts explicit bound assessment and preserves its limited scope',()=>{const {g,a,r}=setup();expect(getReceiptAssessment(g,r,[a],digest)).toEqual(a);});
  test('does not reuse results for changed bytes or revised subjects',()=>{
    const {g,a,r}=setup();expect(getReceiptAssessment(g,r,[a],'d'.repeat(64))).toBeUndefined();
    a.subjects![0].revision='v0';expect(getReceiptAssessment(g,r,[a],digest)).toBeUndefined();
  });
  test('rejects incomplete artifact evidence and contradictory reports',()=>{
    const {g,a,r}=setup();expect(getReceiptAssessment(g,r,[a,{...a,status:'failed'}],digest)).toBeUndefined();
    a.artifacts=[];expect(getReceiptAssessment(g,r,[a],digest)).toBeUndefined();
  });
  test('requires current revision, receipt head, and exact artifact set',()=>{
    const {g,a,r}=setup();a.receiptSha256='d'.repeat(64);expect(getReceiptAssessment(g,r,[a],digest)).toBeUndefined();
    a.receiptSha256=r.sha256;a.artifacts!.push({id:'unrelated',sha256:artifactHash});expect(getReceiptAssessment(g,r,[a],digest)).toBeUndefined();
    a.artifacts!.pop();g.nodes[1].revision='v2';expect(getReceiptAssessment(g,r,[a],digest)).toBeUndefined();
  });
  test('malformed verifier payloads fail closed without throwing',()=>{
    const {g,a,r}=setup();
    for (const reports of [[null],[{...a,subjects:{}}],[{...a,scope:{bad:'object'}}],[{...a,artifacts:[null]}]]) {
      expect(getReceiptAssessment(g,r,reports as unknown as ReceiptAssessment[],digest)).toBeUndefined();
    }
  });
});
