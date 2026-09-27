// Quick follow-up to S13: does an offline repositoryCreate write a .lore/config.toml at all?
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSdk, makeTempDir, newCorrelationId, runCollect } from './_shared.js';

async function main() {
  const lore = await loadSdk();
  const root = makeTempDir('lore-spike-s13b-');
  const globals = { repositoryPath: root, workingDirectory: root, correlationId: newCorrelationId() };
  await runCollect(lore, 'repositoryCreate', { ...globals, offline: true }, {});
  console.log('root:', root);
  console.log('.lore/ top level:', readdirSync(join(root, '.lore')));
  console.log('config.toml exists:', existsSync(join(root, '.lore', 'config.toml')));
  lore.shutdown();
}

main().catch((err: unknown) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
