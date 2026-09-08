import { useCallback, useEffect, useRef, useState } from 'react';
import type { GraphNode } from '../core/types.js';

const PAGE_SIZE = 100;

/** Page only the rendered index. Search results and graph topology stay complete. */
export function RecordIndex({ records, selectedId, changes, onSelect, revealKey }: {
  records: readonly GraphNode[];
  selectedId?: string;
  changes: ReadonlyMap<string, string>;
  onSelect: (id: string) => void;
  revealKey: string;
}) {
  const selectedPage = () => Math.max(0, Math.floor(records.findIndex(node => node.id === selectedId) / PAGE_SIZE));
  const [state, setState] = useState(() => ({ records, selectedId, page: selectedPage() }));
  // A new result set starts at its first page; a new selection within the same
  // result set reveals that record. Page changes are entirely local to this list.
  const current = records !== state.records ? { records, selectedId, page: 0 }
    : selectedId !== state.selectedId ? { records, selectedId, page: records.some(node => node.id === selectedId) ? selectedPage() : state.page }
      : state;
  const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const page = Math.min(current.page, pages - 1);
  const start = page * PAGE_SIZE;
  const rows = records.slice(start, start + PAGE_SIZE);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef(true);
  const pendingReset = useRef(true);
  useEffect(() => { if (current !== state) setState(current); }, [current, state]);
  useEffect(() => { pendingReset.current = true; }, [records, page]);
  useEffect(() => { pendingReveal.current = true; }, [records, page, selectedId]);
  const revealPending = useCallback(() => {
    const list = listRef.current;
    // Selection can happen while mobile Browse is hidden. Reveal it when that
    // pane returns; a pane switch alone preserves the user's existing scroll.
    if (!pendingReveal.current || !list?.clientHeight) return;
    if (pendingReset.current) list.scrollTop = 0;
    list.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    pendingReveal.current = false;
    pendingReset.current = false;
  }, []);
  useEffect(revealPending, [records, page, selectedId, revealKey, revealPending]);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // Widening from mobile Inspect to desktop reveals the index without a
    // mobilePane change. Consume any pending selection when it becomes visible.
    const observer = new ResizeObserver(revealPending);
    observer.observe(list);
    return () => observer.disconnect();
  }, [revealPending]);
  const changePage = (next: number) => setState({ records, selectedId, page: Math.min(pages - 1, Math.max(0, next)) });
  return <>
    <div className="ge-index-list" ref={listRef}>{rows.map(node => <button type="button" key={node.id} className={selectedId === node.id ? 'is-selected' : ''} aria-current={selectedId === node.id ? 'true' : undefined} onClick={() => onSelect(node.id)}>
      <span className="ge-index-kind">{node.kind}</span><strong>{node.label}</strong><small title={node.id}>{node.id}</small>{changes.get(node.id) && <span className="ge-change">{changes.get(node.id)}</span>}
    </button>)}{records.length === 0 && <p className="ge-empty">No matching records.</p>}</div>
    {pages > 1 && <nav className="ge-index-pages" aria-label="Record index pages">
      <span aria-live="polite">{start + 1}–{Math.min(start + PAGE_SIZE, records.length)} of {records.length} records</span>
      <div><button type="button" disabled={page === 0} onClick={() => changePage(page - 1)}>Previous records</button><button type="button" disabled={page === pages - 1} onClick={() => changePage(page + 1)}>Next records</button></div>
    </nav>}
  </>;
}
