import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import dagre from '@dagrejs/dagre';
import {
  Background, BaseEdge, Controls, Handle, MarkerType, MiniMap, Position,
  ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps, type Viewport,
} from '@xyflow/react';
import type {
  ActivityRecord, GraphDocument, GraphEdge, GraphLocation, GraphNode,
  JsonValue, ReceiptAssessment, SourceRef, StatusBadge, SubjectRef,
} from '../core/types.js';
import { diffGraphs, getReceiptAssessment, safeUrl, traverse } from '../core/graph.js';
import { isReceiptAssessment } from '../core/validate.js';

export interface GraphInspectorContext {
  document: GraphDocument;
  node?: GraphNode;
  edge?: GraphEdge;
  selectNode: (id: string) => void;
  selectEdge: (id: string) => void;
  focusNode: (id: string, direction?: GraphLocation['direction']) => void;
}

export interface GraphExplorerProps {
  document: GraphDocument;
  baseline?: GraphDocument;
  /** Trusted host assessments; declarations inside graph JSON never verify a receipt. */
  assessments?: ReceiptAssessment[];
  documentSha256?: string;
  initialLocation?: GraphLocation;
  /** Controlled navigation lets the host preserve its own routing and Back/Forward behavior. */
  location?: GraphLocation;
  onLocationChange?: (location: GraphLocation) => void;
  renderNodeDetails?: (node: GraphNode, document: GraphDocument) => ReactNode;
  renderInspector?: (context: GraphInspectorContext) => ReactNode;
  revisions?: { id: string; label: string }[];
  currentRevisionId?: string;
  onRevisionChange?: (revisionId: string) => void;
}

type CardData = { record: GraphNode; change?: string; childCount: number; collapsed: boolean };
type CardNode = Node<CardData, 'record'>;
type RelationEdge = Edge<{ record: GraphEdge; offset: number }, 'relation'>;
type InspectorTab = 'record' | 'sources' | 'activity' | 'receipts' | 'history';
const WIDTH = 248, HEIGHT = 126;
const EMPTY_ASSESSMENTS: ReceiptAssessment[] = [];

/** Plain destinations only. Relative artifacts remain useful in offline reports. */
function destination(value: string | undefined): string | undefined {
  return value ? safeUrl(value) ?? undefined : undefined;
}

function Badge({ badge }: { badge: StatusBadge }) {
  const tone = ['positive', 'warning', 'negative'].includes(badge.tone ?? '') ? badge.tone : 'neutral';
  return <span className={`ge-badge ge-tone-${tone}`}>{badge.label}</span>;
}

function RecordNode({ data }: NodeProps<CardNode>) {
  return <div className="ge-node-card">
    <Handle type="target" position={Position.Left} />
    <div className="ge-node-eyebrow"><span>{data.record.kind}</span>{data.change && <span className="ge-change">{data.change}</span>}</div>
    <strong title={data.record.label}>{data.record.label}</strong>
    <div className="ge-node-statuses">{data.record.statuses?.slice(0, 2).map((badge, i) => <Badge key={i} badge={badge} />)}
      {(data.record.statuses?.length ?? 0) > 2 && <span className="ge-more-status">+{data.record.statuses!.length - 2}</span>}
      {data.childCount > 0 && <span className="ge-child-count">{data.childCount} children{data.collapsed ? ' · collapsed' : ''}</span>}
    </div>
    <Handle type="source" position={Position.Right} />
  </div>;
}

function Relation({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, label, data, selected }: EdgeProps<RelationEdge>) {
  const offset = data?.offset ?? 0;
  const distance = Math.max(64, Math.abs(targetX - sourceX) * .5);
  const self = data?.record.source === data?.record.target;
  const loopRise = 100 + offset;
  const path = self
    ? `M ${sourceX} ${sourceY} C ${sourceX + 70 + offset / 4} ${sourceY - loopRise}, ${targetX - 70 - offset / 4} ${targetY - loopRise}, ${targetX} ${targetY}`
    : `M ${sourceX} ${sourceY} C ${sourceX + distance} ${sourceY + offset}, ${targetX - distance} ${targetY + offset}, ${targetX} ${targetY}`;
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: selected ? 2.4 : 1.4 }}
    label={label} labelX={(sourceX + targetX) / 2} labelY={(sourceY + targetY) / 2 + (self ? -loopRise * .75 : offset * .75)}
    labelStyle={{ fontSize: 10, fill: 'var(--ge-muted)' }} labelBgStyle={{ fill: 'var(--ge-canvas)', fillOpacity: .95 }} labelBgPadding={[5, 3]} labelBgBorderRadius={3} />;
}

