import * as vscode from 'vscode';
import type { LogOutputChannel } from 'vscode';
import type { LoreBackend } from '../lore/backend.js';
import type { StatusSnapshot } from '../lore/model.js';
import { OperationQueue } from './operationQueue.js';

const DOT_LORE_WATCHER_DEBOUNCE_MS = 500;

export class Repository implements vscode.Disposable {
  readonly rootUri: vscode.Uri;
  private readonly queue = new OperationQueue();
  private readonly onDidChangeStatusEmitter = new vscode.EventEmitter<StatusSnapshot>();
  readonly onDidChangeStatus = this.onDidChangeStatusEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private _status: StatusSnapshot | undefined;
  private lastRefreshAt = 0;
  private dotLoreDebounceTimer: NodeJS.Timeout | undefined;

  constructor(
    readonly root: string,
    private readonly backend: LoreBackend,
    private readonly log: LogOutputChannel,
  ) {
    this.rootUri = vscode.Uri.file(root);
    this.watchDotLore();
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

  dispose(): void {
    if (this.dotLoreDebounceTimer) {
      clearTimeout(this.dotLoreDebounceTimer);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeStatusEmitter.dispose();
  }
}
