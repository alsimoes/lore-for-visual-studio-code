// S7: which METADATA keys follow REVISION_HISTORY_ENTRY? Types of message/timestamp/committed-by?
// Does authLocalUserInfo resolve ids offline?
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSdk, makeTempDir, newCorrelationId, runCollect, section, writeFixture } from './_shared.js';

async function main() {
  const lore = await loadSdk();

  section('authLocalUserInfo on an OFFLINE repo (no remote at all)');
  const offlineRoot = makeTempDir('lore-spike-s7-offline-');
  const offlineGlobals = {
    repositoryPath: offlineRoot,
    workingDirectory: offlineRoot,
    correlationId: newCorrelationId(),
  };
  await runCollect(lore, 'repositoryCreate', { ...offlineGlobals, offline: true }, {});
  const offlineAuth = await runCollect(lore, 'authLocalUserInfo', offlineGlobals, {});
  writeFixture('s7-auth-local-user-info-offline', offlineAuth);

  section('authLocalUserInfo against the argoneon remote (auth disabled there)');
  const root = makeTempDir('lore-spike-s7-');
  const repoName = `vscode-ext-spike-s7-${Date.now()}`;
  const globals = {
    repositoryPath: root,
    workingDirectory: root,
    correlationId: newCorrelationId(),
    identity: 'spike-tester',
  };
  await runCollect(lore, 'repositoryCreate', globals, { repositoryUrl: `lore://argoneon:41337/${repoName}` });
  const onlineAuth = await runCollect(lore, 'authLocalUserInfo', globals, {});
  writeFixture('s7-auth-local-user-info-online', onlineAuth);

  writeFileSync(join(root, 'a.txt'), 'v1\n');
  await runCollect(lore, 'fileStage', globals, { paths: ['a.txt'] });
  await runCollect(lore, 'revisionCommit', globals, { message: 'first revision\nwith a body line' });

  writeFileSync(join(root, 'a.txt'), 'v2\n');
  await runCollect(lore, 'fileStage', globals, { paths: ['a.txt'] });
  await runCollect(lore, 'revisionCommit', globals, { message: 'second revision' });

  section('revisionHistory({length:10}) - raw event sequence (entry then metadata events?)');
  const history = await runCollect(lore, 'revisionHistory', globals, { length: 10 });
  writeFixture('s7-revision-history', history);

  section('revisionInfo({metadata:true}) on the latest revision');
  const historyTyped = history as Array<{ tagName: string; data?: { revision?: string } }>;
  const latestEntry = historyTyped.find((e) => e.tagName === 'revisionHistoryEntry')?.data;
  if (latestEntry?.revision) {
    const info = await runCollect(lore, 'revisionInfo', globals, {
      revision: latestEntry.revision,
      metadata: true,
    });
    writeFixture('s7-revision-info-metadata', info);
  }

  lore.shutdown();
}

main().catch((err: unknown) => {
  console.error('S7 FAILED:', err);
  process.exitCode = 1;
});
