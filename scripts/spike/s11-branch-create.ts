// S11: does branchCreate also switch to the new branch? What are the branch name rules?
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSdk, makeTempDir, newCorrelationId, runCollect, section, writeFixture } from './_shared.js';

async function main() {
  const lore = await loadSdk();
  const root = makeTempDir('lore-spike-s11-');
  const globals = { repositoryPath: root, workingDirectory: root, correlationId: newCorrelationId() };

  await runCollect(lore, 'repositoryCreate', { ...globals, offline: true }, {});
  writeFileSync(join(root, 'a.txt'), 'x\n');
  await runCollect(lore, 'fileStage', globals, { paths: ['a.txt'] });
  await runCollect(lore, 'revisionCommit', globals, { message: 'r1' });

  section('branchList before create');
  writeFixture('s11-branch-list-before', await runCollect(lore, 'branchList', globals, {}));

  section('branchCreate "feature/x"');
  writeFixture('s11-branch-create', await runCollect(lore, 'branchCreate', globals, { branch: 'feature/x' }));

  section('branchList after create (which branch is current?)');
  writeFixture('s11-branch-list-after', await runCollect(lore, 'branchList', globals, {}));

  section('status right after branchCreate (does the branch name in the revision event change?)');
  writeFixture(
    's11-status-after-create',
    await runCollect(lore, 'repositoryStatus', globals, { revisionOnly: true }),
  );

  for (const badName of ['bad name with spaces', 'has/../traversal', '', 'a'.repeat(300)]) {
    section(`branchCreate with a questionable name: ${JSON.stringify(badName).slice(0, 40)}`);
    try {
      const events = await runCollect(lore, 'branchCreate', globals, { branch: badName });
      console.log('  succeeded:', JSON.stringify(events).slice(0, 300));
    } catch (err) {
      console.log('  rejected:', err instanceof Error ? err.message : err);
    }
  }

  lore.shutdown();
}

main().catch((err: unknown) => {
  console.error('S11 FAILED:', err);
  process.exitCode = 1;
});
