import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphExplorer, type GraphHostContext } from '../src/react';
import type { GraphDocument, GraphLocation } from '../src/core';
import '@xyflow/react/dist/style.css';
import '../src/react/style.css';

// Synthetic host contract fixture; no domain adapter or private data.
const document: GraphDocument = {
  schemaVersion: 'graph-explorer/v1', id: 'host-locate', title: 'Host Locate fixture',
  nodes: [
    { id: 'work', label: 'Synthetic work', kind: 'work' },
    { id: 'program', label: 'Synthetic program', kind: 'program' },
    { id: 'detail', label: 'Host-only detail', kind: 'detail', parentId: 'work' },
  ],
  edges: [{ id: 'contribution', source: 'work', target: 'program', kind: 'contributes', category: 'dependency' }],
};

function App() {
  const [location, setLocation] = useState<GraphLocation>({ selectedId: 'work', selectedType: 'node', query: 'host-only query', depth: 2, showContainment: false });
  const [callbacks, setCallbacks] = useState(0);
  const [preciseSelection, setPreciseSelection] = useState('work.phase[0]');
  const [hideProgram, setHideProgram] = useState(false);
  const [inspectorRequest, setInspectorRequest] = useState(0);
  const [result, setResult] = useState('none');
  const current = useRef<GraphHostContext | null>(null);
  const remembered = useRef<GraphHostContext['locateNode'] | null>(null);
  const locate = (context: GraphHostContext, id: string) => setResult(`${id}:${context.locateNode(id)}`);
  return <div className="locate-fixture">
    <section className="host-controls" aria-label="External host controls">
      <button type="button" onClick={() => { remembered.current = current.current?.locateNode ?? null; setResult('remembered'); }}>Remember Locate</button>
      <button type="button" onClick={() => setResult(`remembered:${remembered.current?.('program') ?? false}`)}>Call remembered Locate</button>
      <button type="button" onClick={() => setResult(`remembered-work:${remembered.current?.('work') ?? false}`)}>Call remembered Locate for work</button>
      <button type="button" aria-pressed={hideProgram} onClick={() => setHideProgram(value => !value)}>Hide program</button>
      <button type="button" onClick={() => setInspectorRequest(value => value + 1)}>Request Inspect</button>
      <div className="host-status">
        <output aria-label="Host location">{JSON.stringify(location)}</output>
        <output aria-label="Navigation count">{callbacks}</output>
        <output aria-label="Host precise selection">{preciseSelection}</output>
        <output aria-label="Locate result">{result}</output>
      </div>
    </section>
    <div className="locate-viewer"><GraphExplorer document={document} location={location}
      onLocationChange={(next, change) => { setLocation(next); setCallbacks(value => value + 1); if (change.reason !== 'view') setPreciseSelection(next.selectedId ?? 'none'); }}
      inspectorRequestKey={inspectorRequest} searchFiltersCanvas={false}
      canvasNodeFilter={node => node.kind !== 'detail' && (!hideProgram || node.id !== 'program')}
      getNodeSize={node => ({ width: node.id === 'program' ? 310 : 248, height: node.id === 'program' ? 202 : 126 })}
      renderToolbar={context => { current.current = context; return <button type="button" onClick={() => locate(context, 'program')}>Locate program</button>; }}
      renderInspector={context => <div className="ge-inspector-body">
        <h2>Host inspector</h2><p>{preciseSelection}</p>
        <button type="button" onClick={() => locate(context, 'work')}>Locate work</button>
        <button type="button" onClick={() => locate(context, 'detail')}>Locate excluded detail</button>
        <button type="button" onClick={() => locate(context, 'missing')}>Locate missing</button>
      </div>}
    /></div>
  </div>;
}

createRoot(globalThis.document.getElementById('root')!).render(<App />);
