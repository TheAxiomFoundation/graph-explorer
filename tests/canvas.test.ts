import { describe, expect, test } from 'bun:test';
import type { GraphDocument, GraphNode } from '../src/core/types.js';
import { canvasRecords, matchingRecords, nodeDimensions } from '../src/react/canvas.js';

const ids = (nodes: readonly GraphNode[]) => nodes.map(node => node.id);
const noChildren = new Map<string, ReadonlySet<string>>();

function relevanceGraph(): GraphDocument {
  return {
    schemaVersion: 'graph-explorer/v1', id: 'search-relevance', title: 'Invented search records',
    nodes: [
      ...Array.from({ length: 95 }, (_, i) => ({ id: `mention-${i}`, label: `Note ${i}`, kind: 'note', data: { reviewer: 'Mira Solen' } })),
      { id: 'partial-label', label: 'Mira Solen draft', kind: 'person' },
      { id: 'person/mira solen/current', label: 'Current person', kind: 'person' },
      { id: 'reversed-label', label: 'Solen, Mira', kind: 'person' },
      { id: 'exact-label', label: 'MIRA   SOLEN', kind: 'person' },
      { id: 'mira solen', label: 'Opaque identity', kind: 'person' },
      { id: 'unrelated', label: 'Different record', kind: 'person' },
    ],
    edges: [{ id: 'native-link', source: 'partial-label', target: 'exact-label', kind: 'references' }],
  };
}

describe('stable record search relevance', () => {
  test('exact label/ID and direct identity matches precede payload mentions without losing results', () => {
    const document = relevanceGraph();
    const result = matchingRecords(document, { query: '  mIrA\tSOLEN  ' });
    expect(ids(result)).toEqual([
      'exact-label', 'mira solen',
      'partial-label', 'person/mira solen/current', 'reversed-label',
      ...Array.from({ length: 95 }, (_, i) => `mention-${i}`),
    ]);
    expect(new Set(ids(result)).size).toBe(100);
    for (const node of result) expect(node).toBe(document.nodes.find(candidate => candidate.id === node.id)!);
  });

  test('empty or whitespace-only queries retain native document order and exact kind filtering', () => {
    const document = relevanceGraph();
    for (const query of [undefined, '', ' \t\n ']) {
      expect(ids(matchingRecords(document, { query }))).toEqual(ids(document.nodes));
      expect(ids(matchingRecords(document, { query, kinds: ['person', 'person'] }))).toEqual(ids(document.nodes.filter(node => node.kind === 'person')));
    }
    expect(ids(matchingRecords(document, { query: 'mira solen', kinds: ['person'] }))).toEqual([
      'exact-label', 'mira solen', 'partial-label', 'person/mira solen/current', 'reversed-label',
    ]);
    expect(matchingRecords(document, { query: 'mira solen', kinds: ['Person'] })).toEqual([]);
  });

  test('query tokens can still match across identity, kind, description and nested values', () => {
    const document: GraphDocument = { ...relevanceGraph(), nodes: [
      { id: 'payload-first', label: 'Notebook', kind: 'person', data: { authors: ['Mira', 'Solen'] } },
      { id: 'description-second', label: 'Mira', kind: 'person', description: 'Solen authored this record' },
      { id: 'Solen', label: 'Mira', kind: 'person' },
      { id: 'exact-last', label: 'Mira Solen', kind: 'person' },
    ], edges: [] };
    expect(ids(matchingRecords(document, { query: 'mira solen' }))).toEqual(['exact-last', 'Solen', 'payload-first', 'description-second']);
    expect(ids(matchingRecords(document, { query: 'mira solen person' }))).toEqual(ids(document.nodes));
    expect(ids(matchingRecords(document, { query: 'mira authors' }))).toEqual(['payload-first']);
    expect(ids(matchingRecords(document, { query: 'mira authored' }))).toEqual(['description-second']);
  });

  test('punctuated native IDs rank ahead of references to those IDs and records are never mutated', () => {
    const nativeId = '["person","Élodie Chen"]';
    const document: GraphDocument = { ...relevanceGraph(), nodes: [
      { id: 'reference', label: 'Linked record', kind: 'note', data: { subject: ['person', 'Élodie Chen'] } },
      { id: nativeId, label: 'Named record', kind: 'person' },
    ], edges: [] };
    const before = JSON.stringify(document);
    Object.freeze(document.nodes);
    document.nodes.forEach(Object.freeze);
    expect(ids(matchingRecords(document, { query: nativeId }))).toEqual([nativeId, 'reference']);
    expect(JSON.stringify(document)).toBe(before);
  });

  test('relevance does not reorder the canvas, change its projection or mutate native edges', () => {
    const document = relevanceGraph();
    const before = JSON.stringify(document);
    const location = { query: 'mira solen' };
    const matching = matchingRecords(document, location);
    expect(matching[0].id).toBe('exact-label');
    expect(ids(canvasRecords(document, location, matching, noChildren, {}))).toEqual(ids(document.nodes.filter(node => node.id !== 'unrelated')));
    for (const query of ['mira solen', 'unrelated', 'no matching term', '']) {
      expect(ids(canvasRecords(document, { query }, matchingRecords(document, { query }), noChildren, {
        searchFiltersCanvas: false,
        canvasNodeFilter: node => ['partial-label', 'exact-label'].includes(node.id),
      }))).toEqual(['partial-label', 'exact-label']);
    }
    expect(JSON.stringify(document)).toBe(before);
  });
});

