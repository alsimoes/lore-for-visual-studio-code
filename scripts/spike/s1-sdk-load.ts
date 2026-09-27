// S1: Does the SDK load (via koffi -> lorelib) on win32-x64?
import { loadSdk, section } from './_shared.js';

async function main() {
  section('S1: SDK load');
  const started = Date.now();
  const lore = await loadSdk();
  console.log(`Loaded @lore-vcs/sdk in ${Date.now() - started}ms`);
  const version: unknown = lore.version();
  console.log('lore.version() ->', version, typeof version);
  lore.shutdown();
  console.log('lore.shutdown() called cleanly.');
}

main().catch((err: unknown) => {
  console.error('S1 FAILED:', err);
  process.exitCode = 1;
});
