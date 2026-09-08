import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphExplorer } from '../src/react';
import { decodeLocation, encodeLocation, parseGraphDocument } from '../src/core';
import type { GraphDocument, GraphLocation, ReceiptAssessment } from '../src/core';
import { axiomExample, thesisExample } from './adapter-examples';
import '@xyflow/react/dist/style.css';
import '../src/react/style.css';
import './page.css';

interface SnapshotPayload {
  document: GraphDocument;
  baseline?: GraphDocument;
  assessments?: ReceiptAssessment[];
  documentSha256?: string;
}

function readEmbeddedSnapshot(): SnapshotPayload | undefined {
  const embedded = document.getElementById('graph-explorer-data');
  if (!embedded) return;
  const data = JSON.parse(embedded.textContent ?? '{}');
  return {
    document: parseGraphDocument(data.document),
    ...(data.baseline ? { baseline: parseGraphDocument(data.baseline) } : {}),
    ...(Array.isArray(data.assessments) ? { assessments: data.assessments } : {}),
    ...(typeof data.documentSha256 === 'string' ? { documentSha256: data.documentSha256 } : {}),
  };
}

const exampleFromUrl = () => new URLSearchParams(window.location.search).get('example') === 'thesis' ? 'thesis' : 'axiom';

function App({ embedded }: { embedded?: SnapshotPayload }) {
  const [example, setExample] = useState(exampleFromUrl);
  const [location, setLocation] = useState(() => decodeLocation(window.location.hash));
  const snapshot = embedded ?? { document: example === 'thesis' ? thesisExample : axiomExample };
  useEffect(() => {
    const sync = () => { setExample(exampleFromUrl()); setLocation(decodeLocation(window.location.hash)); };
    window.addEventListener('popstate', sync); window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, []);
  const navigate = (next: GraphLocation) => {
    const hash = encodeLocation(next);
    if (hash !== window.location.hash) {
      const onlySearchChanged = encodeLocation({ ...next, query: undefined }) === encodeLocation({ ...location, query: undefined });
      if (onlySearchChanged) window.history.replaceState(null, '', hash); else window.history.pushState(null, '', hash);
    }
    setLocation(next);
  };
  const changeExample = (next: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('example', next); url.hash = '';
    window.history.pushState(null, '', url);
    setExample(next); setLocation({});
  };
  return <div className="ge-example-page">
    {!embedded && <div className="ge-example-bar"><span>Recorded examples</span><label>Source <select aria-label="Example graph" value={example} onChange={event => changeExample(event.target.value)}><option value="axiom">Axiom · rule dependencies</option><option value="thesis">Thesis · source replay</option></select></label><span>Native records · no live evaluation</span></div>}
    <GraphExplorer key={snapshot.document.id} {...snapshot} location={location} onLocationChange={navigate} />
  </div>;
}

const root = createRoot(document.getElementById('root')!);
try {
  root.render(<App embedded={readEmbeddedSnapshot()} />);
} catch (error) {
  root.render(<main className="ge-load-error"><h1>This graph could not be opened</h1><p>{error instanceof Error ? error.message : 'Invalid snapshot data'}</p></main>);
}
