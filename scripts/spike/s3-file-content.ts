// S3: how to read file bytes at (a) the current revision, (b) the staged state, (c) branch@LATEST.
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSdk,
  makeTempDir,
  newCorrelationId,
  runCollect,
  section,
  writeFixture,
  type SpikeLore,
} from './_shared.js';

async function tryWrite(
  lore: SpikeLore,
  globals: object,
  label: string,
  args: { path: string; revision: string },
) {
  const outDir = mkdtempSync(join(tmpdir(), 'lore-spike-s3-out-'));
  const output = join(outDir, 'out.bin');
  section(`fileWrite ${label}: revision="${args.revision}"`);
  try {
    const events = await runCollect(lore, 'fileWrite', globals, {
      path: args.path,
      revision: args.revision,
      output,
    });
    writeFixture(`s3-filewrite-${label}`, events);
    try {
      const content = readFileSync(output, 'utf8');
      console.log('  content:', JSON.stringify(content));
    } catch (err) {
      console.log('  (no output file written)', err);
    }
  } catch (err) {
    console.log('  FAILED:', err);
  }
}

async function main() {
  const lore = await loadSdk();
  const root = makeTempDir('lore-spike-s3-');
  console.log('repo root:', root);
  const globals = { repositoryPath: root, workingDirectory: root, correlationId: newCorrelationId() };

  await runCollect(lore, 'repositoryCreate', { ...globals, offline: true }, {});
  writeFileSync(join(root, 'a.txt'), 'revision 1 content\n');
  await runCollect(lore, 'fileStage', globals, { paths: ['a.txt'] });
  const commit1 = (await runCollect(lore, 'revisionCommit', globals, { message: 'r1' })) as Array<{
    tagName: string;
    data?: { revision?: string; revisionNumber?: number };
  }>;
  const rev1 = commit1.find((e) => e.tagName === 'revisionCommitRevision')?.data;
  console.log('revision 1:', rev1);

  writeFileSync(join(root, 'a.txt'), 'revision 2 content, not yet staged\n');
  await runCollect(lore, 'fileDirty', globals, { paths: ['a.txt'] });
  await runCollect(lore, 'fileStage', globals, { paths: ['a.txt'] });
  // a.txt is now staged with "revision 2 content" but not committed.
  writeFileSync(join(root, 'a.txt'), 'revision 2 content, staged\n');
  await runCollect(lore, 'fileDirty', globals, { paths: ['a.txt'] });
  // Re-stage so the staged content matches what's on disk right now.
  await runCollect(lore, 'fileStage', globals, { paths: ['a.txt'] });

  if (!rev1?.revision) {
    throw new Error('did not get a revision hash from revisionCommit');
  }

  await tryWrite(lore, globals, 'by-hash', { path: 'a.txt', revision: rev1.revision });
  await tryWrite(lore, globals, 'branch-at-latest', { path: 'a.txt', revision: 'main@LATEST' });
  await tryWrite(lore, globals, 'branch-at-number', { path: 'a.txt', revision: 'main@1' });
  await tryWrite(lore, globals, 'empty-revision-meaning-staged-or-current', { path: 'a.txt', revision: '' });
  await tryWrite(lore, globals, 'literal-STAGED', { path: 'a.txt', revision: 'STAGED' });
  await tryWrite(lore, globals, 'literal-staged-lowercase', { path: 'a.txt', revision: 'staged' });

  // Compare with fileInfo, which the plan suggests can report `localHash` vs `hash`.
  section('fileInfo with local:true (a global arg, not a call arg)');
  const fileInfoEvents = await runCollect(
    lore,
    'fileInfo',
    { ...globals, local: true },
    { paths: ['a.txt'] },
  );
  writeFixture('s3-fileinfo-local', fileInfoEvents);

  lore.shutdown();
}

main().catch((err: unknown) => {
  console.error('S3 FAILED:', err);
  process.exitCode = 1;
});
