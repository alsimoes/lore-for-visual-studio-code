import type { CommitResult, StatusSnapshot, SyncResult } from './model.js';

/**
 * The extension's own domain interface to Lore. Nothing above this layer may import
 * `@lore-vcs/sdk` directly (enforced by an ESLint no-restricted-imports rule) - everything goes
 * through here, and every method throws only `LoreOperationError`. Grows one method per phase, as
 * commands need them; see PLAN.md §4.3 for the full interface this converges toward.
 *
 * Progress reporting is deliberately simple for now: callers wrap a call in
 * `vscode.window.withProgress` for an indeterminate spinner rather than this interface streaming
 * incremental percentages, since the SDK's own progress events would need the raw per-event
 * `.callback()` path (native-memory-backed until copied) instead of the simpler, SDK-documented
 * "JS-owned" `.collectAsync()` this backend uses everywhere else (PLAN.md §3.3, §4.4).
 */
export interface LoreBackend {
  readonly kind: 'sdk' | 'cli';
  version(): Promise<string>;
  dispose(): Promise<void>;

  status(root: string, opts?: { scan?: boolean; checkDirty?: boolean }): Promise<StatusSnapshot>;
  readFileAt(root: string, path: string, revision: string): Promise<Uint8Array>;

  markDirty(root: string, paths: string[]): Promise<void>;

  stage(root: string, paths: string[], opts?: { scan?: boolean }): Promise<void>;
  /**
   * Stages a rename atomically. Must be called before anything calls `markDirty` on either path -
   * doing so first leaves Lore unable to find the old path, per docs/spike-findings.md's Phase 2
   * addendum. There is deliberately no separate "mark a rename dirty without staging it" method.
   */
  stageMove(root: string, fromPath: string, toPath: string): Promise<void>;
  unstage(root: string, paths: string[]): Promise<void>;
  reset(root: string, paths: string[], opts?: { purge?: boolean; revision?: string }): Promise<void>;

  commit(root: string, message: string): Promise<CommitResult>;
  amendMessage(root: string, message: string): Promise<void>;

  push(root: string, opts?: { fastForwardMerge?: boolean }): Promise<void>;
  sync(root: string, opts?: { revision?: string; reset?: boolean }): Promise<SyncResult>;
}
