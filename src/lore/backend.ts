import type { StatusSnapshot } from './model.js';

/**
 * The extension's own domain interface to Lore. Nothing above this layer may import
 * `@lore-vcs/sdk` directly (enforced by an ESLint no-restricted-imports rule) - everything goes
 * through here, and every method throws only `LoreOperationError`. Grows one method per phase, as
 * commands need them; see PLAN.md §4.3 for the full interface this converges toward.
 */
export interface LoreBackend {
  readonly kind: 'sdk' | 'cli';
  version(): Promise<string>;
  dispose(): Promise<void>;

  status(root: string, opts?: { scan?: boolean; checkDirty?: boolean }): Promise<StatusSnapshot>;
  readFileAt(root: string, path: string, revision: string): Promise<Uint8Array>;
}
