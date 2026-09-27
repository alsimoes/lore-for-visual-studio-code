// S2: status semantics for modified / added / deleted / moved / staged / re-edited-after-staging files.
// Also checks whether .loreignore is respected.
import { writeFileSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { loadSdk, makeTempDir, newCorrelationId, runCollect, section, writeFixture } from './_shared.js';

async function main() {
  const lore = await loadSdk();
  const root = makeTempDir('lore-spike-s2-');
  console.log('repo root:', root);

  const globals = { repositoryPath: root, workingDirectory: root, correlationId: newCorrelationId() };

  section('repositoryCreate (offline)');
  const createEvents = await runCollect(lore, 'repositoryCreate', { ...globals, offline: true }, {});
  writeFixture('s2-repository-create', createEvents);

  writeFileSync(join(root, 'tracked.txt'), 'hello\n');
  writeFileSync(join(root, 'to-delete.txt'), 'bye\n');
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'sub', 'nested.txt'), 'nested\n');
  writeFileSync(join(root, '.loreignore'), 'ignored.txt\n');
  writeFileSync(join(root, 'ignored.txt'), 'should be ignored\n');

  section('status({scan:true}) on an untouched, never-committed working tree');
  const scanStatus1 = await runCollect(lore, 'repositoryStatus', globals, { scan: true });
  writeFixture('s2-status-scan-initial', scanStatus1);

  section('fileStage + revisionCommit (baseline revision 1)');
  const stage1 = await runCollect(lore, 'fileStage', globals, {
    paths: ['tracked.txt', 'to-delete.txt', 'sub/nested.txt'],
  });
  writeFixture('s2-stage-baseline', stage1);
  const commit1 = await runCollect(lore, 'revisionCommit', globals, { message: 'baseline' });
  writeFixture('s2-commit-baseline', commit1);

  // Now mutate: modify tracked.txt, delete to-delete.txt, add new.txt, move sub/nested.txt.
  writeFileSync(join(root, 'tracked.txt'), 'hello modified\n');
  unlinkSync(join(root, 'to-delete.txt'));
  writeFileSync(join(root, 'new.txt'), 'new file\n');
  renameSync(join(root, 'sub', 'nested.txt'), join(root, 'sub', 'renamed.txt'));

  section('status({scan:true}) after mutation (modify/delete/add/move + ignored file)');
  const scanStatus2 = await runCollect(lore, 'repositoryStatus', globals, { scan: true });
  writeFixture('s2-status-scan-after-mutation', scanStatus2);

  section('status({}) with no scan, right after a scan (should still see the flags)');
  const noScanStatus1 = await runCollect(lore, 'repositoryStatus', globals, {});
  writeFixture('s2-status-noscan-after-scan', noScanStatus1);

  // Undo everything via a fresh temp dir copy check: instead, test explicit fileDirty marking
  // on a file we edit WITHOUT a scan, to see whether `status({})` picks it up at all.
  writeFileSync(join(root, 'sub', 'renamed.txt'), 'edited again, not yet marked dirty\n');

  section('status({}) with no scan, after an on-disk edit Lore was never told about');
  const noScanStatus2 = await runCollect(lore, 'repositoryStatus', globals, {});
  writeFixture('s2-status-noscan-blind-to-unmarked-edit', noScanStatus2);

  section('fileDirty on that same file, then status({}) with no scan');
  const dirty1 = await runCollect(lore, 'fileDirty', globals, { paths: ['sub/renamed.txt'] });
  writeFixture('s2-file-dirty', dirty1);
  const noScanStatus3 = await runCollect(lore, 'repositoryStatus', globals, {});
  writeFixture('s2-status-noscan-after-file-dirty', noScanStatus3);

  section(
    'fileStage the dirty file, then edit it again on disk: is it still flagStaged && flagDirty, or does flagDirty flip off?',
  );
  const stage2 = await runCollect(lore, 'fileStage', globals, { paths: ['sub/renamed.txt'] });
  writeFixture('s2-stage-after-dirty', stage2);
  const statusAfterStage = await runCollect(lore, 'repositoryStatus', globals, { staged: true });
  writeFixture('s2-status-after-stage', statusAfterStage);

  writeFileSync(join(root, 'sub', 'renamed.txt'), 'edited again AFTER staging\n');
  const statusStagedThenEditedNoScan = await runCollect(lore, 'repositoryStatus', globals, { staged: true });
  writeFixture('s2-status-staged-then-edited-noscan', statusStagedThenEditedNoScan);

  const statusStagedThenEditedScan = await runCollect(lore, 'repositoryStatus', globals, {
    staged: true,
    scan: true,
  });
  writeFixture('s2-status-staged-then-edited-scan', statusStagedThenEditedScan);

  section('checkDirty: does it clear a dirty flag when content matches the recorded state again?');
  writeFileSync(join(root, 'new.txt'), 'new file\n'); // new.txt is untracked/added; re-touch it, content unchanged
  const stage3 = await runCollect(lore, 'fileStage', globals, { paths: ['new.txt'] });
  writeFixture('s2-stage-new-file', stage3);
  const commit2 = await runCollect(lore, 'revisionCommit', globals, { message: 'second revision' });
  writeFixture('s2-commit-second', commit2);
  writeFileSync(join(root, 'new.txt'), 'temporarily changed\n');
  await runCollect(lore, 'fileDirty', globals, { paths: ['new.txt'] });
  writeFileSync(join(root, 'new.txt'), 'new file\n'); // revert to committed content
  const checkDirtyStatus = await runCollect(lore, 'repositoryStatus', globals, { checkDirty: true });
  writeFixture('s2-status-checkdirty-reverted-content', checkDirtyStatus);

  lore.shutdown();
  console.log('\nDone. Root left on disk for inspection at:', root);
}

main().catch((err: unknown) => {
  console.error('S2 FAILED:', err);
  process.exitCode = 1;
});
