import { expect, test } from 'bun:test';
import { updateNodeMeasurements } from '../src/react/measurements.js';

test('browser dimensions survive selection events and duplicate observations without rerendering', () => {
  const ids = new Set(['a']);
  const empty = new Map();
  const measured = updateNodeMeasurements(empty, [{ type: 'dimensions', id: 'a', dimensions: { width: 248, height: 126 } }], ids);
  expect(measured.get('a')).toEqual({ width: 248, height: 126 });
  expect(empty.size).toBe(0);
  expect(updateNodeMeasurements(measured, [{ type: 'select', id: 'a', selected: true }], ids)).toBe(measured);
  expect(updateNodeMeasurements(measured, [{ type: 'dimensions', id: 'a', dimensions: { width: 248, height: 126 } }], ids)).toBe(measured);
  const resized = updateNodeMeasurements(measured, [{ type: 'dimensions', id: 'a', dimensions: { width: 310, height: 202 } }], ids);
  expect(resized.get('a')).toEqual({ width: 310, height: 202 });
  expect(measured.get('a')).toEqual({ width: 248, height: 126 });
});

test('hidden panes and invalid observations cannot erase positive measurements', () => {
  const previous = new Map([['a', { width: 248, height: 126 }]]);
  const ids = new Set(['a']);
  for (const dimensions of [{ width: 0, height: 0 }, { width: -1, height: 126 }, { width: Infinity, height: 126 }, { width: 248, height: NaN }, undefined]) {
    expect(updateNodeMeasurements(previous, [{ type: 'dimensions', id: 'a', dimensions }], ids)).toBe(previous);
  }
});

test('scene changes prune absent nodes and ignore late measurements for removed records', () => {
  const previous = new Map([['a', { width: 248, height: 126 }], ['b', { width: 310, height: 202 }]]);
  const next = updateNodeMeasurements(previous, [{ type: 'dimensions', id: 'a', dimensions: { width: 999, height: 999 } }], new Set(['b']));
  expect([...next]).toEqual([['b', { width: 310, height: 202 }]]);
  expect(previous.size).toBe(2);
  expect(updateNodeMeasurements(next, [], new Set()).size).toBe(0);
});
