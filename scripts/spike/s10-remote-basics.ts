// S10 (+groundwork for S6-S9,S14): create a throwaway repo on the real argoneon server, verify
// auth is/isn't required, and check whether a plain status contacts the remote.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSdk, makeTempDir, newCorrelationId, runCollect, section, writeFixture } from './_shared.js';

const REMOTE = 'lore://argoneon:41337';
const REPO_NAME = `vscode-ext-spike-${Date.now()}`;

async function main() {
  const lore = await loadSdk();
  const root = makeTempDir('lore-spike-s10-');
  console.log('repo root:', root, 'repo name:', REPO_NAME);
  const globals = { repositoryPath: root, workingDirectory: root, correlationId: newCorrelationId() };

  section(`repositoryCreate against ${REMOTE}/${REPO_NAME} (online, no auth configured)`);
  const createEvents = await runCollect(lore, 'repositoryCreate', globals, {
    repositoryUrl: `${REMOTE}/${REPO_NAME}`,
  });
  writeFixture('s10-repository-create-online', createEvents);

  writeFileSync(join(root, 'a.txt'), 'hello from spike\n');
  await runCollect(lore, 'fileStage', globals, { paths: ['a.txt'] });
  await runCollect(lore, 'revisionCommit', globals, { message: 'r1' });

  section('status with remote:true (does a plain status contact the remote? timing)');
  const t0 = Date.now();
  const remoteStatus = await runCollect(
    lore,
    'repositoryStatus',
    { ...globals, remote: true },
    { revisionOnly: true },
  );
  console.log(`  took ${Date.now() - t0}ms`);
  writeFixture('s10-status-remote-true', remoteStatus);

  section('status with local:true (should avoid the network)');
  const t1 = Date.now();
  const localStatus = await runCollect(
    lore,
    'repositoryStatus',
    { ...globals, local: true },
    { revisionOnly: true },
  );
  console.log(`  took ${Date.now() - t1}ms`);
  writeFixture('s10-status-local-true', localStatus);

  section('branchPush');
  const pushEvents = await runCollect(lore, 'branchPush', globals, {});
  writeFixture('s10-branch-push', pushEvents);

  section('status after push (revisionRemote* should now be set, revision numbers contiguous?)');
  const afterPush = await runCollect(lore, 'repositoryStatus', globals, { revisionOnly: true });
  writeFixture('s10-status-after-push', afterPush);

  console.log('\nRepo name for follow-up spikes:', REPO_NAME);
  console.log('Local working tree:', root);

  lore.shutdown();
}

main().catch((err: unknown) => {
  console.error('S10 FAILED:', err);
  process.exitCode = 1;
});
