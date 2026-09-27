import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getVsceTarget } from './vsce-target.mjs';

let target;
try {
  target = getVsceTarget();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const outDir = 'dist-vsix';
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${pkg.name}-${target}-${pkg.version}.vsix`);

execFileSync('npm', ['run', 'build:prod'], { stdio: 'inherit', shell: true });
execFileSync('vsce', ['package', '--target', target, '--out', outFile], { stdio: 'inherit', shell: true });
