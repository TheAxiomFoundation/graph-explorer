import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

export interface BundledPackageNotice {
  name: string;
  version: string;
  license: string;
  evidence: string;
  licenseFiles: { path: string; sha256: string }[];
}

/**
 * Dagre's npm ESM already includes Graphlib; the outer bundler cannot see its
 * original imports. This pair was checked against the distributed ESM and its
 * pinned package dependency. A version change requires revisiting that audit.
 */
const PREBUNDLED = [{ parent: '@dagrejs/dagre', parentVersion: '3.1.1', dependency: '@dagrejs/graphlib', dependencyVersion: '4.0.5' }];

export async function collectThirdPartyNotices(root: string, metafile: Bun.BuildMetafile): Promise<{ text: string; packages: BundledPackageNotice[] }> {
  const packageRoots = new Map<string, { directory: string; evidence: string }>();
  const contributed = new Set(Object.values(metafile.outputs).flatMap(output => Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path)));
  for (const input of contributed) {
    const match = input.replaceAll('\\', '/').match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (!match) continue;
    const index = input.indexOf(match[0]);
    const end = index + match[0].length - 1;
    packageRoots.set(match[1], { directory: resolve(root, input.slice(0, end)), evidence: 'Standalone bundler output includes this package' });
  }
  for (const item of PREBUNDLED) {
    const parent = packageRoots.get(item.parent);
    if (!parent) continue;
    const manifest = JSON.parse(await readFile(join(parent.directory, 'package.json'), 'utf8'));
    if (manifest.version !== item.parentVersion || manifest.dependencies?.[item.dependency] !== item.dependencyVersion) throw new Error(`Re-audit prebundled dependencies for ${item.parent}@${manifest.version}`);
    if (!packageRoots.has(item.dependency)) packageRoots.set(item.dependency, { directory: resolve(root, 'node_modules', item.dependency), evidence: `Prebundled by ${item.parent}@${item.parentVersion}; distributed ESM contains Graphlib, package metadata pins ${item.dependencyVersion}` });
  }
  const packages: BundledPackageNotice[] = [];
  const sections: string[] = [];
  for (const [name, entry] of [...packageRoots].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const manifest = JSON.parse(await readFile(join(entry.directory, 'package.json'), 'utf8'));
    if (manifest.name !== name || typeof manifest.version !== 'string' || typeof manifest.license !== 'string') throw new Error(`Missing package identity/license metadata for ${name}`);
    const prebundled = PREBUNDLED.find(item => item.dependency === name);
    if (prebundled && manifest.version !== prebundled.dependencyVersion) throw new Error(`Prebundled ${name} version differs from its audited license package`);
    const files = (await readdir(entry.directory)).filter(file => /^(?:licen[sc]e|copying|copyright|notice)(?:[.-].*)?$/i.test(file)).sort();
    if (!files.length) throw new Error(`Bundled package ${name} has no installed license/notice file`);
    const licenseFiles: BundledPackageNotice['licenseFiles'] = [];
    const texts: string[] = [];
    for (const file of files) {
      const path = join(entry.directory, file);
      const bytes = await readFile(path);
      const source = relative(root, path).replaceAll('\\', '/');
      licenseFiles.push({ path: source, sha256: createHash('sha256').update(bytes).digest('hex') });
      texts.push(`Source: ${source}\n\n${bytes.toString('utf8').trimEnd()}`);
    }
    packages.push({ name, version: manifest.version, license: manifest.license, evidence: entry.evidence, licenseFiles });
    sections.push(`${name}@${manifest.version} (${manifest.license})\n${'='.repeat(72)}\n${texts.join('\n\n')}\n`);
  }
  if (!packages.length) throw new Error('Standalone dependency inventory is unexpectedly empty');
  const text = `THIRD-PARTY NOTICES\n\nGraph explorer's standalone viewer includes the packages below. Their full\nlicense and copyright notices are copied from the installed official packages.\nThe inventory is derived from the standalone bundler metafile, plus the audited\nGraphlib code prebundled into Dagre's distributed ESM. This file is regenerated\nby scripts/build.ts and embedded unchanged in the standalone JavaScript.\n\n${sections.join('\n')}`;
  if (text.includes('*/')) throw new Error('License text contains a JavaScript comment terminator; revise notice embedding before building');
  return { text, packages };
}
