import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphExplorer, type GraphLocationChange } from '../src/react';
import { parseGraphDocument, type GraphLocation, type GraphNode } from '../src/core';
import '@xyflow/react/dist/style.css';
import '../src/react/style.css';

// Generated synthetic presentation data only; no private records or evaluation.
const detailCount = 22_203;
const detailId = (ordinal: number) => `detail-${String(ordinal).padStart(5, '0')}`;
const lastRecordId = detailId(detailCount);
const snapshot = parseGraphDocument({
  schemaVersion: 'graph-explorer/v1', id: 'large-index-fixture', title: 'Large index · 22,208 records',
  nodes: [
    { id: 'work', label: 'Work A', kind: 'work' },
    { id: 'program', label: 'Program A', kind: 'program' },
    { id: 'resource-a', label: 'Resource A', kind: 'resource' },
    { id: 'resource-b', label: 'Resource B', kind: 'resource' },
    { id: 'result', label: 'Result A', kind: 'outcome' },
    ...Array.from({ length: detailCount }, (_, index) => {
      const ordinal = index + 1;
      return {
        id: detailId(ordinal), label: `Detail record ${String(ordinal).padStart(5, '0')}`, kind: 'detail', parentId: 'work',
        data: { ordinal, ...(ordinal === detailCount ? { searchToken: 'final-record-marker' } : {}) },
      };
    }),
  ],
  edges: [
    { id: 'work-program', source: 'work', target: 'program', kind: 'contributes-to', category: 'dependency' },
    { id: 'resource-a-work', source: 'resource-a', target: 'work', kind: 'supports', category: 'dependency' },
    { id: 'resource-b-work', source: 'resource-b', target: 'work', kind: 'supports', category: 'dependency' },
    { id: 'work-result', source: 'work', target: 'result', kind: 'produces', category: 'dependency' },
  ],
});
const isBusiness = (node: GraphNode) => node.kind !== 'detail';
const selectionLabel = (location: GraphLocation) => location.selectedId
  ? `${location.selectedType ?? 'node'}:${location.selectedId}` : 'none';

function App() {
  const [location, setLocation] = useState<GraphLocation>({ selectedId: 'work', selectedType: 'node' });
  const [preciseSelection, setPreciseSelection] = useState('node:work');
  const [inspectorRequestKey, setInspectorRequestKey] = useState<number>();
  const [viewerMount, setViewerMount] = useState(0);
  const [callbackCount, setCallbackCount] = useState(0);
  const [lastReason, setLastReason] = useState('none');
  const externalSelect = (selectedId: string, precise = `node:${selectedId}`) => {
    setLocation(current => ({ ...current, selectedId, selectedType: 'node' }));
    setPreciseSelection(precise);
  };
  const requestNestedInspector = () => {
    externalSelect('work', 'field:work.details[0].text');
    setInspectorRequestKey(current => (current ?? 0) + 1);
  };
  const navigate = (next: GraphLocation, change: GraphLocationChange) => {
    setLocation(next);
    setCallbackCount(current => current + 1);
    setLastReason(change.reason);
    if (change.reason === 'select' || change.reason === 'focus') setPreciseSelection(selectionLabel(next));
  };

  return <div className="large-index-fixture">
    <section className="large-index-controls" aria-label="External host controls">
      <p><strong>Synthetic large index fixture</strong> · 22,208 records · five canvas records · search <code>final-record-marker</code> for the last detail</p>
      <div className="large-index-buttons">
        <button type="button" onClick={() => externalSelect(lastRecordId)}>Inspect last record externally</button>
        <button type="button" onClick={() => externalSelect('detail-00085')}>Inspect interior record externally</button>
        <button type="button" onClick={() => externalSelect('work')}>Select work externally</button>
        <button type="button" onClick={requestNestedInspector}>Inspect nested work field</button>
        <button type="button" onClick={() => setInspectorRequestKey(undefined)}>Clear inspector request</button>
        <button type="button" onClick={() => { requestNestedInspector(); setViewerMount(current => current + 1); }}>Remount with initial inspector request</button>
      </div>
      <div className="large-index-status" aria-live="polite">
        <output aria-label="Host precise selection">Host: {preciseSelection}</output>
        <output aria-label="Viewer callback status">Callbacks: {callbackCount} · reason: {lastReason}</output>
        <output aria-label="Inspector request key">Inspector request: {inspectorRequestKey ?? 'unset'} · mount: {viewerMount}</output>
      </div>
    </section>
    <div className="large-index-viewer"><GraphExplorer
      key={viewerMount} document={snapshot} location={location} onLocationChange={navigate}
      inspectorRequestKey={inspectorRequestKey} canvasNodeFilter={isBusiness} searchFiltersCanvas={false}
      renderInspector={context => <div className="ge-inspector-body large-index-inspector">
        <h2>Host inspector</h2>
        <output aria-label="Inspector precise selection">{preciseSelection}</output>
        <p>Graph selection: <code>{selectionLabel(context.location)}</code></p>
        <p>Record: {context.node?.label ?? context.edge?.kind ?? 'none'}</p>
        <p>Canvas records: {context.visibleNodeIds.length}</p>
        <p>Query: <code>{context.location.query || '(empty)'}</code></p>
        <p>Callbacks: {callbackCount} · latest reason: {lastReason}</p>
        <p>Inspector request: {inspectorRequestKey ?? 'unset'}</p>
      </div>}
    /></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
