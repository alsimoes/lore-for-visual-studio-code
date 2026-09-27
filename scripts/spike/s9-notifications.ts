// S9: does notificationSubscribe stay pending until unsubscribe? Do events arrive for your own
// actions vs another instance's? How to reconnect / stop cleanly on deactivate?
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadSdk, makeTempDir, newCorrelationId, section, writeFixture, runCollect } from './_shared.js';

const REMOTE = 'lore://argoneon:41337';
const LORE_EXE = 'C:\\Users\\andre\\bin\\lore.exe';

async function main() {
  const lore = await loadSdk();
  const repoName = `vscode-ext-spike-s9-${Date.now()}`;

  const rootA = makeTempDir('lore-spike-s9-a-');
  const globalsA = { repositoryPath: rootA, workingDirectory: rootA, correlationId: newCorrelationId() };
  await runCollect(lore, 'repositoryCreate', globalsA, { repositoryUrl: `${REMOTE}/${repoName}` });
  writeFileSync(join(rootA, 'a.txt'), 'v1\n');
  await runCollect(lore, 'fileStage', globalsA, { paths: ['a.txt'] });
  await runCollect(lore, 'revisionCommit', globalsA, { message: 'r1' });
  await runCollect(lore, 'branchPush', globalsA, {});

  const rootB = makeTempDir('lore-spike-s9-b-');
  execFileSync(LORE_EXE, ['repository', 'clone', `${REMOTE}/${repoName}`, '.'], { cwd: rootB });

  section('notificationSubscribe on repo A, iterate asyncIter() with a timeout');
  const collected: unknown[] = [];
  const iter = lore['notificationSubscribe'](globalsA, {}).asyncIter() as AsyncGenerator<unknown>;

  const collectPromise = (async () => {
    for await (const event of iter) {
      collected.push(event);
      console.log('  [notification event]', JSON.stringify(event).slice(0, 200));
      if (collected.length >= 12) break;
    }
  })();

  // Give the subscription a moment to establish, then push a change from repo B via the CLI.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  section('pushing a change from the SECOND working tree (repo B, via CLI)');
  writeFileSync(join(rootB, 'b.txt'), 'from repo B\n');
  execFileSync(LORE_EXE, ['stage', 'b.txt'], { cwd: rootB });
  execFileSync(LORE_EXE, ['commit', 'r2 from B'], { cwd: rootB });
  execFileSync(LORE_EXE, ['push'], { cwd: rootB });
  console.log('  pushed from B');

  // Also make a change and push from A itself, to see if we get a notification for our own push.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  section('pushing a change from repo A itself (SAME instance that is subscribed)');
  writeFileSync(join(rootA, 'c.txt'), 'from repo A\n');
  await runCollect(lore, 'fileStage', globalsA, { paths: ['c.txt'] });
  await runCollect(lore, 'revisionSync', globalsA, {});
  await runCollect(lore, 'revisionCommit', globalsA, { message: 'r3 from A' });
  await runCollect(lore, 'branchPush', globalsA, {});
  console.log('  pushed from A');

  const timeout = new Promise((resolve) => setTimeout(resolve, 6000));
  await Promise.race([collectPromise, timeout]);

  writeFixture('s9-notification-events', collected);
  console.log(`\nCollected ${collected.length} notification event(s) before timeout/limit.`);

  section('unsubscribe');
  try {
    await runCollect(lore, 'notificationUnsubscribe', globalsA, {});
    console.log('  notificationUnsubscribe completed');
  } catch (err) {
    console.log('  notificationUnsubscribe error:', err);
  }

  lore.shutdown();
  console.log('done, exiting');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('S9 FAILED:', err);
  process.exitCode = 1;
});
