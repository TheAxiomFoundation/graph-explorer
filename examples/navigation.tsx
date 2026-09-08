import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphExplorer, type GraphHostContext, type GraphLocationChange } from '../src/react';
import type { GraphDocument, GraphLocation } from '../src/core';
import '@xyflow/react/dist/style.css';
import '../src/react/style.css';

// Synthetic presentation records. Nested host detail deliberately has no graph
// record; node and edge IDs overlap to exercise their separate namespaces.
const snapshot: GraphDocument = {
  schemaVersion: 'graph-explorer/v1', id: 'navigation-fixture', title: 'Selection intent fixture',
  nodes: [
    { id: 'work', label: 'Synthetic work', kind: 'work' },
    { id: 'program', label: 'Synthetic program', kind: 'program' },
  ],
  edges: [{ id: 'work', source: 'work', target: 'program', kind: 'contributes', category: 'dependency' }],
};
const nestedField = 'field:work.acceptance[0].text';
const selectionLabel = (location: GraphLocation) => location.selectedId
  ? `${location.selectedType ?? 'node'}:${location.selectedId}` : 'none';
type NavigationEvent = { reason: GraphLocationChange['reason']; selection: string };

function App() {
  const [location, setLocation] = useState<GraphLocation>({});
  const [preciseSelection, setPreciseSelection] = useState('none');
  const [events, setEvents] = useState<NavigationEvent[]>([]);
  const [deferHostUpdates, setDeferHostUpdates] = useState(false);
  const [pendingLocation, setPendingLocation] = useState<GraphLocation>();
  const latestReason = events.at(-1)?.reason ?? 'none';

  const externalSelect = (selectedId: string, selectedType: 'node' | 'edge', precise = `${selectedType}:${selectedId}`) => {
    setLocation(current => ({ ...current, selectedId, selectedType }));
    setPreciseSelection(precise);
    setPendingLocation(undefined);
    // External prop changes must not manufacture a viewer callback.
  };
  const navigate = (next: GraphLocation, change: GraphLocationChange) => {
    // Logging still rerenders the host while its controlled location stays old.
    // Explicit application below echoes only the latest queued navigation.
    if (deferHostUpdates) setPendingLocation(next);
    else { setLocation(next); setPendingLocation(undefined); }
    setEvents(current => [...current, { reason: change.reason, selection: selectionLabel(next) }]);
    // Explicit selection resolves nested detail even when the graph ID repeats.
    // A view change preserves the host's more precise selection.
    if (change.reason === 'select' || change.reason === 'focus') setPreciseSelection(selectionLabel(next));
  };
  const toolbar = (context: GraphHostContext) => <>
    <button type="button" onClick={() => context.focusNode('program')}>Focus program</button>
    <button type="button" onClick={() => context.setLocation({ ...context.location, query: context.location.query ? '' : 'work' })}>Toggle view query</button>
    <button type="button" onClick={() => context.setLocation({ ...context.location, selectedId: 'work', selectedType: 'node' }, { reason: 'select' })}>Select work</button>
  </>;

  return <div className="navigation-fixture">
    <section className="navigation-controls" aria-label="External host controls">
      <p><strong>Navigation regression</strong> · synthetic records · external controls remain available on mobile</p>
      <div className="navigation-buttons">
        <button type="button" onClick={() => externalSelect('work', 'node', nestedField)}>Select nested field externally</button>
        <button type="button" onClick={() => externalSelect('work', 'node')}>External node work</button>
        <button type="button" onClick={() => externalSelect('program', 'node')}>External node program</button>
        <button type="button" onClick={() => externalSelect('work', 'edge')}>External edge work</button>
        <button type="button" onClick={() => {
          setLocation(current => ({ ...current, selectedId: undefined, selectedType: undefined }));
          setPreciseSelection('none');
          setPendingLocation(undefined);
        }}>Clear selection externally</button>
        <label><input type="checkbox" checked={deferHostUpdates} onChange={event => setDeferHostUpdates(event.target.checked)} /> Defer host updates</label>
        <button type="button" disabled={!pendingLocation} onClick={() => {
          if (!pendingLocation) return;
          setLocation(pendingLocation);
          setPendingLocation(undefined);
        }}>Apply pending navigation</button>
      </div>
      <div className="navigation-status" aria-live="polite">
        <output aria-label="Host precise selection">Host: {preciseSelection}</output>
        <output aria-label="Viewer callback status">Callbacks: {events.length} · reason: {latestReason}</output>
        <output aria-label="Pending navigation">Pending: {pendingLocation ? `${selectionLabel(pendingLocation)} · focus: ${pendingLocation.focusId ?? 'none'}` : 'none'}</output>
      </div>
    </section>
    <div className="navigation-viewer"><GraphExplorer
      document={snapshot} location={location} onLocationChange={navigate} searchFiltersCanvas={false}
      renderToolbar={toolbar}
      renderInspector={context => <div className="ge-inspector-body navigation-inspector">
        <h2>Host selection</h2>
        <output aria-label="Inspector precise selection">{preciseSelection}</output>
        <p>Graph selection: <code>{selectionLabel(context.location)}</code></p>
        <p>Record: {context.node?.label ?? context.edge?.kind ?? 'none'}</p>
        <p>Query: <code>{context.location.query || '(empty)'}</code></p>
        <p>Callbacks: {events.length} · latest reason: {latestReason}</p>
        <h3>Recent viewer events</h3>
        {events.length ? <ol start={Math.max(1, events.length - 5)}>{events.slice(-6).map((event, index) => <li key={events.length - 6 + index}>{event.reason} → {event.selection}</li>)}</ol> : <p>No viewer callbacks.</p>}
      </div>}
    /></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
