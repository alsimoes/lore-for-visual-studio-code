// S13: which files under .lore/ change on stage, commit, sync and switch?
import { writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readdirSync } from 'node:fs';
import { loadSdk, makeTempDir, newCorrelationId, runCollect, section } from './_shared.js';

function snapshotLoreDir(root: string): Map<string, number> {
  const result = new Map<string, number>();
  const loreDir = join(root, '.lore');
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        try {
          result.set(relative(loreDir, full), statSync(full).mtimeMs);
        } catch {
          // Transient file (e.g. a *.pending marker) removed between readdir and stat.
          // This race is itself a finding: the store churns short-lived files per operation.
        }
      }
    }
  };
  walk(loreDir);
  return result;
}

function diffSnapshots(before: Map<string, number>, after: Map<string, number>): string[] {
  const changed: string[] = [];
  for (const [path, mtime] of after) {
    if (!before.has(path)) {
      changed.push(`+ ${path}`);
    } else if (before.get(path) !== mtime) {
      changed.push(`~ ${path}`);
    }
  }
  for (const path of before.keys()) {
    if (!after.has(path)) {
      changed.push(`- ${path}`);
    }
  }
  return changed.sort();
}

async function main() {
  const lore = await loadSdk();
  const root = makeTempDir('lore-spike-s13-');
  const globals = { repositoryPath: root, workingDirectory: root, correlationId: newCorrelationId() };

  await runCollect(lore, 'repositoryCreate', { ...globals, offline: true }, {});
  writeFileSync(join(root, 'a.txt'), 'x\n');

  let before = snapshotLoreDir(root);
  section('fileDirty');
  await runCollect(lore, 'fileDirty', globals, { paths: ['a.txt'] });
  console.log(diffSnapshots(before, snapshotLoreDir(root)));

  before = snapshotLoreDir(root);
  section('fileStage');
  await runCollect(lore, 'fileStage', globals, { paths: ['a.txt'] });
  console.log(diffSnapshots(before, snapshotLoreDir(root)));

  before = snapshotLoreDir(root);
  section('revisionCommit');
  await runCollect(lore, 'revisionCommit', globals, { message: 'r1' });
  console.log(diffSnapshots(before, snapshotLoreDir(root)));

  before = snapshotLoreDir(root);
  section('branchCreate (also switches)');
  await runCollect(lore, 'branchCreate', globals, { branch: 'feature' });
  console.log(diffSnapshots(before, snapshotLoreDir(root)));

  before = snapshotLoreDir(root);
  section('branchSwitch back to main');
  await runCollect(lore, 'branchSwitch', globals, { branch: 'main' });
  console.log(diffSnapshots(before, snapshotLoreDir(root)));

  before = snapshotLoreDir(root);
  section('plain repositoryStatus (read-only call) - does it touch .lore/ at all?');
  await runCollect(lore, 'repositoryStatus', globals, {});
  console.log(diffSnapshots(before, snapshotLoreDir(root)));

  console.log('\nFull .lore/ listing:');
  for (const [path] of snapshotLoreDir(root)) console.log(' ', path);

  lore.shutdown();
}

main().catch((err: unknown) => {
  console.error('S13 FAILED:', err);
  process.exitCode = 1;
});
