import type { LogOutputChannel } from 'vscode';
import type { LoreBackend } from './backend.js';
import { SdkBackend } from './sdkBackend.js';

export type BackendSetting = 'auto' | 'sdk' | 'cli';

/**
 * Resolves `loreScm.backend`. `CliBackend` doesn't exist until Phase 6 (PLAN.md §3.2), so `"cli"`
 * fails clearly instead of silently doing the wrong thing, and `"auto"` behaves like `"sdk"` for
 * now - it will fall back to the CLI once that backend exists.
 */
export async function createBackend(
  backendSetting: BackendSetting,
  libraryPath: string | undefined,
  log: LogOutputChannel,
): Promise<LoreBackend> {
  if (backendSetting === 'cli') {
    throw new Error(
      'loreScm.backend is set to "cli", but the CLI backend is not implemented yet (planned for Phase 6). Use "sdk" or "auto".',
    );
  }
  return SdkBackend.create(libraryPath, log);
}
