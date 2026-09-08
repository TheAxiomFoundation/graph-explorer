/** Run with: bun examples/generate-axiom-fixture.ts /path/to/axiom-api */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the existing axiom-api checkout');
const graphPath = resolve(repo, 'src/runtime-graph.ts');
const registryPath = resolve(repo, 'src/compiled-package-registry.ts');
const artifactPath = 'data/runtime-artifacts/us-oasdi-wage-tax.compiled.json';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const artifactBytes = readFileSync(resolve(repo, artifactPath));
const lock = JSON.parse(readFileSync(resolve(repo, 'data/program-artifacts.lock.json'), 'utf8'));
if (lock.files['us-oasdi-wage-tax.compiled.json'] !== hash(artifactBytes)) throw new Error('Compiled Axiom artifact does not match its recorded release lock');
const { buildProgramGraph } = await import(pathToFileURL(graphPath).href);
const { buildCompiledPackageRegistry } = await import(pathToFileURL(registryPath).href);
const profile = JSON.parse(readFileSync(resolve(repo, 'data/compiled-package-profiles.json'), 'utf8')).find((item: { program_id: string }) => item.program_id === 'oasdi-wage-tax');
const previous = process.cwd();
process.chdir(repo);
let graph;
try {
  const result = buildCompiledPackageRegistry([profile], { allowMissing: false });
  if (result.packages.length !== 1) throw new Error('Expected one native OASDI package');
  graph = buildProgramGraph(result.packages[0], JSON.parse(artifactBytes.toString('utf8')));
} finally { process.chdir(previous); }
const source = {
  repository: 'https://github.com/TheAxiomFoundation/axiom-api',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  artifactPath, artifactSha256: hash(artifactBytes), artifactRelease: lock.source,
  projector: 'src/runtime-graph.ts#buildProgramGraph', projectorSha256: hash(readFileSync(graphPath)),
  profilePath: 'data/compiled-package-profiles.json',
  generation: 'Existing Axiom API buildCompiledPackageRegistry and buildProgramGraph executed against a hash-locked compiled RuleSpec artifact. No policy calculation executed.',
  limitations: 'Historical compiled graph snapshot; no fresh compilation, runtime evaluation, certification verification, or claim of current law.',
};
const out = fileURLToPath(new URL('./fixtures/axiom-oasdi.json', import.meta.url));
mkdirSync(resolve(out, '..'), { recursive: true });
writeFileSync(out, `${JSON.stringify({ source, graph }, null, 2)}\n`);
console.log(`Wrote ${out}: ${graph.rules.length} rules, ${graph.inputs.length} inputs`);
