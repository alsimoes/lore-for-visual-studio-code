// S8: acquire/status/query/release on the demo server with two identities. Owner id format,
// lockedAt unit, can a non-owner release, is anything actually enforced?
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSdk, makeTempDir, newCorrelationId, runCollect, section, writeFixture } from './_shared.js';

const REMOTE = 'lore://argoneon:41337';

async function main() {
  const lore = await loadSdk();
  const repoName = `vscode-ext-spike-s8-${Date.now()}`;

  const rootAlice = makeTempDir('lore-spike-s8-alice-');
  const alice = {
    repositoryPath: rootAlice,
    workingDirectory: rootAlice,
    correlationId: newCorrelationId(),
    identity: 'alice',
  };
  await runCollect(lore, 'repositoryCreate', alice, { repositoryUrl: `${REMOTE}/${repoName}` });
  writeFileSync(join(rootAlice, 'asset.bin'), 'binary-ish content\n');
  await runCollect(lore, 'fileStage', alice, { paths: ['asset.bin'] });
  await runCollect(lore, 'revisionCommit', alice, { message: 'add asset' });
  await runCollect(lore, 'branchPush', alice, {});

  const rootBob = makeTempDir('lore-spike-s8-bob-');
  const bob = {
    repositoryPath: rootBob,
    workingDirectory: rootBob,
    correlationId: newCorrelationId(),
    identity: 'bob',
  };
  await runCollect(lore, 'repositoryClone', bob, { repositoryUrl: `${REMOTE}/${repoName}` });

  section('alice: lockFileAcquire on asset.bin');
  writeFixture(
    's8-lock-acquire-alice',
    await runCollect(lore, 'lockFileAcquire', alice, { paths: ['asset.bin'] }),
  );

  section('bob: lockFileStatus on asset.bin (should show alice as owner)');
  writeFixture('s8-lock-status-bob', await runCollect(lore, 'lockFileStatus', bob, { paths: ['asset.bin'] }));

  section('bob: lockFileQuery with no filters (see all locks on the branch)');
  writeFixture('s8-lock-query-bob', await runCollect(lore, 'lockFileQuery', bob, {}));

  section('bob: try to acquire the SAME lock alice holds (should fail or queue?)');
  try {
    const events = await runCollect(lore, 'lockFileAcquire', bob, { paths: ['asset.bin'] });
    console.log('  bob acquire result:', JSON.stringify(events).slice(0, 300));
  } catch (err) {
    console.log('  bob acquire FAILED as expected:', err instanceof Error ? err.message : err);
  }

  section('bob: try to edit and push the locked file anyway (is the lock enforced server-side?)');
  writeFileSync(join(rootBob, 'asset.bin'), 'bob overwrote this\n');
  await runCollect(lore, 'fileStage', bob, { paths: ['asset.bin'] });
  await runCollect(lore, 'revisionCommit', bob, { message: 'bob edits locked file' });
  try {
    const pushEvents = await runCollect(lore, 'branchPush', bob, {});
    console.log(
      '  bob push SUCCEEDED (lock not enforced against push):',
      JSON.stringify(pushEvents).slice(0, 200),
    );
  } catch (err) {
    console.log('  bob push FAILED (lock enforced):', err instanceof Error ? err.message : err);
  }

  section("bob: try to release ALICE's lock without owner override");
  try {
    const events = await runCollect(lore, 'lockFileRelease', bob, { paths: ['asset.bin'] });
    console.log('  bob release result:', JSON.stringify(events).slice(0, 300));
  } catch (err) {
    console.log('  bob release FAILED as expected:', err instanceof Error ? err.message : err);
  }

  section('alice: release her own lock');
  writeFixture(
    's8-lock-release-alice',
    await runCollect(lore, 'lockFileRelease', alice, { paths: ['asset.bin'] }),
  );

  lore.shutdown();
}

main().catch((err: unknown) => {
  console.error('S8 FAILED:', err);
  process.exitCode = 1;
});
