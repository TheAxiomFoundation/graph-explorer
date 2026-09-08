import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphExplorer, type GraphNodeRenderContext } from '../src/react';
import { parseGraphDocument, type GraphLocation } from '../src/core';
import '@xyflow/react/dist/style.css';
import '../src/react/style.css';

// Synthetic presentation fixture only. All 17 other records have a native edge
// to Focus, so a both-directions depth-one traversal retains all 18 records.
const snapshot = parseGraphDocument({
  schemaVersion: 'graph-explorer/v1', id: 'focused-layout-fixture', title: 'Focus and its neighborhood',
  description: 'Synthetic records for measuring focused layout readability; no real domain data or evaluation.',
  nodes: [
    { id: 'focus', label: 'Focus', kind: 'work', description: 'Central work record with incoming requirements and outgoing resources and results.' },
    { id: 'staff-a', label: 'Staff A', kind: 'staff', description: 'Generic incoming staff record A.' },
    { id: 'staff-b', label: 'Staff B', kind: 'staff', description: 'Generic incoming staff record B.' },
    { id: 'task-a', label: 'Work A', kind: 'work', description: 'Generic incoming work record A.' },
    { id: 'task-b', label: 'Work B', kind: 'work', description: 'Generic incoming work record B.' },
    { id: 'resource-a', label: 'Resource A', kind: 'resource', description: 'Generic outgoing resource record A.' },
    { id: 'resource-b', label: 'Resource B', kind: 'resource', description: 'Generic outgoing resource record B.' },
    { id: 'resource-c', label: 'Resource C', kind: 'resource', description: 'Generic outgoing resource record C.' },
    { id: 'resource-d', label: 'Resource D', kind: 'resource', description: 'Generic outgoing resource record D.' },
    { id: 'result-a', label: 'Result A', kind: 'outcome', description: 'Generic outgoing result record A.' },
    { id: 'result-b', label: 'Result B', kind: 'outcome', description: 'Generic outgoing result record B.' },
    { id: 'result-c', label: 'Result C', kind: 'outcome', description: 'Generic outgoing result record C.' },
    { id: 'result-d', label: 'Result D', kind: 'outcome', description: 'Generic outgoing result record D.' },
    { id: 'prerequisite-a', label: 'Requirement A', kind: 'prerequisite', description: 'Generic prerequisite branch A.' },
    { id: 'prerequisite-b', label: 'Requirement B', kind: 'prerequisite', description: 'Generic prerequisite branch B.' },
    { id: 'prerequisite-c', label: 'Requirement C', kind: 'prerequisite', description: 'Generic prerequisite branch C.' },
    { id: 'stage-a', label: 'Stage A', kind: 'stage', description: 'Generic side branch stage A.' },
    { id: 'stage-b', label: 'Stage B', kind: 'stage', description: 'Generic side branch stage B.' },
  ],
  edges: [
    ...['staff-a', 'staff-b'].map(id => ({ id: `${id}-focus`, source: id, target: 'focus', kind: 'assigned-to', category: 'dependency' })),
    ...['task-a', 'task-b'].map(id => ({ id: `${id}-focus`, source: id, target: 'focus', kind: 'contributes-to', category: 'dependency' })),
    ...['prerequisite-a', 'prerequisite-b', 'prerequisite-c'].map(id => ({ id: `${id}-focus`, source: id, target: 'focus', kind: 'required-by', category: 'dependency' })),
    ...['stage-a', 'stage-b'].map(id => ({ id: `${id}-focus`, source: id, target: 'focus', kind: 'precedes', category: 'dependency' })),
    ...['resource-a', 'resource-b', 'resource-c', 'resource-d'].map(id => ({ id: `focus-${id}`, source: 'focus', target: id, kind: 'allocates', category: 'dependency' })),
    ...['result-a', 'result-b', 'result-c', 'result-d'].map(id => ({ id: `focus-${id}`, source: 'focus', target: id, kind: 'produces', category: 'dependency' })),
    // Distinct typed edges between one endpoint pair exercise a multigraph.
    { id: 'focus-resource-a-reference', source: 'focus', target: 'resource-a', kind: 'references', category: 'reference' },
    { id: 'requirement-chain', source: 'prerequisite-a', target: 'prerequisite-b', kind: 'precedes', category: 'dependency' },
    { id: 'requirement-work', source: 'prerequisite-b', target: 'task-a', kind: 'required-by', category: 'dependency' },
    { id: 'stage-chain', source: 'stage-a', target: 'stage-b', kind: 'precedes', category: 'dependency' },
    { id: 'stage-work', source: 'stage-b', target: 'task-b', kind: 'contributes-to', category: 'dependency' },
    { id: 'resource-result', source: 'resource-d', target: 'result-d', kind: 'supports', category: 'dependency' },
  ],
});

const customCard = ({ node }: GraphNodeRenderContext) => <div className="focus-fixture-card">
  <div className="ge-node-eyebrow">{node.kind}</div>
  <strong>{node.label}</strong>
  <p>{node.description}</p>
  <small>Synthetic record · {node.id}</small>
</div>;

function App() {
  const [location, setLocation] = useState<GraphLocation>({ selectedId: 'focus', selectedType: 'node', focusId: 'focus', depth: 1, direction: 'both' });
  const [customCards, setCustomCards] = useState(false);
  return <div className="focus-fixture">
    <header className="focus-fixture-header">
      <div><h1>Synthetic focus layout fixture</h1><p>18 business records, all directly connected to Focus, plus native prerequisite and side-branch relationships. This host reserves 280 pixels above the shared viewer.</p></div>
      <div className="focus-fixture-controls">
        <label><input type="checkbox" checked={customCards} onChange={event => setCustomCards(event.target.checked)} /> Custom cards</label>
        <output aria-label="Card dimensions">Cards: {customCards ? '280 × 160' : '248 × 126'}</output>
        <output aria-label="Fixture record count">{snapshot.nodes.length} records · {snapshot.edges.length} typed relationships</output>
      </div>
    </header>
    <div className="focus-fixture-viewer"><GraphExplorer
      document={snapshot} location={location} onLocationChange={setLocation} searchFiltersCanvas={false}
      renderNodeContent={customCards ? customCard : undefined}
      getNodeSize={customCards ? () => ({ width: 280, height: 160 }) : undefined}
      renderToolbar={context => <button type="button" onClick={() => context.selectNode('resource-b')}>Inspect another record</button>}
    /></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
