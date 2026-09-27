// S6: conflicting edits to a text file (two branches, same repo). What's on disk (markers?),
// which status flags, which events. How to resolve mine/theirs/manual, and is a commit needed
// after resolving?
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSdk, makeTempDir, newCorrelationId, runCollect, section, writeFixture } from './_shared.js';

async function main() {
  const lore = await loadSdk();
  const root = makeTempDir('lore-spike-s6-');
  const g = { repositoryPath: root, workingDirectory: root, correlationId: newCorrelationId() };
  const repoName = `vscode-ext-spike-s6-${Date.now()}`;

  // S6's first attempt used an offline repo and found that branchMergeStart requires a
  // configured remote even for two fully local branches (error 111 "No remote configured").
  // Redone here against the real demo server, per the plan's original instruction.
  await runCollect(lore, 'repositoryCreate', g, { repositoryUrl: `lore://argoneon:41337/${repoName}` });
  writeFileSync(join(root, 'shared.txt'), 'line1\nline2\nline3\n');
  await runCollect(lore, 'fileStage', g, { paths: ['shared.txt'] });
  await runCollect(lore, 'revisionCommit', g, { message: 'base' });

  section('branchCreate "feature" (auto-switches per S11)');
  await runCollect(lore, 'branchCreate', g, { branch: 'feature' });
  writeFileSync(join(root, 'shared.txt'), 'line1\nFEATURE CHANGE\nline3\n');
  await runCollect(lore, 'fileStage', g, { paths: ['shared.txt'] });
  await runCollect(lore, 'revisionCommit', g, { message: 'feature edits shared.txt' });

  section('branchSwitch back to main, edit the SAME line differently, commit');
  await runCollect(lore, 'branchSwitch', g, { branch: 'main' });
  writeFileSync(join(root, 'shared.txt'), 'line1\nMAIN CHANGE\nline3\n');
  await runCollect(lore, 'fileStage', g, { paths: ['shared.txt'] });
  await runCollect(lore, 'revisionCommit', g, { message: 'main edits shared.txt' });

  section('branchMergeStart({branch:"feature"}) - expect a conflict');
  let mergeEvents: unknown[];
  try {
    mergeEvents = await runCollect(lore, 'branchMergeStart', g, { branch: 'feature' });
  } catch (err) {
    mergeEvents = (err as { events?: unknown[] }).events ?? [];
    console.log('  branchMergeStart threw (may be expected for a conflict):', err);
  }
  writeFixture('s6-merge-start-conflict', mergeEvents);

  console.log('\n--- shared.txt on disk after the conflicting merge ---');
  console.log(readFileSync(join(root, 'shared.txt'), 'utf8'));
  console.log('--- end of file ---\n');

  section('repositoryStatus during the conflict');
  const statusDuringConflict = await runCollect(lore, 'repositoryStatus', g, {});
  writeFixture('s6-status-during-conflict', statusDuringConflict);

  section('branchInfo (does it expose a branchPoint / common ancestor?)');
  writeFixture('s6-branch-info-main', await runCollect(lore, 'branchInfo', g, { branch: 'main' }));

  section('fileDiff({diff3:true}) on the conflicted file (base/mine/theirs?)');
  try {
    const diff3 = await runCollect(lore, 'fileDiff', g, { paths: ['shared.txt'], diff3: true });
    writeFixture('s6-filediff-diff3', diff3);
  } catch (err) {
    console.log('  fileDiff diff3 FAILED:', err);
  }

  section('resolve as "theirs" then check status and whether commit is still needed');
  const resolveTheirs = await runCollect(lore, 'branchMergeResolveTheirs', g, { paths: ['shared.txt'] });
  writeFixture('s6-merge-resolve-theirs', resolveTheirs);
  console.log('\n--- shared.txt after resolveTheirs ---');
  console.log(readFileSync(join(root, 'shared.txt'), 'utf8'));

  const statusAfterResolve = await runCollect(lore, 'repositoryStatus', g, { staged: true });
  writeFixture('s6-status-after-resolve', statusAfterResolve);

  section('commit the resolved merge');
  const commitMerge = await runCollect(lore, 'revisionCommit', g, { message: 'merge feature into main' });
  writeFixture('s6-commit-after-resolve', commitMerge);

  lore.shutdown();
}

main().catch((err: unknown) => {
  console.error('S6 FAILED:', err);
  process.exitCode = 1;
});
