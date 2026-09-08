#!/usr/bin/env node
import { exportGraphHtml } from './export.js';

const usage = 'Usage: orrery --input graph.json --output report.html [--baseline before.json] [--assessment assessment.json]';
const args = process.argv.slice(2);
try {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(usage);
  } else {
    const allowed = new Set(['--input', '--output', '--baseline', '--assessment']);
    const options = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index], value = args[index + 1];
      if (!allowed.has(key) || !value || value.startsWith('--') || options.has(key)) throw new Error(usage);
      options.set(key, value);
    }
    if (!options.has('--input') || !options.has('--output')) throw new Error(usage);
    const result = await exportGraphHtml({ input: options.get('--input')!, output: options.get('--output')!, baseline: options.get('--baseline'), assessment: options.get('--assessment') });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Graph export failed');
  process.exitCode = 1;
}
