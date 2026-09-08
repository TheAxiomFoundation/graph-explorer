import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphExplorer } from '../src/react';
import { parseGraphDocument } from '../src/core';
import fixture from './layout-recovery.json';
import '@xyflow/react/dist/style.css';
import '../src/react/style.css';
const document = parseGraphDocument(fixture);
function App() {
  const [custom, setCustom] = useState(false);
  return <><header className="fixture-controls"><label><input type="checkbox" checked={custom} onChange={event => setCustom(event.target.checked)} /> Custom 310 × 202 cards</label><span>Five synthetic records · six directed relationships, including a cycle and parallel edges</span></header><main className="fixture-viewer"><GraphExplorer document={document} initialLocation={{ selectedId: 'n1' }} getNodeSize={custom ? () => ({ width: 310, height: 202 }) : undefined} /></main></>;
}
createRoot(globalThis.document.getElementById('root')!).render(<App />);
