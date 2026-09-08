import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphExplorer } from '../src/react';
import { decodeLocation, encodeLocation, parseGraphDocument, prepareGraphExport } from '../src/core';
import type { GraphDocument, GraphLocation } from '../src/core';
import { examples, type Example } from './examples';
import { downloadFile, fileStem, makeOfflineReport, type OfflineShell } from './offline';
import '@xyflow/react/dist/style.css';
import '../src/react/style.css';
import './style.css';

const REPOSITORY = 'https://github.com/TheAxiomFoundation/orrery';
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const initialExample = () => examples.find(item => item.id === new URLSearchParams(window.location.search).get('example')) ?? examples[0];
const localFileRequested = () => new URLSearchParams(window.location.search).get('example') === 'local';
const localFileReminder = 'Local files are not stored in links. Open your graph JSON again to restore this view.';
const initialLocation = (example: Example) => localFileRequested() ? example.location : window.location.hash ? decodeLocation(window.location.hash) : example.location;

class ViewerBoundary extends Component<{ children: ReactNode; resetKey: string; onReset: () => void }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : 'This graph could not be displayed.' }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* The error is shown locally; no telemetry is sent. */ }
  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined });
  }
  render() {
    return this.state.error ? <div className="viewer-error" role="alert"><span className="section-label">Unable to display this graph</span><h2>The graph could not be laid out.</h2><p>{this.state.error}</p><button className="button primary" onClick={() => { this.setState({ error: undefined }); this.props.onReset(); }}>Return to an example</button></div> : this.props.children;
  }
}

