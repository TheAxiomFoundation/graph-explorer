import { describe, expect, test } from 'bun:test';
import { frameCamera, resizeCamera } from '../src/react/camera.js';
import type { CameraFrame, CameraNode, CameraSize, CameraViewport } from '../src/react/camera.js';

const size = { width: 890, height: 580 };
const node = (id: string, x = 0, y = 0, width = 248, height = 126): CameraNode => ({ id, position: { x, y }, width, height });
const screenCenter = (record: CameraNode, viewport: CameraViewport) => ({
  x: (record.position.x + record.width / 2) * viewport.zoom + viewport.x,
  y: (record.position.y + record.height / 2) * viewport.zoom + viewport.y,
});

function expectCentered(frame: CameraFrame, focus: CameraNode, canvas = size) {
  const center = screenCenter(focus, frame.viewport);
  expect(center.x).toBeCloseTo(canvas.width / 2, 8);
  expect(center.y).toBeCloseTo(canvas.height / 2, 8);
}

function expectFits(frame: CameraFrame, records: readonly CameraNode[], canvas: CameraSize, padding = 0) {
  const { x, y, zoom } = frame.viewport;
  for (const id of frame.framedNodeIds) {
    const record = records.find(item => item.id === id)!;
    expect(record.position.x * zoom + x).toBeGreaterThanOrEqual(padding - 1e-8);
    expect(record.position.y * zoom + y).toBeGreaterThanOrEqual(padding - 1e-8);
    expect((record.position.x + record.width) * zoom + x).toBeLessThanOrEqual(canvas.width - padding + 1e-8);
    expect((record.position.y + record.height) * zoom + y).toBeLessThanOrEqual(canvas.height - padding + 1e-8);
  }
}

describe('readable focus framing', () => {
  test('an eighteen-neighbor focus remains at least 210.8 screen pixels wide', () => {
    const focus = node('focus');
    const neighbors = Array.from({ length: 18 }, (_, index) => node(`neighbor-${index}`, index % 2 ? 310 : -310, (Math.floor(index / 2) - 4) * 166));
    const records = [focus, ...neighbors];
    const frame = frameCamera(records, neighbors.map(neighbor => ({ source: focus.id, target: neighbor.id })), size, focus.id)!;
    expect(frame.focused).toBe(true);
    expect(frame.framedNodeIds).toHaveLength(7);
    expect(frame.viewport.zoom).toBeGreaterThanOrEqual(.85);
    expect(focus.width * frame.viewport.zoom).toBeGreaterThanOrEqual(210.8);
    expectCentered(frame, focus);
    expectFits(frame, records, size, 24);
  });

  test('a far incident neighbor cannot move or shrink the focused card', () => {
    const focus = node('focus', 200, -400);
    const near = node('near', 510, -400);
    const far = node('far', 20000, 8000);
    const edges = [{ source: 'focus', target: 'near' }, { source: 'far', target: 'focus' }];
    const frame = frameCamera([focus, near, far], edges, size, 'focus')!;
    expect(frame.framedNodeIds).toEqual(['focus', 'near']);
    expectCentered(frame, focus);
    expect(frame.viewport).toEqual(frameCamera([focus, near], edges, size, 'focus')!.viewport);
  });

  test('only focus-centered full bounds can take the all-nodes shortcut', () => {
    const focus = node('focus');
    const far = node('far', 650);
    const overview = frameCamera([focus, far], [], size)!;
    expect(overview.viewport.zoom).toBeGreaterThanOrEqual(.85);
    const frame = frameCamera([focus, far], [{ source: 'focus', target: 'far' }], size, 'focus')!;
    expect(frame.framedNodeIds).toEqual(['focus']);
    expect(frame.viewport.zoom).toBe(1);
    expectCentered(frame, focus);
  });

  test('a readable focus-centered overview may include more than six neighbors and unconnected visible nodes', () => {
    const focus = node('focus', -20, -20, 40, 40);
    const records = [focus, ...Array.from({ length: 9 }, (_, index) => node(`near-${index}`, (index - 4) * 45, 90, 30, 30))];
    const frame = frameCamera(records, [], size, 'focus')!;
    expect(frame.framedNodeIds).toHaveLength(10);
    expect(frame.viewport.zoom).toBe(1);
    expectCentered(frame, focus);
    expectFits(frame, records, size, 24);
  });

  test('oversized focus cards fit mobile and tiny canvases even below .04 zoom', () => {
    const focus = node('large', -200, 60, 4000, 1800);
    for (const canvas of [{ width: 390, height: 260 }, { width: 20, height: 12 }, { width: .5, height: .25 }]) {
      const frame = frameCamera([focus, node('far', 40000)], [{ source: 'large', target: 'far' }], canvas, 'large')!;
      expect(frame.focused).toBe(true);
      expect(frame.framedNodeIds).toEqual(['large']);
      expect(frame.viewport.zoom).toBeGreaterThan(0);
      expect(frame.viewport.zoom).toBeLessThan(.85);
      expectCentered(frame, focus, canvas);
      expectFits(frame, [focus], canvas);
    }
  });

  test('neighbor ordering normalizes horizontal and vertical distance by the corresponding canvas axis', () => {
    const focus = node('focus', -10, -10, 20, 20);
    const horizontal = node('horizontal', 290, -10, 20, 20);
    const vertical = node('vertical', -10, 240, 20, 20);
    const far = node('far', 10000, 10000, 20, 20);
    const frame = frameCamera([focus, vertical, horizontal, far], [
      { source: 'focus', target: 'vertical' }, { source: 'focus', target: 'horizontal' },
    ], size, 'focus')!;
    // 300 / 890 is closer than 250 / 580, reversing raw world-distance order.
    expect(frame.framedNodeIds).toEqual(['focus', 'horizontal', 'vertical']);
  });

  test('multiedges, cycles, missing endpoints, and shuffled inputs preserve unique deterministic framing', () => {
    const focus = node('focus', -10, -10, 20, 20);
    const records = [focus, node('b', 190, -10, 20, 20), node('a', -210, -10, 20, 20), node('far', 10000)];
    const edges = [
      { source: 'focus', target: 'b' }, { source: 'focus', target: 'a' },
      { source: 'a', target: 'focus' }, { source: 'focus', target: 'a' },
      { source: 'focus', target: 'focus' }, { source: 'focus', target: 'hidden' },
    ];
    const expected = frameCamera(records, edges, size, 'focus')!;
    expect(expected.framedNodeIds).toEqual(['focus', 'a', 'b']);
    expect(frameCamera([...records].reverse(), [...edges].reverse(), size, 'focus')).toEqual(expected);
  });

  test('a nearer oversized neighbor may be skipped while a farther fitting neighbor is framed', () => {
    const focus = node('focus', -10, -10, 20, 20);
    const huge = node('huge', -1000, -1000, 2000, 2000);
    const small = node('small', 190, -10, 20, 20);
    const frame = frameCamera([focus, huge, small], [
      { source: 'focus', target: 'huge' }, { source: 'small', target: 'focus' },
    ], size, 'focus')!;
    expect(frame.framedNodeIds).toEqual(['focus', 'small']);
    expectCentered(frame, focus);
    expectFits(frame, [focus, small], size, 24);
  });
});

