import assert from 'node:assert/strict';

// Run in a fresh Node process after building, so React selects its production
// runtime before the package is imported. Import-only checks miss jsxDEV calls.
assert.equal(process.env.NODE_ENV, 'production', 'Run with NODE_ENV=production node scripts/check-production-react.mjs');
const [{ createElement }, { renderToString }, { GraphExplorer }, { parseGraphDocument }] = await Promise.all([
  import('react'),
  import('react-dom/server'),
  import('@axiom-foundation/graph-explorer/react'),
  import('@axiom-foundation/graph-explorer'),
]);

// Deliberately synthetic presentation fixture: no domain evaluation or evidence.
const document = parseGraphDocument({
  schemaVersion: 'graph-explorer/v1',
  id: 'production-render-fixture',
  title: 'Production render fixture',
  nodes: [
    { id: 'selected', kind: 'fixture', label: 'Selected fixture', description: 'Built package inspector fixture' },
    { id: 'index-only', kind: 'fixture', label: 'Index-only fixture' },
  ],
  edges: [{ id: 'fixture-edge', source: 'selected', target: 'index-only', kind: 'fixture-link', category: 'reference' }],
});
const location = { selectedId: 'selected', selectedType: 'node' };
const html = renderToString(createElement(GraphExplorer, { document, location }));
assert.ok(html.includes('<h1>Production render fixture</h1>'), 'The built component must render the graph title');
assert.ok(html.includes('Built package inspector fixture'), 'The built component must render the selected record inspector');

let toolbarCalls = 0;
let inspectorCalls = 0;
let filterCalls = 0;
let sizeCalls = 0;
function assertHostContext(context) {
  assert.equal(context.document, document);
  assert.equal(context.node?.id, 'selected');
  assert.equal(context.edge, undefined);
  assert.equal(context.location.query, 'no matching record');
  assert.deepEqual(context.visibleNodeIds, ['selected']);
  assert.deepEqual(context.visibleEdgeIds, []);
  for (const method of ['selectNode', 'selectEdge', 'focusNode', 'setLocation']) {
    assert.equal(typeof context[method], 'function', `Host context must expose ${method}`);
  }
}
const hostHtml = renderToString(createElement(GraphExplorer, {
  document,
  location: { ...location, query: 'no matching record' },
  searchFiltersCanvas: false,
  canvasNodeFilter(node, snapshot) {
    filterCalls += 1;
    assert.equal(snapshot, document);
    return node.id === 'selected';
  },
  getNodeSize(node, snapshot) {
    sizeCalls += 1;
    assert.equal(node.id, 'selected');
    assert.equal(snapshot, document);
    return { width: 240, height: 100 };
  },
  renderToolbar(context) {
    toolbarCalls += 1;
    assertHostContext(context);
    return createElement('span', null, 'Production host toolbar fixture');
  },
  renderInspector(context) {
    inspectorCalls += 1;
    assertHostContext(context);
    return createElement('section', null, 'Production host inspector fixture');
  },
}));
assert.ok(hostHtml.includes('Production host toolbar fixture'), 'Host toolbar must render');
assert.ok(hostHtml.includes('Production host inspector fixture'), 'Host inspector must render');
assert.ok(toolbarCalls > 0 && inspectorCalls > 0 && filterCalls > 0 && sizeCalls > 0, 'SSR must exercise the supported host callbacks');

// Capture the public host methods during SSR, then exercise their callback
// contract without a DOM. A node and edge deliberately share an ID.
const navigationDocument = parseGraphDocument({
  ...document,
  id: 'production-navigation-fixture',
  edges: [{ ...document.edges[0], id: 'selected' }],
});
const initialNavigation = {
  ...location,
  focusId: 'selected',
  direction: 'downstream',
  depth: 2,
  showContainment: false,
  query: 'fixture',
  kinds: ['fixture'],
  collapsedIds: [],
};
const originalNavigation = structuredClone(initialNavigation);
const navigationCalls = [];
let navigationContext;
renderToString(createElement(GraphExplorer, {
  document: navigationDocument,
  location: initialNavigation,
  onLocationChange(...args) {
    assert.equal(args.length, 2, 'Every navigation callback must receive state and change metadata');
    const [next, change] = args;
    assert.ok(change && ['select', 'focus', 'view'].includes(change.reason), 'Every navigation callback must identify its intent');
    navigationCalls.push(structuredClone({ next, change }));
  },
  renderToolbar(context) {
    navigationContext = context;
    return null;
  },
}));
assert.ok(navigationContext, 'SSR must expose the navigation host context');
function expectNavigation(action, next, reason) {
  const previousCount = navigationCalls.length;
  action();
  assert.equal(navigationCalls.length, previousCount + 1, 'Each explicit action must emit exactly one callback');
  assert.deepEqual(navigationCalls.at(-1), { next, change: { reason } });
}
expectNavigation(() => navigationContext.selectNode('selected'), initialNavigation, 'select');
expectNavigation(() => navigationContext.selectNode('selected'), initialNavigation, 'select');
assert.equal(navigationCalls.length, 2, 'Reselecting the same node twice must emit two selection intents');
expectNavigation(() => navigationContext.selectEdge('selected'), { ...initialNavigation, selectedType: 'edge' }, 'select');
expectNavigation(() => navigationContext.focusNode('index-only', 'upstream'), {
  ...initialNavigation,
  selectedId: 'index-only',
  selectedType: 'node',
  focusId: 'index-only',
  direction: 'upstream',
}, 'focus');
expectNavigation(() => navigationContext.focusNode('selected'), {
  ...initialNavigation,
  direction: 'both',
}, 'focus');
expectNavigation(() => navigationContext.setLocation({ query: 'replacement' }), { query: 'replacement' }, 'view');
expectNavigation(() => navigationContext.selectNode('index-only'), {
  query: 'replacement',
  selectedId: 'index-only',
  selectedType: 'node',
}, 'select');
expectNavigation(() => navigationContext.setLocation({}, { reason: 'select' }), {}, 'select');
assert.deepEqual(initialNavigation, originalNavigation, 'Navigation must not mutate host-owned state');

let legacyContext;
const legacyCalls = [];
renderToString(createElement(GraphExplorer, {
  document,
  location,
  onLocationChange(next) {
    legacyCalls.push(next);
  },
  renderToolbar(context) {
    legacyContext = context;
    return null;
  },
}));
assert.ok(legacyContext, 'SSR must expose the legacy callback fixture context');
legacyContext.selectNode('index-only');
assert.deepEqual(legacyCalls, [{ selectedId: 'index-only', selectedType: 'node' }], 'One-argument callbacks must still receive navigation state');

// React Flow measures and renders canvas nodes in the browser; this check makes
// no claim about browser layout, effects, export clicks, or node-content hooks.
console.log('Production React render passed: built package, selected inspector, host callbacks, and navigation intent.');
