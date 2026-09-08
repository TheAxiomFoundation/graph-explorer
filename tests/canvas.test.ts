import { describe, expect, test } from 'bun:test';
import type { GraphDocument, GraphNode } from '../src/core/types.js';
import { canvasRecords, matchingRecords, nodeDimensions } from '../src/react/canvas.js';

const ids = (nodes: readonly GraphNode[]) => nodes.map(node => node.id);
const noChildren = new Map<string, ReadonlySet<string>>();

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
