import { relative } from 'node:path';
import * as vscode from 'vscode';
import type { LogOutputChannel } from 'vscode';
import type { LoreBackend } from '../lore/backend.js';
import type { CommitResult, StatusSnapshot, SyncResult } from '../lore/model.js';
import { config } from '../config.js';
import { OperationQueue } from './operationQueue.js';
import { DirtyTracker } from './dirtyTracker.js';

const DOT_LORE_WATCHER_DEBOUNCE_MS = 500;

function toPosixRelative(root: string, fsPath: string): string {
  return relative(root, fsPath).split('\\').join('/');
}

export class Repository implements vscode.Disposable {
  readonly rootUri: vscode.Uri;
  private readonly queue = new OperationQueue();
  private readonly dirtyTracker: DirtyTracker;
  private readonly onDidChangeStatusEmitter = new vscode.EventEmitter<StatusSnapshot>();
  readonly onDidChangeStatus = this.onDidChangeStatusEmitter.event;
  private readonly onDidRunOperationEmitter = new vscode.EventEmitter<{ operation: string; error?: unknown }>();
  readonly onDidRunOperation = this.onDidRunOperationEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private _status: StatusSnapshot | undefined;
  private lastRefreshAt = 0;
  private dotLoreDebounceTimer: NodeJS.Timeout | undefined;
  private checkDirtyInterval: NodeJS.Timeout | undefined;

  constructor(
    readonly root: string,
    private readonly backend: LoreBackend,
    private readonly log: LogOutputChannel,
  ) {
    this.rootUri = vscode.Uri.file(root);
    this.dirtyTracker = new DirtyTracker({
      markDirty: (paths) => backend.markDirty(root, paths),
      onMarked: () => void this.refresh(),
      debounceMs: config.dirtyDebounceMs,
    });
    this.watchDotLore();
    this.watchWorkingTree();
    this.scheduleCheckDirtyInterval();
  }

  get status(): StatusSnapshot | undefined {
    return this._status;
  }

  get lastRefreshedAt(): number {
    return this.lastRefreshAt;
  }

  /** Refreshes status. Concurrent calls while one is already running are coalesced (§6.5). */
  async refresh(opts?: { scan?: boolean; checkDirty?: boolean }): Promise<void> {
    const started = Date.now();
    await this.queue.coalesceRefresh(async () => {
      const snapshot = await this.backend.status(this.root, opts);
      this._status = snapshot;
      this.onDidChangeStatusEmitter.fire(snapshot);
    });
    this.lastRefreshAt = Date.now();
    this.log.debug(`[${this.root}] refresh (scan=${Boolean(opts?.scan)}) ${this.lastRefreshAt - started}ms`);
  }

  async readFileAt(path: string, revision: string): Promise<Uint8Array> {
    return this.queue.read(() => this.backend.readFileAt(this.root, path, revision));
  }

