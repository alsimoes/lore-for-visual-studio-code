// S5: while this process holds the store (storeKeepAlive), can `lore` in a separate CLI
// process run status/commit concurrently? What errors appear? Same without keep-alive?
import { execFileSync } from 'node:child_process';
import { writeFileSync as writeFile } from 'node:fs';
import { join } from 'node:path';
import { loadSdk, makeTempDir, newCorrelationId, runCollect, section } from './_shared.js';

const LORE_EXE = 'C:\\Users\\andre\\bin\\lore.exe';

function runCli(root: string, args: string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync(LORE_EXE, ['--json', ...args], { cwd: root, encoding: 'utf8' });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: (e.stdout ?? '') + (e.stderr ?? '') + e.message };
  }
}

async function main() {
  const lore = await loadSdk();
  const root = makeTempDir('lore-spike-s5-');
  const baseGlobals = { repositoryPath: root, workingDirectory: root, correlationId: newCorrelationId() };
  await runCollect(lore, 'repositoryCreate', { ...baseGlobals, offline: true }, {});
  writeFile(join(root, 'a.txt'), 'x\n');
  await runCollect(lore, 'fileStage', baseGlobals, { paths: ['a.txt'] });
  await runCollect(lore, 'revisionCommit', baseGlobals, { message: 'r1' });

  section('WITHOUT storeKeepAlive: hold no store handle, run CLI status concurrently');
  {
    const globals = { ...baseGlobals, storeKeepAlive: false };
    const sdkPromise = runCollect(lore, 'repositoryStatus', globals, { scan: true });
    const cliResult = runCli(root, ['status']);
    await sdkPromise;
    console.log('  CLI ok:', cliResult.ok);
    console.log('  CLI output (first 300 chars):', cliResult.output.slice(0, 300));
  }

  section(
    'WITH storeKeepAlive:true and storeKeepAliveSeconds:5, hold store open, then CLI status+commit concurrently',
  );
  {
    const globals = { ...baseGlobals, storeKeepAlive: true, storeKeepAliveSeconds: 5 };
    // Prime the keep-alive by making one call with it set.
    await runCollect(lore, 'repositoryStatus', globals, { revisionOnly: true });
    writeFile(join(root, 'a.txt'), 'y\n');
    const cliDirty = runCli(root, ['dirty', 'a.txt']);
    console.log('  CLI dirty ok:', cliDirty.ok, cliDirty.output.slice(0, 300));
    const cliStatus = runCli(root, ['status']);
    console.log('  CLI status ok:', cliStatus.ok, cliStatus.output.slice(0, 300));
    const cliStage = runCli(root, ['stage', 'a.txt']);
    console.log('  CLI stage ok:', cliStage.ok, cliStage.output.slice(0, 300));
    const cliCommit = runCli(root, ['commit', 'r2 from cli while sdk holds store']);
    console.log('  CLI commit ok:', cliCommit.ok, cliCommit.output.slice(0, 300));
  }

  lore.shutdown();
}

main().catch((err: unknown) => {
  console.error('S5 FAILED:', err);
  process.exitCode = 1;
});