function graph(): GraphDocument {
  return {
    schemaVersion: 'graph-explorer/v1', id: 'canvas-contract', title: 'Synthetic canvas fixture',
    nodes: [
      { id: 'source', label: 'Source alpha', kind: 'input', description: 'Observed starting record' },
      { id: 'metadata', label: 'Raw metadata', kind: 'metadata', data: { nested: { audit_marker: 'needle-18446744073709551615' } } },
      { id: 'process', label: 'Process', kind: 'step' },
      { id: 'result', label: 'Result', kind: 'output' },
      { id: 'sibling', label: 'Another consumer', kind: 'output' },
    ],
    edges: [
      { id: 'source-process', source: 'source', target: 'process', kind: 'uses', category: 'dependency' },
      { id: 'process-result', source: 'process', target: 'result', kind: 'produces', category: 'dependency' },
      { id: 'source-sibling', source: 'source', target: 'sibling', kind: 'uses', category: 'dependency' },
    ],
  };
}

describe('record index and canvas projection', () => {
  test('raw nested fields stay searchable even when the host excludes their record from the canvas', () => {
    const document = graph();
    const location = { query: 'audit_marker needle-18446744073709551615' };
    const matching = matchingRecords(document, location);
    expect(ids(matching)).toEqual(['metadata']);
    expect(matching[0]).toBe(document.nodes[1]);
    expect(canvasRecords(document, location, matching, noChildren, {
      canvasNodeFilter: node => node.kind !== 'metadata',
    })).toEqual([]);
    expect(document.nodes[1].data).toEqual({ nested: { audit_marker: 'needle-18446744073709551615' } });
  });

  test('the index combines case-insensitive search with type filtering over the full document', () => {
    const document = graph();
    expect(ids(matchingRecords(document, { query: 'ALPHA observed', kinds: ['input'] }))).toEqual(['source']);
    expect(matchingRecords(document, { query: 'alpha', kinds: ['output'] })).toEqual([]);
  });

  test('a host canvas exclusion cannot be overridden by focusing its record', () => {
    const document = graph();
    const location = { focusId: 'metadata', query: 'no match' };
    const matching = matchingRecords(document, location);
    for (const searchFiltersCanvas of [true, false]) {
      expect(canvasRecords(document, location, matching, noChildren, {
        searchFiltersCanvas,
        canvasNodeFilter: (node, supplied) => {
          expect(supplied).toBe(document);
          return node.kind !== 'metadata';
        },
      })).toEqual([]);
    }
  });

  test('index-only filtering keeps both the query and record-type restriction off the canvas', () => {
    const document = graph();
    const location = { query: 'alpha', kinds: ['input'] };
    const matching = matchingRecords(document, location);
    expect(ids(matching)).toEqual(['source']);
    expect(ids(canvasRecords(document, location, matching, noChildren, {}))).toEqual(['source']);
    expect(ids(canvasRecords(document, location, matching, noChildren, { searchFiltersCanvas: false }))).toEqual(ids(document.nodes));

    const noMatches = { query: 'absent word', kinds: ['absent-kind'] };
    expect(matchingRecords(document, noMatches)).toEqual([]);
    expect(ids(canvasRecords(document, noMatches, [], noChildren, {
      searchFiltersCanvas: false, canvasNodeFilter: node => node.kind !== 'metadata',
    }))).toEqual(['source', 'process', 'result', 'sibling']);
  });

  test('focus may override search and type restrictions while remaining inside the host projection', () => {
    const document = graph();
    const location = { focusId: 'source', query: 'result', kinds: ['output'], depth: 2, direction: 'downstream' as const };
    const visible = canvasRecords(document, location, matchingRecords(document, location), noChildren, {
      canvasNodeFilter: node => node.kind !== 'metadata',
    });
    expect(ids(visible)).toEqual(['source', 'result']);
  });

  test('collapsed descendants remain excluded with index-only filtering and when a descendant is focused', () => {
    const document: GraphDocument = {
      schemaVersion: 'graph-explorer/v1', id: 'containment', title: 'Synthetic containment',
      nodes: [
        { id: 'parent', label: 'Parent', kind: 'group' },
        { id: 'child', label: 'Child', kind: 'record', parentId: 'parent' },
        { id: 'grandchild', label: 'Grandchild', kind: 'record', parentId: 'child' },
      ], edges: [],
    };
    const children = new Map([['parent', new Set(['child'])], ['child', new Set(['grandchild'])]]);
    const location = { collapsedIds: ['parent'], query: 'grandchild', kinds: ['record'] };
    const matching = matchingRecords(document, location);
    expect(ids(matching)).toEqual(['grandchild']);
    expect(ids(canvasRecords(document, location, matching, children, { searchFiltersCanvas: false }))).toEqual(['parent']);
    expect(canvasRecords(document, { ...location, focusId: 'grandchild' }, matching, children, { searchFiltersCanvas: false })).toEqual([]);
    expect([...children.get('parent')!]).toEqual(['child']);
  });

  test('lineage reaches visible records through canvas-hidden intermediates in the full document', () => {
    const document = graph();
    const location = { focusId: 'source', direction: 'downstream' as const, depth: 2 };
    const visible = canvasRecords(document, location, document.nodes, noChildren, {
      canvasNodeFilter: node => ['source', 'result'].includes(node.id),
    });
    expect(ids(visible)).toEqual(['source', 'result']);
    expect(ids(canvasRecords(document, { ...location, depth: 1 }, document.nodes, noChildren, {
      canvasNodeFilter: node => ['source', 'result'].includes(node.id),
    }))).toEqual(['source']);
    // This helper returns nodes only; this test makes no assertion about edge rendering.
    expect(visible[1]).toBe(document.nodes.find(node => node.id === 'result')!);
  });

  test('both-direction lineage does not turn hidden common inputs into sibling expansion', () => {
    const document = graph();
    const location = { focusId: 'process', direction: 'both' as const, depth: 2 };
    expect(ids(canvasRecords(document, location, document.nodes, noChildren, {
      canvasNodeFilter: node => node.id !== 'source',
    }))).toEqual(['process', 'result']);
  });
});

describe('custom node sizing', () => {
  test('defaults are detached values and explicit dimensions are cloned without modifying the host object', () => {
    const first = nodeDimensions();
    expect(first).toEqual({ width: 248, height: 126 });
    first.width = 999;
    expect(nodeDimensions()).toEqual({ width: 248, height: 126 });
    const supplied = Object.freeze({ width: 312.5, height: 148 });
    const size = nodeDimensions(supplied);
    expect(size).toEqual(supplied);
    expect(size).not.toBe(supplied);
    size.height = 900;
    expect(supplied).toEqual({ width: 312.5, height: 148 });
  });

  test('rejects nonfinite, zero, negative, and nonnumeric dimensions on either axis', () => {
    for (const invalid of [NaN, Infinity, -Infinity, 0, -1, '240', undefined, null]) {
      expect(() => nodeDimensions({ width: invalid, height: 126 } as { width: number; height: number })).toThrow('finite positive');
      expect(() => nodeDimensions({ width: 248, height: invalid } as { width: number; height: number })).toThrow('finite positive');
    }
    expect(nodeDimensions({ width: .5, height: .25 })).toEqual({ width: .5, height: .25 });
  });
});
