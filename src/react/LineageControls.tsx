import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { GraphDocument, GraphLineageVariable } from '../core/types.js';
import type { LineageTrace } from '../core/lineage.js';

const PAGE_SIZE = 100;

export function lineageVariable(document: GraphDocument, rootId?: string, variableId?: string): GraphLineageVariable | undefined {
  const variables = document.lineage?.variables ?? [];
  return variables.find(variable => variable.id === variableId && variable.stages.some(stage => stage.nodeId === rootId))
    ?? variables.find(variable => variable.stages.some(stage => stage.nodeId === rootId));
}

/** Variable names and stages are supplied by the adapter, never inferred from IDs. */
export function VariableIndex({ document, rootId, variableId, inputId, searchRef, onTrace }: {
  document: GraphDocument;
  rootId?: string;
  variableId?: string;
  inputId: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onTrace: (nodeId: string, variableId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const variables = document.lineage?.variables ?? [];
  const active = lineageVariable(document, rootId, variableId);
  const matches = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return variables.filter(variable => {
      const text = `${variable.label} ${variable.id} ${variable.description ?? ''} ${variable.stages.map(stage => `${stage.label} ${stage.id} ${stage.nodeId}`).join(' ')}`.toLocaleLowerCase();
      return words.every(word => text.includes(word));
    });
  }, [variables, query]);
  const resultKey = JSON.stringify([document.id, document.revision, query, matches.map(variable => variable.id)]);
  const selectedIndex = matches.findIndex(variable => variable.id === active?.id);
  const selectedPage = Math.max(0, Math.floor(selectedIndex / PAGE_SIZE));
  const [navigation, setNavigation] = useState(() => ({ resultKey, selectedId: active?.id, page: selectedPage }));
  const current = resultKey !== navigation.resultKey ? { resultKey, selectedId: active?.id, page: 0 }
    : active?.id !== navigation.selectedId ? { resultKey, selectedId: active?.id, page: selectedIndex >= 0 ? selectedPage : navigation.page } : navigation;
  useEffect(() => { if (current !== navigation) setNavigation(current); }, [current, navigation]);
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const page = Math.min(current.page, pages - 1);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingReset = useRef(true), pendingReveal = useRef(true);
  const revealFrame = useRef<number | undefined>(undefined);
  // Semantic result identity keeps equivalent host document objects from
  // resetting a user's page or manual scroll position.
  useEffect(() => { pendingReset.current = true; pendingReveal.current = true; }, [resultKey]);
  useEffect(() => { pendingReset.current = true; }, [page]);
  useEffect(() => { pendingReveal.current = true; }, [active?.id]);
  const revealPending = useCallback(() => {
    if ((!pendingReset.current && !pendingReveal.current) || revealFrame.current !== undefined) return;
    // Parent focus handling can hide Browse after this child's effects. Defer
    // until that update commits, retaining the request while the list is hidden.
    revealFrame.current = requestAnimationFrame(() => {
      revealFrame.current = undefined;
      const list = listRef.current;
      if (!list?.clientHeight || (!pendingReset.current && !pendingReveal.current)) return;
      if (pendingReset.current) list.scrollTop = 0;
      if (pendingReveal.current) list.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
      pendingReset.current = false; pendingReveal.current = false;
    });
  }, []);
  useEffect(revealPending, [resultKey, page, active?.id, revealPending]);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // Hidden mobile Browse becoming visible, including desktop widening, may
    // not change selection. Resize consumes only an outstanding reveal/reset.
    const observer = new ResizeObserver(revealPending);
    observer.observe(list);
    return () => {
      observer.disconnect();
      if (revealFrame.current !== undefined) cancelAnimationFrame(revealFrame.current);
      revealFrame.current = undefined;
    };
  }, [revealPending]);
  const changePage = (next: number) => {
    pendingReset.current = true; pendingReveal.current = false;
    setNavigation({ ...current, page: Math.min(pages - 1, Math.max(0, next)) });
  };
  const stage = active?.stages.find(item => item.nodeId === rootId);
  return <>
    <div className="ge-index-search"><label htmlFor={inputId}>Find a variable <kbd>/</kbd></label><input ref={searchRef} id={inputId} type="search" placeholder="Variable or stage…" value={query} onChange={event => setQuery(event.target.value)} /></div>
    {active && <div className="ge-lineage-stage-picker"><label htmlFor={`${inputId}-stage`}>Stage · {active.label}</label><select id={`${inputId}-stage`} value={stage?.id ?? ''} onChange={event => { const next = active.stages.find(item => item.id === event.target.value); if (next) onTrace(next.nodeId, active.id); }}>{active.stages.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>}
    <div className="ge-index-count" aria-live="polite">{matches.length} variables</div>
    <div className="ge-index-list ge-variable-list" ref={listRef}>{matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(variable => <button type="button" key={variable.id} aria-current={variable.id === active?.id ? 'true' : undefined} onClick={() => {
      // Authored order is a presentation default, not a claim of chronology.
      const next = variable.id === active?.id ? stage : variable.stages.at(-1);
      if (next) onTrace(next.nodeId, variable.id);
    }}><strong>{variable.label}</strong><small title={variable.id}>{variable.id}</small><span className="ge-variable-stages">{variable.stages.length} {variable.stages.length === 1 ? 'stage' : 'stages'}</span>{variable.description && <span className="ge-variable-description">{variable.description}</span>}</button>)}{!matches.length && <p className="ge-empty">No matching variables.</p>}</div>
    {pages > 1 && <nav className="ge-index-pages" aria-label="Variable index pages"><span aria-live="polite">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, matches.length)} of {matches.length} variables</span><div><button type="button" disabled={page === 0} onClick={() => changePage(page - 1)}>Previous variables</button><button type="button" disabled={page === pages - 1} onClick={() => changePage(page + 1)}>Next variables</button></div></nav>}
    <footer className="ge-index-footer">Choose a variable and stage to follow its declared value dependencies. Select any record to inspect it.</footer>
  </>;
}