describe('overview and numeric boundaries', () => {
  test('a missing or hidden focus falls back to the supplied visible nodes only', () => {
    const records = [node('visible-b', 500, 300), node('visible-a', -100, -100)];
    const edges = [{ source: 'hidden', target: 'visible-a' }];
    const frame = frameCamera(records, edges, size, 'hidden')!;
    expect(frame).toEqual(frameCamera(records, edges, size)!);
    expect(frame.focused).toBe(false);
    expect(frame.framedNodeIds).toEqual(['visible-a', 'visible-b']);
    expectFits(frame, records, size, 24);
    expect(frameCamera([...records].reverse(), [], size)).toEqual(frame);
  });

  test('overview zoom is capped at one and fits a huge graph even below .04', () => {
    expect(frameCamera([node('one')], [], size)!.viewport.zoom).toBe(1);
    const records = Array.from({ length: 434 }, (_, index) => node(`record-${index}`, index * 10000, (index % 17) * 2000));
    const frame = frameCamera(records, [], size)!;
    expect(frame.viewport.zoom).toBeGreaterThan(0);
    expect(frame.viewport.zoom).toBeLessThan(.04);
    expect(frame.framedNodeIds).toHaveLength(434);
    expectFits(frame, records, size, 24);
  });

  test('empty, nonpositive, nonfinite, and ambiguous geometry has no camera frame', () => {
    expect(frameCamera([], [], size)).toBeUndefined();
    for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
      expect(frameCamera([node('one')], [], { ...size, width: invalid })).toBeUndefined();
      expect(frameCamera([node('one')], [], { ...size, height: invalid }, 'one')).toBeUndefined();
      expect(frameCamera([node('one', 0, 0, invalid)], [], size)).toBeUndefined();
      expect(frameCamera([node('one', 0, 0, 248, invalid)], [], size, 'one')).toBeUndefined();
    }
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(frameCamera([node('one', invalid)], [], size)).toBeUndefined();
      expect(frameCamera([node('one', 0, invalid)], [], size, 'one')).toBeUndefined();
    }
    expect(frameCamera([node('one'), node('one', 100)], [], size)).toBeUndefined();
  });

  test('frame calculations do not mutate supplied nodes, edges, or canvas', () => {
    const records = [node('focus'), node('near', 310), node('far', 10000)];
    for (const record of records) { Object.freeze(record.position); Object.freeze(record); }
    const edges = [{ source: 'focus', target: 'near' }, { source: 'focus', target: 'far' }].map(edge => Object.freeze(edge));
    const before = JSON.stringify({ records, edges, size });
    frameCamera(Object.freeze(records), Object.freeze(edges), Object.freeze(size), 'focus');
    expect(JSON.stringify({ records, edges, size })).toBe(before);
  });
});

describe('camera resize', () => {
  test('resize preserves the world center and zoom, including a desktop-to-mobile change', () => {
    const viewport = Object.freeze({ x: -234.5, y: 98.25, zoom: .91 });
    const next = { width: 390, height: 844 };
    const resized = resizeCamera(viewport, size, next);
    expect(resized.zoom).toBe(viewport.zoom);
    expect((next.width / 2 - resized.x) / resized.zoom).toBeCloseTo((size.width / 2 - viewport.x) / viewport.zoom, 10);
    expect((next.height / 2 - resized.y) / resized.zoom).toBeCloseTo((size.height / 2 - viewport.y) / viewport.zoom, 10);
    expect(resizeCamera(resized, next, size)).toEqual(viewport);
    expect(resizeCamera(viewport, size, size)).toEqual(viewport);
    expect(resizeCamera(viewport, size, size)).not.toBe(viewport);
  });

  test('invalid resize inputs are rejected rather than returning nonfinite camera state', () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => resizeCamera(viewport, { ...size, width: invalid }, size)).toThrow(RangeError);
      expect(() => resizeCamera(viewport, size, { ...size, height: invalid })).toThrow(RangeError);
      expect(() => resizeCamera({ ...viewport, zoom: invalid }, size, size)).toThrow(RangeError);
    }
    expect(() => resizeCamera({ ...viewport, x: NaN }, size, size)).toThrow(RangeError);
    expect(() => resizeCamera({ ...viewport, y: Infinity }, size, size)).toThrow(RangeError);
  });
});