  /** Runs a write operation exclusively, then refreshes (no scan) per §6.4, and reports outcome. */
  private async write<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      const result = await this.queue.write(fn);
      await this.refresh();
      this.onDidRunOperationEmitter.fire({ operation });
      return result;
    } catch (error) {
      this.onDidRunOperationEmitter.fire({ operation, error });
      throw error;
    }
  }

  async stage(paths: string[], opts?: { scan?: boolean }): Promise<void> {
    await this.write('stage', () => this.backend.stage(this.root, paths, opts));
  }

  async stageMove(fromPath: string, toPath: string): Promise<void> {
    await this.write('stageMove', () => this.backend.stageMove(this.root, fromPath, toPath));
  }

  async unstage(paths: string[]): Promise<void> {
    await this.write('unstage', () => this.backend.unstage(this.root, paths));
  }

  async discard(paths: string[], opts?: { purge?: boolean; revision?: string }): Promise<void> {
    await this.write('discard', () => this.backend.reset(this.root, paths, opts));
  }

  async commit(message: string): Promise<CommitResult> {
    return this.write('commit', () => this.backend.commit(this.root, message));
  }

  async amendMessage(message: string): Promise<void> {
    await this.write('amendMessage', () => this.backend.amendMessage(this.root, message));
  }

  async push(opts?: { fastForwardMerge?: boolean }): Promise<void> {
    await this.write('push', () => this.backend.push(this.root, opts));
  }

  async sync(opts?: { revision?: string; reset?: boolean }): Promise<SyncResult> {
    return this.write('sync', () => this.backend.sync(this.root, opts));
  }

  /**
   * Watches `.lore/**` so a `lore commit`/`sync`/`branch switch` run in an external terminal is
   * picked up without a manual refresh (§6.4). Debounced: the store is a content-addressed shard
   * tree that churns many files per operation (see docs/spike-findings.md, spike S13), so the
   * glob can't be narrowed - only debounced.
   */
  private watchDotLore(): void {
    const pattern = new vscode.RelativePattern(this.root, '.lore/**');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const scheduleRefresh = (): void => {
      if (this.dotLoreDebounceTimer) {
        clearTimeout(this.dotLoreDebounceTimer);
      }
      this.dotLoreDebounceTimer = setTimeout(() => {
        this.dotLoreDebounceTimer = undefined;
        void this.refresh();
      }, DOT_LORE_WATCHER_DEBOUNCE_MS);
    };
    this.disposables.push(
      watcher,
      watcher.onDidChange(scheduleRefresh),
      watcher.onDidCreate(scheduleRefresh),
      watcher.onDidDelete(scheduleRefresh),
    );
  }

  /**
   * Feeds the DirtyTracker from real file-system activity under the working tree, per §6.3 step
   * 2. `.lore/` itself is excluded (that's watchDotLore's job, and marking it dirty would be
   * nonsensical). Nested working trees are not excluded here - a rare case left as a known
   * simplification for this phase, since Lore harmlessly ignores paths outside its own tree.
   */
  private watchWorkingTree(): void {
    const isWithinRoot = (uri: vscode.Uri): boolean => uri.fsPath.startsWith(this.root);
    const isDotLore = (uri: vscode.Uri): boolean => toPosixRelative(this.root, uri.fsPath).startsWith('.lore/');

    const pattern = new vscode.RelativePattern(this.root, '**/*');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onFsEvent = (uri: vscode.Uri): void => {
      if (isDotLore(uri)) {
        return;
      }
      this.dirtyTracker.notifyChanged(toPosixRelative(this.root, uri.fsPath));
    };

    this.disposables.push(
      watcher,
      watcher.onDidChange(onFsEvent),
      watcher.onDidCreate(onFsEvent),
      watcher.onDidDelete(onFsEvent),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (isWithinRoot(doc.uri) && !isDotLore(doc.uri)) {
          this.dirtyTracker.notifyChanged(toPosixRelative(this.root, doc.uri.fsPath));
        }
      }),
      vscode.workspace.onDidRenameFiles((event) => {
        for (const { oldUri, newUri } of event.files) {
          if (isWithinRoot(oldUri) && isWithinRoot(newUri) && !isDotLore(oldUri) && !isDotLore(newUri)) {
            // Stage the rename immediately via fileStageMove, rather than dirty-marking it for
            // later staging: fileStageMove must run before anything calls fileDirtyMove on the
            // same path, or it fails with "Node not found" (docs/spike-findings.md, Phase 2
            // addendum). This means a rename in the Explorer appears already staged, which is a
            // deliberate, SDK-driven difference from Git's unstaged-by-default rename display.
            void this.stageMove(toPosixRelative(this.root, oldUri.fsPath), toPosixRelative(this.root, newUri.fsPath));
          }
        }
      }),
    );
  }

  /** Safety net: periodically verify dirty flags against disk, independent of the watcher (§6.3 step 3). */
  private scheduleCheckDirtyInterval(): void {
    const seconds = config.checkDirtyIntervalSec;
    if (seconds <= 0) {
      return;
    }
    this.checkDirtyInterval = setInterval(() => void this.refresh({ checkDirty: true }), seconds * 1000);
  }

  dispose(): void {
    if (this.dotLoreDebounceTimer) {
      clearTimeout(this.dotLoreDebounceTimer);
    }
    if (this.checkDirtyInterval) {
      clearInterval(this.checkDirtyInterval);
    }
    this.dirtyTracker.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeStatusEmitter.dispose();
    this.onDidRunOperationEmitter.dispose();
  }
}