const nodeTypes = { record: RecordNode };
const edgeTypes = { relation: Relation };

function useChanges(current: GraphDocument, baseline?: GraphDocument) {
  return useMemo(() => {
    const nodes = new Map<string, string>(), edges = new Map<string, string>();
    if (baseline) {
      const diff = diffGraphs(baseline, current);
      for (const id of diff.nodes.added) nodes.set(id, 'Added');
      for (const id of diff.nodes.changed) nodes.set(id, 'Changed');
      for (const id of diff.edges.added) edges.set(id, 'Added');
      for (const id of diff.edges.changed) edges.set(id, 'Changed');
    }
    const currentNodeIds = new Set(current.nodes.map(node => node.id)), currentEdgeIds = new Set(current.edges.map(edge => edge.id));
    return { nodes, edges, removedNodes: baseline?.nodes.filter(node => !currentNodeIds.has(node.id)) ?? [], removedEdges: baseline?.edges.filter(edge => !currentEdgeIds.has(edge.id)) ?? [] };
  }, [current, baseline]);
}

function JsonField({ name, value }: { name: string; value: JsonValue }) {
  const [open, setOpen] = useState(false);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    return <details className="ge-data-compound" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><span>{name}</span><small>{entries.length} {Array.isArray(value) ? 'items' : 'fields'}</small></summary>
      {open && <div>{entries.length ? entries.map(([key, child]) => <JsonField key={key} name={key} value={child} />) : <code>{Array.isArray(value) ? '[]' : '{}'}</code>}</div>}
    </details>;
  }
  return <div className="ge-field"><dt>{name}</dt><dd>{typeof value === 'string' ? value || '""' : <code>{JSON.stringify(value)}</code>}</dd></div>;
}

function ArtifactLink({ label, uri }: { label: string; uri?: string }) {
  const href = destination(uri);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}<span aria-hidden="true"> ↗</span></a> : <span>{label}</span>;
}

function Sources({ sources }: { sources: SourceRef[] }) {
  return sources.length ? <ul className="ge-evidence-list">{sources.map((source, index) => <li key={index}>
    <ArtifactLink label={source.label} uri={source.url} />
    {source.sha256 && <code className="ge-digest" title="Declared SHA-256">SHA-256 {source.sha256}</code>}
  </li>)}</ul> : <p className="ge-empty">No sources attached to this record.</p>;
}

function Activity({ activity, select, document }: { activity: ActivityRecord; select: (id: string, type?: 'node' | 'edge') => void; document: GraphDocument }) {
  const nodeById = new Map(document.nodes.map(node => [node.id, node]));
  const edgeById = new Map(document.edges.map(edge => [edge.id, edge]));
  const link = (subject: SubjectRef) => subject.type === 'activity' ? <span>{subject.id}</span>
    : <button className="ge-text-button" type="button" onClick={() => select(subject.id, subject.type as 'node' | 'edge')}>{(subject.type === 'node' ? nodeById.get(subject.id)?.label : edgeById.get(subject.id)?.label ?? edgeById.get(subject.id)?.kind) ?? subject.id}</button>;
  return <section className="ge-activity">
    <div className="ge-eyebrow">{activity.kind}</div><h4>{activity.label}</h4>
    {activity.agent && <p>{activity.agent.name}{activity.agent.model && <span className="ge-muted"> · {activity.agent.model}</span>}{activity.agent.version && <span className="ge-muted"> · {activity.agent.version}</span>}</p>}
    {(activity.startedAt || activity.endedAt) && <p className="ge-muted ge-small">{activity.startedAt && <time>{activity.startedAt}</time>}{activity.endedAt && <> → <time>{activity.endedAt}</time></>}</p>}
    {(['provided', 'cited', 'consumed'] as const).map(role => {
      const inputs = activity.inputs?.filter(input => input.role === role) ?? [];
      return inputs.length > 0 && <div key={role}><h5>{role} inputs</h5><ul className="ge-compact-list">{inputs.map((input, i) => <li key={i}>{link(input.subject)}{input.subject.revision && <code className="ge-revision">{input.subject.revision}</code>}</li>)}</ul></div>;
    })}
    {!!activity.outputs?.length && <><h5>Outputs</h5><ul className="ge-compact-list">{activity.outputs.map((output, i) => <li key={i}>{link(output)}{output.revision && <code className="ge-revision">{output.revision}</code>}</li>)}</ul></>}
    {!!activity.artifactIds?.length && <><h5>Artifacts</h5><ul className="ge-compact-list">{activity.artifactIds.map(id => {
      const artifact = document.artifacts?.find(item => item.id === id);
      return <li key={id}><ArtifactLink label={artifact?.label ?? id} uri={artifact?.uri} />{artifact?.sha256 && <code className="ge-digest">{artifact.sha256}</code>}</li>;
    })}</ul></>}
    {activity.data && <details><summary>Activity data</summary><pre className="ge-json">{JSON.stringify(activity.data, null, 2)}</pre></details>}
  </section>;
}

