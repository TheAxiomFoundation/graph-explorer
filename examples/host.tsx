import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphExplorer, type GraphHostContext, type GraphNodeRenderContext } from '../src/react';
import type { GraphDocument, GraphLocation, GraphNode } from '../src/core';
import '@xyflow/react/dist/style.css';
import '../src/react/style.css';

// Synthetic records exercise host APIs; this is not a PlanGraph adapter or plan.
const snapshot: GraphDocument = {
  schemaVersion: 'graph-explorer/v1', id: 'host-contract-example', title: 'Host integration · synthetic fixture',
  nodes: [
    { id: 'program', label: 'Research program', kind: 'program', data: { fact: 'Host-provided summary' } },
    { id: 'work', label: 'Source review', kind: 'work', data: { fact: 'Review acceptance criteria' } },
    { id: 'snapshot-1:/assignments/0', label: 'Quarterly assignment', kind: 'detail', parentId: 'work', data: { note: 'Internal fixture note', searchToken: 'quarterly-hours' } },
  ],
  edges: [
    { id: 'work-program', source: 'work', target: 'program', kind: 'contributes', category: 'dependency' },
    { id: 'detail-work', source: 'snapshot-1:/assignments/0', target: 'work', kind: 'documents', category: 'reference' },
  ],
};
const isBusiness = (node: GraphNode) => node.kind !== 'detail';
const renderCard = ({ node, selectNode }: GraphNodeRenderContext) => <>
  <div className="ge-node-eyebrow">Custom {node.kind}</div><strong>{node.label}</strong>
  <div>{String(node.data?.fact ?? 'Nested fixture record')}</div>
  <button type="button" className="nodrag nopan" onClick={event => { event.stopPropagation(); selectNode(node.id); }}>Inspect record</button>
</>;

function App() {
  const [location, setLocation] = useState<GraphLocation>({});
  const [businessOnly, setBusinessOnly] = useState(true);
  const [invalidExport, setInvalidExport] = useState(false);
  const [rejectDelivery, setRejectDelivery] = useState(false);
  const [lastExport, setLastExport] = useState('No export yet');
  const toolbar = (context: GraphHostContext) => <>
    <button type="button" onClick={() => context.setLocation({})}>Reset navigation</button>
    <button type="button" aria-pressed={businessOnly} onClick={() => setBusinessOnly(value => !value)}>Business canvas</button>
    <button type="button" aria-pressed={invalidExport} onClick={() => setInvalidExport(value => !value)}>Invalid export fixture</button>
    <button type="button" aria-pressed={rejectDelivery} onClick={() => setRejectDelivery(value => !value)}>Reject delivery fixture</button>
  </>;
  return <div style={{ height: '100vh' }}><GraphExplorer
    document={snapshot} location={location} onLocationChange={setLocation}
    canvasNodeFilter={node => !businessOnly || isBusiness(node)} searchFiltersCanvas={false}
    renderToolbar={toolbar} renderNodeContent={renderCard} getNodeSize={node => ({ width: 248, height: node.kind === 'program' ? 155 : 126 })}
    renderInspector={context => <div className="ge-inspector-body">
      <h2>Host inspector</h2><p>{context.node?.label ?? context.edge?.kind ?? 'Select any record, including a nested detail.'}</p>
      <p>Canvas: {context.visibleNodeIds.join(', ')}</p>
      <p>Query: {context.location.query || '(empty)'}</p>
      {context.node && <button type="button" onClick={() => context.focusNode(context.node!.id)}>Focus record</button>}
      <details open><summary>Export result</summary><output aria-label="Export result"><pre className="ge-json">{lastExport}</pre></output></details>
    </div>}
    exportOptions={{
      label: 'Export scoped JSON',
      projectDocument: async () => {
        // A brief fixture delay exercises pending state and duplicate-click guards.
        await new Promise(resolve => setTimeout(resolve, 750));
        return {
        schemaVersion: 'graph-explorer/v1', id: 'explicit-public-projection', title: 'Selected business records',
        nodes: snapshot.nodes.filter(isBusiness).map(({ id, label, kind }) => ({ id, label, kind })),
        edges: invalidExport ? snapshot.edges : [snapshot.edges[0]],
        };
      },
      onExport: async ({ json }) => {
        if (rejectDelivery) throw new Error('Host delivery failed (fixture)');
        setLastExport(json);
      },
    }}
  /></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