export function TraceDetails({ trace, document, hiddenCount, onSelect }: {
  trace: LineageTrace;
  document: GraphDocument;
  hiddenCount: number;
  onSelect: (id: string) => void;
}) {
  const names = useMemo(() => new Map(document.nodes.map(node => [node.id, node.label])), [document]);
  const unknown = trace.boundaries.filter(boundary => boundary.kind === 'unknown');
  const sources = trace.boundaries.filter(boundary => boundary.kind === 'source');
  if (!trace.validRoot) return <p className="ge-trace-notice" role="status">This trace is unavailable. Choose a variable or return to the whole graph.</p>;
  return <div className="ge-trace-details">
    <details><summary>{sources.length} source {sources.length === 1 ? 'boundary' : 'boundaries'} · {unknown.length} unknown{trace.cycles.length > 0 && ` · ${trace.cycles.length} ${trace.cycles.length === 1 ? 'cycle' : 'cycles'}`}</summary>
      <p>Boundaries describe where the supplied lineage stops. They do not verify a value.</p>
      <ul>{trace.boundaries.map(boundary => <li key={boundary.nodeId}><strong>{boundary.kind === 'source' ? 'Source' : 'Unknown'}</strong> · <button type="button" className="ge-text-button" onClick={() => onSelect(boundary.nodeId)}>{names.get(boundary.nodeId) ?? boundary.nodeId}</button><span>{boundary.description}</span></li>)}{trace.cycles.map((cycle, index) => <li key={`cycle-${index}`}><strong>Cycle group · unresolved</strong><span>{cycle.map((id, nodeIndex) => <span key={id}>{nodeIndex > 0 && ', '}<button type="button" className="ge-text-button" onClick={() => onSelect(id)}>{names.get(id) ?? id}</button></span>)}</span></li>)}</ul>
    </details>
    {hiddenCount > 0 && <p className="ge-trace-notice">{hiddenCount} trace {hiddenCount === 1 ? 'record is' : 'records are'} excluded by the host canvas. No replacement connections are inferred.</p>}
  </div>;
}