function Explorer({ document, baseline, assessments = EMPTY_ASSESSMENTS, documentSha256, initialLocation, location: controlledLocation, onLocationChange, renderNodeDetails, renderInspector, revisions, currentRevisionId, onRevisionChange }: GraphExplorerProps) {
  const generatedId = useId();
  const [internalLocation, setInternalLocation] = useState<GraphLocation>(() => initialLocation ?? {});
  const location = controlledLocation ?? internalLocation;
  const locationRef = useRef(location);
  locationRef.current = location;
  const [tab, setTab] = useState<InspectorTab>('record');
  const [mobilePane, setMobilePane] = useState<'index' | 'graph' | 'inspector'>('graph');
  const depth = location.depth ?? 1;
  const showContainment = location.showContainment ?? true;
  const [ready, setReady] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState('');
  const viewports = useRef(new Map<string, Viewport>());
  const { fitView, setViewport } = useReactFlow();
  const changes = useChanges(document, baseline);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setCanvasSize(`${Math.round(width)}x${Math.round(height)}`);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  const nodesById = useMemo(() => new Map(document.nodes.map(node => [node.id, node])), [document]);
  const edgesById = useMemo(() => new Map(document.edges.map(edge => [edge.id, edge])), [document]);
  const selectedType = location.selectedType ?? 'node';
  const selected = location.selectedId ? (selectedType === 'edge' ? edgesById.get(location.selectedId) ?? baseline?.edges.find(edge => edge.id === location.selectedId) : nodesById.get(location.selectedId) ?? baseline?.nodes.find(node => node.id === location.selectedId)) : undefined;
  const removed = Boolean(selected && !(selectedType === 'edge' ? edgesById : nodesById).has(selected.id));
  const selectedNode = selected && selectedType === 'node' ? selected as GraphNode : undefined;
  const selectedEdge = selected && selectedType === 'edge' ? selected as GraphEdge : undefined;
  const focus = location.focusId ? nodesById.get(location.focusId) : undefined;
  const kinds = useMemo(() => [...new Set(document.nodes.map(node => node.kind))].sort(), [document]);
  const childCounts = useMemo(() => {
    const children = new Map<string, Set<string>>();
    for (const node of document.nodes) if (node.parentId) { const ids = children.get(node.parentId) ?? new Set(); ids.add(node.id); children.set(node.parentId, ids); }
    for (const edge of document.edges) if (edge.category === 'containment') { const ids = children.get(edge.source) ?? new Set(); ids.add(edge.target); children.set(edge.source, ids); }
    return children;
  }, [document]);
  const update = useCallback((patch: Partial<GraphLocation>) => {
    const next = { ...locationRef.current, ...patch };
    locationRef.current = next;
    if (controlledLocation === undefined) setInternalLocation(next);
    onLocationChange?.(next);
  }, [controlledLocation, onLocationChange]);
  const select = useCallback((id: string, type: 'node' | 'edge' = 'node') => { update({ selectedId: id, selectedType: type }); setMobilePane('inspector'); }, [update]);
  const explore = (id: string, direction: GraphLocation['direction'] = 'both') => { update({ selectedId: id, selectedType: 'node', focusId: id, direction }); setMobilePane('graph'); };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!shellRef.current?.contains(event.target as globalThis.Node)) return;
      const target = event.target as HTMLElement;
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      if (event.key === '/' && !editing && !event.metaKey && !event.ctrlKey) { event.preventDefault(); setMobilePane('index'); searchRef.current?.focus(); }
      if (event.key === 'Escape' && !editing) { update({ selectedId: undefined, selectedType: undefined }); setMobilePane('graph'); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [update]);

  const matching = useMemo(() => {
    const words = (location.query ?? '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return document.nodes.filter(node => (!location.kinds?.length || location.kinds.includes(node.kind))
      && words.every(word => `${node.label} ${node.id} ${node.kind} ${node.description ?? ''} ${JSON.stringify(node.data ?? {})}`.toLocaleLowerCase().includes(word)));
  }, [document, location.query, location.kinds]);
  const visibleNodes = useMemo(() => {
    const hidden = new Set<string>();
    for (const id of location.collapsedIds ?? []) {
      const queue = [...(childCounts.get(id) ?? [])];
      for (let i = 0; i < queue.length; i++) if (queue[i] !== id && !hidden.has(queue[i])) { hidden.add(queue[i]); queue.push(...childCounts.get(queue[i]) ?? []); }
    }
    let visible = matching.filter(node => !hidden.has(node.id));
    if (focus) {
      const visited = traverse(document, focus.id, location.direction ?? 'both', { maxDepth: depth,
        ...(showContainment ? {} : { categories: ['dependency', 'evidence', 'provenance', 'reference', undefined] as GraphEdge['category'][] }) });
      visible = visible.filter(node => visited.has(node.id));
      if (!visible.some(node => node.id === focus.id)) visible.unshift(focus);
    }
    return visible;
  }, [matching, childCounts, location.collapsedIds, focus, depth, document.edges, showContainment, location.direction]);
  const layout = useMemo(() => {
    const ids = new Set(visibleNodes.map(node => node.id));
    const relationships = document.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && (showContainment || edge.category !== 'containment'));
    const graph = new dagre.graphlib.Graph({ multigraph: true });
    graph.setGraph({ rankdir: 'LR', ranksep: 116, nodesep: 40, edgesep: 24, marginx: 32, marginy: 32 });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const node of visibleNodes) graph.setNode(node.id, { width: WIDTH, height: HEIGHT });
    for (const edge of relationships) graph.setEdge(edge.source, edge.target, {}, edge.id);
    if (visibleNodes.length) dagre.layout(graph);
    const nodes: CardNode[] = visibleNodes.map(record => {
      const point = graph.node(record.id);
      return { id: record.id, type: 'record', position: { x: point.x - WIDTH / 2, y: point.y - HEIGHT / 2 },
        data: { record, change: changes.nodes.get(record.id), childCount: childCounts.get(record.id)?.size ?? 0, collapsed: location.collapsedIds?.includes(record.id) ?? false },
        style: { width: WIDTH, height: HEIGHT }, ariaLabel: `${record.label}, ${record.kind}${record.statuses?.map(status => `, ${status.label}`).join('') ?? ''}`, };
    });
    const pairs = new Map<string, GraphEdge[]>();
    for (const edge of relationships) { const key = JSON.stringify([edge.source, edge.target]); const list = pairs.get(key) ?? []; list.push(edge); pairs.set(key, list); }
    const edges: RelationEdge[] = relationships.map(record => {
      const pair = pairs.get(JSON.stringify([record.source, record.target]))!;
      const offset = record.source === record.target ? pair.indexOf(record) * 48 : (pair.indexOf(record) - (pair.length - 1) / 2) * 54;
      return { id: record.id, type: 'relation', source: record.source, target: record.target, label: record.kind,
        data: { record, offset }, ariaLabel: `${nodesById.get(record.source)?.label}: ${record.kind}: ${nodesById.get(record.target)?.label}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#839082', width: 14, height: 14 },
        style: { stroke: '#839082', ...(record.category === 'containment' || record.category === 'reference' ? { strokeDasharray: '5 5' } : {}) },
      };
    });
    return { nodes, edges };
  }, [visibleNodes, document.edges, showContainment, changes.nodes, childCounts, location.collapsedIds, nodesById]);
  // Selection is deliberately absent: inspecting a record does not move the camera.
  const sceneKey = JSON.stringify([document.id, document.revision, location.focusId, location.direction, depth, location.query, location.kinds, location.collapsedIds, showContainment, canvasSize]);
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      const saved = viewports.current.get(sceneKey);
      if (saved) void setViewport(saved, { duration: 0 }); else void fitView({ padding: .16, minZoom: .12, maxZoom: 1, duration: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, sceneKey, fitView, setViewport]);
  useEffect(() => {
    if (!ready || mobilePane !== 'graph' || !window.matchMedia('(max-width: 760px)').matches) return;
    const frame = requestAnimationFrame(() => {
      const saved = viewports.current.get(sceneKey);
      if (saved) void setViewport(saved, { duration: 0 }); else void fitView({ padding: .16, maxZoom: 1, duration: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, mobilePane, sceneKey, fitView, setViewport]);
  const allSources = selected?.sources ?? [];
  const activities = (document.activities ?? []).filter(activity => selected && [...activity.inputs?.map(input => input.subject) ?? [], ...activity.outputs ?? []].some(subject => subject.type === selectedType && subject.id === selected.id));
  const receipts = (document.receipts ?? []).filter(receipt => !selected || receipt.subjects.some(subject => subject.type === selectedType && subject.id === selected.id) || receipt.subjects.some(subject => subject.type === 'activity' && activities.some(activity => activity.id === subject.id)));
  const relations = selectedNode ? document.edges.filter(edge => edge.source === selectedNode.id || edge.target === selectedNode.id) : [];
  const tabs: [InspectorTab, string][] = [['record', 'Record'], ['sources', 'Sources'], ['activity', 'Activity'], ['receipts', 'Receipts'], ['history', 'History']];

  return <div className={`ge-explorer ge-pane-${mobilePane}`} ref={shellRef} style={{ '--ge-instance': generatedId } as CSSProperties}>
    <header className="ge-header"><div className="ge-brand"><span className="ge-mark" aria-hidden="true">⌘</span><div><div className="ge-eyebrow">Graph explorer</div><h1>{document.title}</h1></div></div>
      <div className="ge-document-meta"><span>{document.nodes.length} records · {document.edges.length} relationships</span>{revisions?.length ? <label className="ge-revision-picker">Revision <select aria-label="Snapshot revision" value={currentRevisionId ?? ''} onChange={event => onRevisionChange?.(event.target.value)} disabled={!onRevisionChange}><option value="" disabled>Select revision</option>{revisions.map(revision => <option key={revision.id} value={revision.id}>{revision.label}</option>)}</select></label> : document.revision && <code title={document.revision}>{document.revision.length > 24 ? `${document.revision.slice(0, 21)}…` : document.revision}</code>}</div>
    </header>
    <nav className="ge-mobile-nav" aria-label="Workspace panels">{(['index', 'graph', 'inspector'] as const).map(pane => <button type="button" key={pane} aria-pressed={mobilePane === pane} onClick={() => setMobilePane(pane)}>{pane === 'index' ? 'Browse' : pane === 'inspector' ? 'Inspect' : 'Graph'}</button>)}</nav>
    <div className="ge-workspace">
      <aside className="ge-index" aria-label="Record index"><div className="ge-index-search"><label htmlFor={`${generatedId}-search`}>Find a record <kbd>/</kbd></label><input ref={searchRef} id={`${generatedId}-search`} type="search" placeholder="Name, ID, or field…" value={location.query ?? ''} onChange={event => update({ query: event.target.value })} /></div>
        <div className="ge-kind-filter"><label htmlFor={`${generatedId}-kind`}>Record type</label><select id={`${generatedId}-kind`} value={location.kinds?.length === 1 ? location.kinds[0] : ''} onChange={event => update({ kinds: event.target.value ? [event.target.value] : [] })}><option value="">All types</option>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select></div>
        <div className="ge-index-count" aria-live="polite">{matching.length} records{focus && ' · full index'}</div>
        <div className="ge-index-list">{matching.map(node => <button type="button" key={node.id} className={selectedType === 'node' && selected?.id === node.id ? 'is-selected' : ''} aria-current={selectedType === 'node' && selected?.id === node.id ? 'true' : undefined} onClick={() => select(node.id)}>
          <span className="ge-index-kind">{node.kind}</span><strong>{node.label}</strong><small title={node.id}>{node.id}</small>{changes.nodes.get(node.id) && <span className="ge-change">{changes.nodes.get(node.id)}</span>}
        </button>)}{matching.length === 0 && <p className="ge-empty">No matching records.</p>}</div>
        {baseline && <details className="ge-baseline-summary"><summary>Snapshot changes <span>{changes.nodes.size + changes.edges.size + changes.removedNodes.length + changes.removedEdges.length}</span></summary><p>{changes.nodes.size} added or changed records · {changes.edges.size} added or changed relationships</p>{changes.removedNodes.map(node => <button type="button" className="ge-text-button" key={node.id} onClick={() => { select(node.id); setTab('history'); }}>Removed: {node.label}</button>)}{changes.removedEdges.map(edge => <button type="button" className="ge-text-button" key={edge.id} onClick={() => { select(edge.id, 'edge'); setTab('history'); }}>Removed: {edge.label ?? edge.kind}</button>)}</details>}
        <footer className="ge-index-footer">{document.description ?? 'Select a record to inspect its context.'}</footer>
      </aside>
      <main className="ge-main" aria-label="Graph canvas"><div className="ge-toolbar"><div className="ge-scope"><button type="button" className={!focus ? 'is-active' : ''} onClick={() => update({ focusId: undefined })}>Whole graph</button>{focus && <span title={focus.label}>/ {focus.label}</span>}</div><button type="button" onClick={() => { void fitView({ padding: .16, maxZoom: 1, duration: 0 }); }}>Fit view</button></div>
        <div className="ge-view-options">{focus ? <><div className="ge-direction" role="group" aria-label="Relationship direction">{(['both', 'upstream', 'downstream'] as const).map(direction => <button type="button" key={direction} aria-pressed={(location.direction ?? 'both') === direction} onClick={() => update({ direction })}>{direction === 'both' ? 'Lineage' : direction === 'upstream' ? 'Upstream' : 'Downstream'}</button>)}</div><label>Depth <select value={depth} onChange={event => update({ depth: Number(event.target.value) })}>{[1, 2, 3, 5, 10].map(value => <option key={value}>{value}</option>)}</select></label></> : <span className="ge-muted">Select to inspect · double-click to explore</span>}<label className="ge-containment"><input type="checkbox" checked={showContainment} onChange={event => update({ showContainment: event.target.checked })} />Containment</label></div>
        <div className="ge-canvas" ref={canvasRef}><ReactFlow<CardNode, RelationEdge> nodes={layout.nodes.map(node => ({ ...node, selected: selectedType === 'node' && node.id === selected?.id }))} edges={layout.edges.map(edge => ({ ...edge, selected: selectedType === 'edge' && edge.id === selected?.id }))}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={() => setReady(true)} nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
          onNodeClick={(_, node) => select(node.id)} onNodeDoubleClick={(_, node) => explore(node.id)} onEdgeClick={(_, edge) => select(edge.id, 'edge')}
          onNodesChange={items => { const change = items.find(item => item.type === 'select' && item.selected); if (change?.type === 'select' && (selectedType !== 'node' || change.id !== selected?.id)) select(change.id); }}
          onEdgesChange={items => { const change = items.find(item => item.type === 'select' && item.selected); if (change?.type === 'select' && (selectedType !== 'edge' || change.id !== selected?.id)) select(change.id, 'edge'); }}
          onMoveEnd={(_, viewport) => viewports.current.set(sceneKey, viewport)} minZoom={.04} maxZoom={2} fitView fitViewOptions={{ padding: .16, maxZoom: 1 }} preventScrolling>
          <Background gap={24} size={1} color="#d6dbd1" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={node => node.selected ? '#4b6853' : '#c4cebe'} maskColor="rgba(241,243,235,.7)" />
        </ReactFlow>{layout.nodes.length === 0 && <div className="ge-canvas-empty"><h2>No records in this view</h2><p>Adjust the search or record type.</p><button type="button" onClick={() => update({ query: '', kinds: [], focusId: undefined, collapsedIds: [] })}>Show all records</button></div>}</div>
        <footer className="ge-canvas-footer"><span>{layout.nodes.length} visible · {layout.edges.length} relationships</span><span>Direction follows the authored relationship</span></footer>
      </main>
      <aside className="ge-inspector" aria-label="Selection inspector">{renderInspector ? renderInspector({ document, node: selectedNode, edge: selectedEdge, selectNode: id => select(id), selectEdge: id => select(id, 'edge'), focusNode: explore }) : <><div className="ge-inspector-heading"><div className="ge-eyebrow">{selected ? `${selected.kind}${selectedType === 'edge' ? ' · relationship' : ''}` : 'Snapshot'}</div><h2>{selected?.label ?? (selectedEdge ? selectedEdge.kind : document.title)}</h2>{selected && <code className="ge-record-id">{selected.id}</code>}{removed && <Badge badge={{ label: 'Removed from this snapshot', tone: 'warning' }} />}{selected?.revision && <code className="ge-revision">Revision {selected.revision}</code>}
        {!!selected?.statuses?.length && <div className="ge-status-list">{selected.statuses.map((badge, i) => <Badge key={i} badge={badge} />)}</div>}
        {selectedNode && !removed && <div className="ge-node-actions"><button type="button" onClick={() => explore(selectedNode.id)}>Explore neighbors</button><button type="button" disabled={!layout.nodes.some(node => node.id === selectedNode.id)} onClick={() => { setMobilePane('graph'); void fitView({ nodes: [{ id: selectedNode.id }], maxZoom: 1, padding: .5, duration: 0 }); }}>Locate</button>{childCounts.has(selectedNode.id) && <button type="button" onClick={() => update({ collapsedIds: location.collapsedIds?.includes(selectedNode.id) ? location.collapsedIds.filter(id => id !== selectedNode.id) : [...location.collapsedIds ?? [], selectedNode.id] })}>{location.collapsedIds?.includes(selectedNode.id) ? 'Expand children' : 'Collapse children'}</button>}</div>}
      </div>
      <div className="ge-inspector-tabs" role="tablist" aria-label="Inspector sections">{tabs.map(([id, label], index) => <button type="button" role="tab" key={id} id={`${generatedId}-${id}-tab`} aria-controls={`${generatedId}-${id}-panel`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={event => { if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; setTab(tabs[next][0]); globalThis.document.getElementById(`${generatedId}-${tabs[next][0]}-tab`)?.focus(); }}>{label}</button>)}</div>
      <div className="ge-inspector-body" role="tabpanel" id={`${generatedId}-${tab}-panel`} aria-labelledby={`${generatedId}-${tab}-tab`} tabIndex={0}>
        {tab === 'record' && <>{selected ? <>{selected.description && <p className="ge-description">{selected.description}</p>}{selectedEdge && <section className="ge-relation-detail"><h3>Relationship</h3><button type="button" className="ge-text-button" onClick={() => select(selectedEdge.source)}>{nodesById.get(selectedEdge.source)?.label ?? selectedEdge.source}</button><span className="ge-relation-verb">↓ {selectedEdge.kind}</span><button type="button" className="ge-text-button" onClick={() => select(selectedEdge.target)}>{nodesById.get(selectedEdge.target)?.label ?? selectedEdge.target}</button>{selectedEdge.category && <p className="ge-muted ge-small">Category: {selectedEdge.category}</p>}</section>}{selectedNode && renderNodeDetails?.(selectedNode, document)}{selectedNode?.parentId && <p>Contained by <button type="button" className="ge-text-button" onClick={() => select(selectedNode.parentId!)}>{nodesById.get(selectedNode.parentId)?.label ?? selectedNode.parentId}</button></p>}<h3>Stored fields</h3>{selected.data && Object.keys(selected.data).length ? <dl className="ge-data">{Object.entries(selected.data).map(([key, value]) => <JsonField key={`${selected.id}:${key}`} name={key} value={value} />)}</dl> : <p className="ge-empty">No additional fields.</p>}{relations.length > 0 && <><h3>Connections</h3><ul className="ge-connections">{relations.map(edge => <li key={edge.id}><button type="button" onClick={() => select(edge.id, 'edge')}><small>{edge.kind} {edge.source === selected.id ? '→' : '←'}</small><span>{nodesById.get(edge.source === selected.id ? edge.target : edge.source)?.label ?? edge.id}</span></button></li>)}</ul></>}<details className="ge-source-json"><summary>Record JSON</summary><pre className="ge-json">{JSON.stringify(selected, null, 2)}</pre></details></> : <><p className="ge-description">{document.description ?? 'Explore the records and relationships in this snapshot.'}</p><p className="ge-empty">Select a record or relationship to inspect its fields, sources, and activity.</p><dl className="ge-data"><JsonField name="Snapshot ID" value={document.id} /><JsonField name="Schema" value={document.schemaVersion} />{document.revision && <JsonField name="Revision" value={document.revision} />}</dl>{document.metadata && <details><summary>Snapshot metadata</summary><pre className="ge-json">{JSON.stringify(document.metadata, null, 2)}</pre></details>}</>}</>}
        {tab === 'sources' && <><h3>Attached sources</h3><Sources sources={allSources} /></>}
        {tab === 'activity' && <><p className="ge-inspector-note">Authorship, execution, and review are separate records. Input roles preserve what was provided, cited, or consumed.</p>{(selected ? activities : document.activities ?? []).length ? (selected ? activities : document.activities ?? []).map(activity => <Activity key={activity.id} activity={activity} document={document} select={select} />) : <p className="ge-empty">No activity attached to this selection.</p>}</>}
        {tab === 'receipts' && <><p className="ge-inspector-note">Receipt declarations do not verify themselves. A verified receipt establishes its stated custody scope, not claim correctness.</p>{receipts.length ? receipts.map(receipt => {
          const candidates = assessments.filter(assessment => assessment.receiptId === receipt.id);
          const assessment = getReceiptAssessment(document, receipt, assessments, documentSha256);
          const status = assessment?.status ?? 'unchecked';
          return <section className="ge-receipt" key={receipt.id}><h3>{receipt.label}</h3><Badge badge={{ label: status === 'verified' ? 'Verified · exact snapshot' : status === 'failed' ? 'Verification failed' : status === 'unavailable' ? 'Verifier unavailable' : 'Not verified', tone: status === 'verified' ? 'positive' : status === 'failed' ? 'negative' : 'neutral' }} />
            {candidates.length > 0 && !assessment && <p className="ge-muted ge-small">{documentSha256 ? 'No matching assessment binds this receipt and its subjects to this snapshot.' : 'The host has not supplied this snapshot’s SHA-256 digest.'}</p>}
            {assessment && <><h5>Scope</h5><p>{assessment.scope}</p><p className="ge-muted ge-small">Verifier: {assessment.verifier}{assessment.checkedAt && <> · <time>{assessment.checkedAt}</time></>}</p>{assessment.detail && <p>{assessment.detail}</p>}{assessment.reportUri && <p><ArtifactLink label="Verification report" uri={assessment.reportUri} /></p>}</>}
            <p><ArtifactLink label="Receipt artifact" uri={receipt.uri} /></p>{receipt.sha256 && <code className="ge-digest">Declared SHA-256 {receipt.sha256}</code>}
            <h5>Subjects</h5><ul className="ge-compact-list">{receipt.subjects.map((subject, i) => <li key={i}><span className="ge-muted">{subject.type} · </span>{subject.type === 'node' || subject.type === 'edge' ? <button type="button" className="ge-text-button" onClick={() => select(subject.id, subject.type as 'node' | 'edge')}>{(subject.type === 'node' ? nodesById.get(subject.id)?.label : edgesById.get(subject.id)?.label ?? edgesById.get(subject.id)?.kind) ?? subject.id}</button> : subject.id}{subject.revision && <code className="ge-revision">{subject.revision}</code>}</li>)}</ul>
            {!!receipt.artifactIds?.length && <><h5>Referenced artifacts</h5><ul className="ge-compact-list">{receipt.artifactIds.map(id => { const artifact = document.artifacts?.find(item => item.id === id); return <li key={id}><ArtifactLink label={artifact?.label ?? id} uri={artifact?.uri} />{artifact?.sha256 && <code className="ge-digest">{artifact.sha256}</code>}</li>; })}</ul></>}
          </section>;
        }) : <p className="ge-empty">No receipt references attached.</p>}</>}
        {tab === 'history' && <>{baseline ? <><p className="ge-inspector-note">Comparing {baseline.revision ?? baseline.id} → {document.revision ?? document.id}. A changed record is a structural difference, not a verdict.</p>{selected ? (() => { const previous = selectedType === 'edge' ? baseline.edges.find(edge => edge.id === selected.id) : baseline.nodes.find(node => node.id === selected.id); const change = removed ? 'Removed' : (selectedType === 'edge' ? changes.edges : changes.nodes).get(selected.id) ?? 'Unchanged'; return <><h3>{change}</h3>{previous ? <details open><summary>Previous record</summary><pre className="ge-json">{JSON.stringify(previous, null, 2)}</pre></details> : <p>No record with this ID in the baseline.</p>}{!removed && <details><summary>Current record</summary><pre className="ge-json">{JSON.stringify(selected, null, 2)}</pre></details>}</>; })() : <p>{changes.nodes.size} records and {changes.edges.size} relationships added or changed. {changes.removedNodes.length} records and {changes.removedEdges.length} relationships removed.</p>}</> : <><h3>Snapshot revision</h3><code className="ge-record-id">{selected?.revision ?? document.revision ?? 'No revision supplied'}</code><p className="ge-empty">Supply a baseline snapshot to compare records and relationships.</p></>}</>}
      </div></>}</aside>
    </div>
  </div>;
}

export function GraphExplorer(props: GraphExplorerProps) {
  const assessments = Array.isArray(props.assessments) && props.assessments.every(isReceiptAssessment) ? props.assessments : EMPTY_ASSESSMENTS;
  return <ReactFlowProvider><Explorer {...props} assessments={assessments} /></ReactFlowProvider>;
}
