import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphExplorer, type GraphLocationChange } from '../src/react';
import { decodeLocation, encodeLocation, getDefaultLineageLocation, parseGraphDocument, type GraphLocation } from '../src/core';
import fixture from './lineage-fixture.json';
import '@xyflow/react/dist/style.css';
import '../src/react/style.css';

// Invented presentation fixture; no domain evaluation or real evidence.
const annotated = parseGraphDocument(fixture);
const { lineage: _lineage, ...unannotated } = annotated;
const legacy = { ...unannotated, id: 'unannotated-host-fixture', title: 'Legacy unannotated graph' };
const initial = { ...getDefaultLineageLocation(annotated), selectedId: 'operation', query: 'host-only search', kinds: [] } satisfies GraphLocation;
const variableIndex = parseGraphDocument({
  schemaVersion: 'graph-explorer/v1', id: 'variable-index-fixture', title: 'Variable index fixture',
  nodes: Array.from({ length: 250 }, (_, index) => ({ id: `value-${index}`, label: `Value ${index}`, kind: 'invented' })), edges: [],
  lineage: {
    schemaVersion: 'orrery-lineage/v1',
    variables: Array.from({ length: 250 }, (_, index) => ({ id: `variable-${index}`, label: `Variable ${String(index).padStart(3, '0')}`, stages: [{ id: 'recorded', label: 'Recorded stage', nodeId: `value-${index}` }] })),
    relations: [], boundaries: Array.from({ length: 250 }, (_, index) => ({ nodeId: `value-${index}`, kind: 'source', description: 'Invented index fixture boundary.' })),
  },
});

function App() {
  const [document, setDocument] = useState(annotated);
  const [location, setLocation] = useState<GraphLocation>(() => window.location.hash ? decodeLocation(window.location.hash) : initial);
  const [hideIntermediate, setHideIntermediate] = useState(true);
  const [deferEcho, setDeferEcho] = useState(false);
  const [pending, setPending] = useState<{ next: GraphLocation; change: GraphLocationChange }>();
  const [callbacks, setCallbacks] = useState(0);
  const [reason, setReason] = useState('none');
  const locationRef = useRef(location); locationRef.current = location;
  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, '', encodeLocation(initial));
    const restore = () => { setPending(undefined); setLocation(decodeLocation(window.location.hash)); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  const reflect = (next: GraphLocation) => {
    const hash = encodeLocation(next);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    setLocation({ ...next, kinds: [...next.kinds ?? []] });
  };
  const externalSelection = (id: string) => reflect({ ...locationRef.current, selectedId: id, selectedType: 'node' });
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <nav aria-label="Synthetic host controls" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: 8 }}>
      <button type="button" onClick={() => externalSelection('normalize')}>Inspect hidden intermediate</button>
      <button type="button" onClick={() => externalSelection('amount-final')}>Inspect final value</button>
      <button type="button" onClick={() => externalSelection('operation')}>Inspect operation</button>
      <button type="button" onClick={() => setHideIntermediate(value => !value)}>{hideIntermediate ? 'Show intermediate' : 'Hide intermediate'}</button>
      <label><input type="checkbox" checked={deferEcho} onChange={event => setDeferEcho(event.target.checked)} />Defer controlled echo</label>
      <button type="button" disabled={!pending} onClick={() => { if (pending) reflect(pending.next); setPending(undefined); }}>Reflect pending location</button>
      <button type="button" onClick={() => { setDocument(legacy); setHideIntermediate(false); setPending(undefined); reflect({}); }}>Open unannotated graph</button>
      <button type="button" onClick={() => { setDocument(annotated); setHideIntermediate(true); setPending(undefined); reflect(initial); }}>Open annotated graph</button>
      <button type="button" onClick={() => { setDocument(variableIndex); setHideIntermediate(false); setPending(undefined); reflect(getDefaultLineageLocation(variableIndex)!); }}>Open variable index</button>
      {document.id === variableIndex.id && <>
        {[0, 149, 199].map(index => <button type="button" key={index} onClick={() => reflect({ ...locationRef.current, traceId: `value-${index}`, traceVariableId: `variable-${index}`, selectedId: `value-${index}`, selectedType: 'node' })}>Trace variable {index}</button>)}
        <button type="button" onClick={() => setDocument(current => ({ ...current, nodes: current.nodes.map(node => ({ ...node })), lineage: current.lineage && { ...current.lineage, variables: current.lineage.variables.map(variable => ({ ...variable, stages: variable.stages.map(stage => ({ ...stage })) })) } }))}>Equivalent document</button>
      </>}
    </nav>
    <div hidden><output aria-label="Host location">{JSON.stringify(location)}</output><output aria-label="Host callback count">{callbacks}</output><output aria-label="Host last reason">{reason}</output><output aria-label="Host pending echo">{pending ? 'pending' : 'none'}</output></div>
    <div style={{ flex: 1, minHeight: 0 }}><GraphExplorer document={document} location={location}
      canvasNodeFilter={node => !hideIntermediate || node.id !== 'normalize'}
      onLocationChange={(next, change) => { setCallbacks(count => count + 1); setReason(change.reason); if (deferEcho) setPending({ next, change }); else reflect(next); }}
      renderInspector={context => <div className="ge-inspector-body"><h2>Host inspection</h2><output aria-label="Host inspected ID">{context.node?.id ?? context.edge?.id ?? ''}</output><p>{context.node?.description ?? context.edge?.description}</p><code>{JSON.stringify(context.node?.data ?? context.edge?.data ?? {})}</code><div hidden><output aria-label="Host visible nodes">{JSON.stringify(context.visibleNodeIds)}</output><output aria-label="Host visible edges">{JSON.stringify(context.visibleEdgeIds)}</output></div>{context.node && <p><button type="button" onClick={() => context.focusNode(context.node!.id)}>Explore inspected record</button></p>}</div>}
    /></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
