import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import capture from '../examples/mars-axiom-run.json';
import source from '../examples/mars-signal-horizons.json';

const root = resolve(import.meta.dir, '..');
const sha = (raw: string | Buffer) => createHash('sha256').update(raw).digest('hex');
const target = capture.moduleTarget;
const read = (path: string) => readFileSync(resolve(root, path));

describe('the recorded native Axiom Mars calculation', () => {
  test('every allowlisted artifact is exact reviewed source or native execution bytes', () => {
    expect(capture.artifacts).toHaveLength(10);
    expect(new Set(capture.artifacts.map(item => item.sha256)).size).toBe(capture.artifacts.length);
    for (const item of capture.artifacts) {
      expect(item.sourcePath.startsWith('examples/mars-axiom')).toBe(true);
      expect(resolve(root, item.sourcePath).startsWith(root + sep)).toBe(true);
      expect(['json', 'yaml', 'txt']).toContain(item.extension);
      const raw = read(item.sourcePath);
      expect(sha(raw)).toBe(item.sha256);
      expect(raw.byteLength).toBe(item.byteLength);
      expect(raw.toString()).not.toMatch(/\/Users\/|\/private\/tmp\/|\.env(?:\.|\b)|OPENAI_API_KEY/);
    }
    expect(sha(read(capture.generator.sourcePath))).toBe(capture.generator.sha256);
    expect(JSON.stringify(capture)).not.toMatch(/\/Users\/|\/private\/tmp\//);
  });

  test('the real compiled program binds the exact source division and constant', () => {
    const bundle = JSON.parse(read(capture.bundleArtifact.sourcePath).toString());
    const artifact = JSON.parse(read(capture.compiledArtifact.sourcePath).toString());
    const spec = JSON.parse(read(capture.buildSpecArtifact.sourcePath).toString());
    expect(bundle.modules[target]).toBe(read(capture.moduleArtifact.sourcePath).toString());
    expect(spec.modules).toEqual(bundle.modules);
    expect(sha(bundle.artifact_json)).toBe(capture.compiledArtifact.sha256);
    expect(bundle.manifest.source_hashes[target]).toBe(capture.moduleArtifact.sha256);
    expect(bundle.manifest.artifact_sha256).toBe(capture.compiledArtifact.sha256);
    expect(artifact.engine_version).toBe('0.2.2');
    expect(artifact.artifact_format_version).toBe(2);
    expect(artifact.metadata.input_catalog).toEqual([{
      canonical_request_name: `${target}#input.range_km`, request_names: [`${target}#input.range_km`], slot: 'range_km',
    }]);
    const seconds = artifact.program.derived.find((rule: { name: string }) => rule.name === 'fixed_position_one_way_seconds');
    expect(seconds.expr).toMatchObject({ kind: 'div', left: { kind: 'input', name: 'range_km' }, right: { kind: 'parameter_lookup', parameter: 'speed_of_light_km_per_second' } });
    expect(artifact.program.parameters.find((rule: { name: string }) => rule.name === 'speed_of_light_km_per_second').versions[0].values['0']).toEqual({ kind: 'decimal', value: '299792.458' });
    expect(capture.speedOfLightKmPerSecond).toBe(source.speedOfLight.kilometersPerSecond);
  });

  test('both native requests preserve the sourced decimal input and complete native result', () => {
    expect(sha(read('examples/mars-signal-horizons.json'))).toBe(capture.sourceFixtureSha256);
    expect(capture.runs.map(run => run.epoch)).toEqual(source.snapshots.map(snapshot => snapshot.epoch));
    expect(capture.runs.map(run => run.inputRangeKm)).toEqual(['270899051.8510656', '96279709.60711069']);
    for (const [index, run] of capture.runs.entries()) {
      expect(run.sourceSha256).toBe(source.snapshots[index]!.capture.sha256);
      expect(run.inputRangeOriginal).toBe(source.snapshots[index]!.values.rangeKm);
      expect(JSON.parse(read(run.requestArtifact.sourcePath).toString())).toEqual(run.request);
      expect(JSON.parse(read(run.responseArtifact.sourcePath).toString())).toEqual(run.response);
      expect(run.request.dataset.inputs).toHaveLength(1);
      expect(run.request.dataset.inputs[0]!.value).toEqual({ kind: 'decimal', value: run.inputRangeKm });
      expect(run.response.context.artifact_sha256).toBe(capture.compiledArtifact.sha256);
      expect(run.response.result.metadata.actual_mode).toBe('explain');
      const outputs = run.response.result.results[0]!.outputs as Record<string, { value: { kind: string; value: string } }>;
      for (const unit of ['seconds', 'minutes'] as const) {
        const output = outputs[`${target}#fixed_position_one_way_${unit}`]!;
        expect(output.value).toEqual({ kind: 'decimal', value: run[unit] });
      }
      expect(Date.parse(run.endedAt)).toBeGreaterThanOrEqual(Date.parse(run.startedAt));
    }
  });

  test('unsigned native records do not claim Receipt custody or dimensional proof', () => {
    expect(capture.runtime.revision).toBe('8ac3a54f60fa3737166ff0c986d9660f34a25435');
    expect(capture.runtime.capabilities.engine.revision).toBe('d142c645917817cf590e036fb99f99b2d4780e1a');
    expect(capture.runtime.capabilities.assurance).toBe('development_unsigned');
    expect(capture.runtime.capabilities.unsupported).toContain('signed_admission');
    for (const run of capture.runs) {
      expect(run.response.assurance).toBe('development_unsigned');
      expect(run.response.context.scenario.pins).toEqual([]);
    }
    expect(capture.calculation).toContain('not an outbound retarded-time or network-latency prediction');
  });
});
