import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import source from '../examples/mars-signal-horizons.json';

const bytes = (file: string) => readFileSync(new URL(`../examples/${file}`, import.meta.url));

describe('captured JPL Horizons Mars source', () => {
  test('raw public captures match their hashes, byte lengths and recorded successful requests', () => {
    for (const capture of [...source.snapshots.map(snapshot => snapshot.capture), source.speedOfLight.capture]) {
      const captured = bytes(capture.file);
      expect(createHash('sha256').update(captured).digest('hex')).toBe(capture.sha256);
      expect(captured.byteLength).toBe(capture.byteLength);
      expect(capture.httpStatus).toBe(200);
      expect(Date.parse(capture.retrievedAt)).toBeGreaterThanOrEqual(Date.parse(capture.retrievalStartedAt));
    }
    expect(source.speedOfLight.kilometersPerSecond).toBe('299792.458');
    expect(source.speedOfLight.exact).toBe(true);
    expect(bytes(source.speedOfLight.capture.file).toString()).toContain('299&nbsp;792&nbsp;458');
    expect(source.speedOfLight.capture.file).toEndWith('.txt');
    expect(source.speedOfLight.capture.mediaType).toBe('text/plain');
  });

  test('both epochs use geometric Mars-center positions relative to Earth center in explicit UTC-compatible time and km', () => {
    expect(source.snapshots.map(snapshot => snapshot.epoch)).toEqual(['2026-09-08T00:00:00Z', '2025-01-16T00:00:00Z']);
    for (const snapshot of source.snapshots) {
      expect(snapshot.parameters).toMatchObject({ COMMAND: "'499'", CENTER: "'500@399'", EPHEM_TYPE: "'VECTORS'", VEC_CORR: "'NONE'", TIME_TYPE: "'UT'", OUT_UNITS: "'KM-S'", REF_SYSTEM: "'ICRF'", REF_PLANE: "'FRAME'" });
      const result = JSON.parse(bytes(snapshot.capture.file).toString()).result as string;
      for (const heading of ['Target body name: Mars (499)', 'Center body name: Earth (399)', 'Center-site name: BODY CENTER', 'Output units    : KM-S', 'Output type     : GEOMETRIC cartesian states', 'Reference frame : ICRF', 'Times AFTER 1962 are in UTC']) expect(result).toContain(heading);
      const row = result.split('$$SOE\n')[1].split('$$EOE')[0].trim().split(',').map(value => value.trim());
      expect(row[0]).toBe(snapshot.values.julianDayUT);
      expect(row[1]).toBe(snapshot.values.calendarDateUT);
      expect(row[2]).toBe(snapshot.values.tdbMinusUTSeconds);
      expect(row[9]).toBe(snapshot.values.horizonsLTSeconds);
      expect(row[10]).toBe(snapshot.values.rangeKm);
      expect(Math.abs(Math.hypot(Number(row[3]), Number(row[4]), Number(row[5])) - Number(row[10]))).toBeLessThan(1e-6);
    }
    expect(Number(source.snapshots[0].values.rangeKm)).toBeGreaterThan(2 * Number(source.snapshots[1].values.rangeKm));
  });
});