function App() {
  const [example, setExample] = useState(initialExample);
  const [imported, setImported] = useState<GraphDocument>();
  const [importedName, setImportedName] = useState('');
  const [location, setLocation] = useState<GraphLocation>(() => initialLocation(initialExample()));
  const [error, setError] = useState('');
  const [status, setStatus] = useState(() => localFileRequested() ? localFileReminder : '');
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localId, setLocalId] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const shellPromise = useRef<Promise<OfflineShell> | undefined>(undefined);
  const localSnapshots = useRef(new Map<string, { document: GraphDocument; name: string }>());
  const importRequest = useRef(0);
  const cancelPendingImport = useCallback(() => {
    importRequest.current += 1;
    setLoading(false);
    if (fileInput.current) fileInput.current.value = '';
  }, []);
  const current = imported ?? example.document;
  const baseline = imported ? undefined : example.baseline;
  const resetKey = `${localId ?? example.id}:${current.id}:${current.revision ?? ''}`;

  useEffect(() => {
    const sync = () => {
      cancelPendingImport();
      const next = initialExample();
      // An imported graph exists only in this tab. History cannot fetch its bytes.
      if (new URLSearchParams(window.location.search).get('example') !== 'local') {
        setImported(undefined); setLocalId(undefined); setExample(next);
      } else {
        const local = localSnapshots.current.get(window.history.state?.orreryLocalId);
        if (local) { setImported(local.document); setImportedName(local.name); setLocalId(window.history.state.orreryLocalId); }
        else { setImported(undefined); setLocalId(undefined); setExample(next); setStatus(localFileReminder); setLocation(next.location); return; }
      }
      const isLocal = new URLSearchParams(window.location.search).get('example') === 'local';
      setLocation(window.location.hash ? decodeLocation(window.location.hash) : isLocal ? {} : next.location);
    };
    window.addEventListener('popstate', sync); window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, [cancelPendingImport]);

  const navigate = (next: GraphLocation) => {
    cancelPendingImport();
    const hash = encodeLocation(next);
    if (hash !== window.location.hash) {
      const onlyQueryChanged = encodeLocation({ ...next, query: undefined }) === encodeLocation({ ...location, query: undefined });
      window.history[onlyQueryChanged ? 'replaceState' : 'pushState'](window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
    }
    setLocation(next);
  };

  const changeExample = (id: string) => {
    cancelPendingImport();
    const next = examples.find(item => item.id === id) ?? examples[0];
    setExample(next); setImported(undefined); setLocalId(undefined); setError(''); setStatus(''); setLocation(next.location);
    const url = new URL(window.location.href); url.searchParams.set('example', next.id); url.hash = encodeLocation(next.location);
    window.history.pushState(null, '', url);
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    const request = ++importRequest.current;
    setError(''); setStatus(''); setLoading(true);
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than the 50 MB preview limit. Open a smaller graph projection.');
      const text = await file.text();
      if (request !== importRequest.current) return;
      const graph = parseGraphDocument(JSON.parse(text));
      // History survives reload; random keys prevent old entries aliasing new files.
      const nextLocalId = crypto.randomUUID();
      localSnapshots.current.set(nextLocalId, { document: graph, name: file.name });
      setImported(graph); setImportedName(file.name); setLocation({}); setLocalId(nextLocalId);
      const url = new URL(window.location.href); url.searchParams.set('example', 'local'); url.hash = '';
      window.history.pushState({ orreryLocalId: nextLocalId }, '', url);
      setStatus(`Opened ${file.name} in this browser. Nothing was uploaded.`);
      workspace.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (cause) {
      if (request !== importRequest.current) return;
      setError(cause instanceof SyntaxError ? 'This file is not valid JSON. Choose an Orrery GraphDocument JSON file.' : cause instanceof Error ? cause.message : 'This graph could not be opened.');
    } finally {
      if (request === importRequest.current) {
        setLoading(false); if (fileInput.current) fileInput.current.value = '';
      }
    }
  };

  const exportHtml = async () => {
    setExporting(true); setError(''); setStatus('');
    try {
      if (!shellPromise.current) shellPromise.current = fetch(new URL('./offline-shell.json', window.location.href)).then(async response => {
        if (!response.ok) throw new Error('The offline viewer could not be loaded. Please retry when this site is reachable.');
        const shell = await response.json() as OfflineShell;
        if (typeof shell.prefix !== 'string' || typeof shell.suffix !== 'string') throw new Error('The offline viewer assets are invalid.');
        return shell;
      }).catch(cause => { shellPromise.current = undefined; throw cause; });
      const html = await makeOfflineReport(current, await shellPromise.current, baseline);
      downloadFile(html, `${fileStem(current.title)}.html`, 'text/html;charset=utf-8');
      setStatus('Offline report saved. Open the HTML file to search and inspect without a connection.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The offline report could not be created.'); }
    finally { setExporting(false); }
  };

  return <>
    <header className="site-header"><a className="maker" href="https://axiom-foundation.org" aria-label="Axiom Foundation">An instrument by <strong>Axiom</strong></a><nav aria-label="Main navigation"><a href={`${REPOSITORY}#readme`}>Documentation <span aria-hidden="true">↗</span></a><a href={REPOSITORY}>Source <span aria-hidden="true">↗</span></a><span className="preview-label">Public preview</span></nav></header>
    <main>
      <section className="hero" aria-labelledby="orrery-title">
        <div className="hero-name"><span className="orbital-mark" aria-hidden="true"><i /><i /><i /></span><h1 id="orrery-title">Orrery</h1></div>
        <div className="hero-promise"><h2>See the system.<br /> Trace the work.</h2><p>Explore the connections, sources, and contributions<br className="desktop-break" /> behind a result.</p></div>
      </section>
      <section className="demo-section" ref={workspace} aria-label="Interactive graph explorer">
        <div className="demo-toolbar">
          <div className="example-picker"><label htmlFor="example-picker">Explore a system</label><select id="example-picker" value={imported ? 'local' : example.id} onChange={event => changeExample(event.target.value)}>{examples.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}{imported && <option value="local">Local · {importedName}</option>}</select></div>
          <div className="demo-actions"><button className="button" onClick={() => fileInput.current?.click()} disabled={loading}>{loading ? 'Opening…' : 'Open graph JSON'} <span aria-hidden="true">↑</span></button><button className="button primary" disabled={exporting} onClick={exportHtml}>{exporting ? 'Preparing report…' : 'Save offline report'} <span aria-hidden="true">↓</span></button></div>
          <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Open a local graph JSON file" className="file-input" onChange={event => void importFile(event.target.files?.[0])} />
        </div>
        <div className="example-context"><span className="example-indicator" aria-hidden="true" /><p>{imported ? 'Local graph. File contents stay in this browser; graph links open only when you choose them.' : example.summary}</p><button className="text-action" onClick={() => { downloadFile(prepareGraphExport(current).json, `${fileStem(current.title)}.json`, 'application/json'); setStatus('Graph JSON saved.'); }}>Download JSON <span aria-hidden="true">↓</span></button></div>
        {error && <div className="site-message site-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        <div className="status-message" role="status" aria-live="polite">{status}</div>
        {!imported && example.caveat && <details className="example-caveat"><summary>Exploratory · source-review issues remain</summary><p>{example.caveat}</p></details>}
        {!imported && example.guide && <div className="walkthrough" aria-label="Trace this result"><span>Follow the work</span>{example.guide.map((step, index) => <button key={step.selectedId} title={step.description} onClick={() => navigate({ ...location, selectedId: step.selectedId, selectedType: 'node', focusId: step.focusId, depth: 1, direction: 'both' })}><small>{String(index + 1).padStart(2, '0')}</small>{step.label}<span aria-hidden="true">↗</span></button>)}</div>}
        <div className="viewer-shell"><ViewerBoundary resetKey={resetKey} onReset={() => changeExample(examples[0].id)}><GraphExplorer key={resetKey} document={current} baseline={baseline} location={location} onLocationChange={navigate} /></ViewerBoundary></div>
      </section>
      <section className="explanation" aria-labelledby="explanation-title"><div className="explanation-intro"><span className="section-label">From a result to its reasons</span><h2 id="explanation-title">Keep the connections<br />in view.</h2><p>A calculation, a forecast, a plan. Orrery gives each piece a place—and lets you follow what connects them.</p></div><div className="explanation-details"><article><span className="detail-number">01</span><div><h3>Relationships with meaning</h3><p>Distinguish a dependency from a citation or a containing record. Keep the meaning your system gave each edge.</p></div></article><article><span className="detail-number">02</span><div><h3>The work behind each node</h3><p>Inspect source records, agent activity, and revisions. Keep authorship separate from execution, and supplied evidence separate from observed use.</p></div></article><article><span className="detail-number">03</span><div><h3>Receipts, with their scope intact</h3><p>Attach provenance declarations and separately supplied verification. A Receipt establishes its stated custody scope; it does not establish that a claim is correct.</p></div></article></div></section>
      <section className="bring-graph" aria-labelledby="bring-title"><div><span className="section-label">Open source · MIT</span><h2 id="bring-title">Your system.<br />A shared instrument.</h2><p>Embed Orrery in your app, or open a graph here.<br />Keep your domain logic and your data where they belong.</p><div className="bring-actions"><button className="button" onClick={() => fileInput.current?.click()}>Open a local graph <span aria-hidden="true">↑</span></button><a href={`${REPOSITORY}/blob/main/docs/react-hosts.md`}>Embedding guide <span aria-hidden="true">↗</span></a></div></div><div className="integration-note"><span className="section-label">React embedding</span><pre><code>{'import { Orrery } from\n  "@axiom-foundation/orrery/react";\nimport "@axiom-foundation/orrery/style.css";\n\n<Orrery document={graph} />'}</code></pre><p>Works with React 18 and 19. Portable graph JSON.<br />Self-contained HTML reports.</p></div></section>
    </main>
    <footer className="site-footer"><span className="footer-wordmark">Orrery <small>by Axiom</small></span><span>Connected systems, made inspectable.</span><a href={`${REPOSITORY}/blob/main/LICENSE`}>MIT license <span aria-hidden="true">↗</span></a></footer>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
