/**
 * Batches file-system change notifications into `fileDirty` calls (PLAN.md §6.3). Pure and
 * vscode-free so it can be unit tested with fake timers - the actual FS event source (file
 * watchers) and timers are both injected by the caller, per the plan's Phase 2 task list.
 *
 * Renames are handled separately by `Repository`, not here (see its `watchWorkingTree`): a
 * Lore rename must be staged via `fileStageMove` *before* anything calls `fileDirtyMove` on the
 * same path, or the stage call fails with "Node not found" (verified empirically - see
 * docs/spike-findings.md, Phase 2 addendum). Debouncing a `markMoved` call the way plain dirty
 * marks are debounced would create exactly that broken ordering, so renames are staged
 * immediately instead of flowing through this batcher.
 */
export interface DirtyTrackerDeps {
  markDirty(paths: string[]): Promise<void>;
  /** Called after a batch of dirty marks is applied, to trigger a no-scan refresh. */
  onMarked(): void;
  debounceMs: number;
  /** Paths per `fileDirty` call; large batches are split so one huge call can't stall. */
  maxBatchSize?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

const DEFAULT_MAX_BATCH_SIZE = 1000;

export class DirtyTracker {
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly maxBatchSize: number;
  /** Resolves the next time a debounced flush completes; tests can await this. */
  private flushed: Promise<void> = Promise.resolve();
  private resolveFlushed: (() => void) | undefined;

  constructor(private readonly deps: DirtyTrackerDeps) {
    this.setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
    this.maxBatchSize = deps.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  }

  /** Queues a changed path. Actual marking is debounced by `debounceMs`. */
  notifyChanged(relativePath: string): void {
    this.pending.add(relativePath);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) {
      this.clearTimeoutFn(this.timer);
    }
    if (!this.resolveFlushed) {
      this.flushed = new Promise((resolve) => {
        this.resolveFlushed = resolve;
      });
    }
    this.timer = this.setTimeoutFn(() => {
      this.timer = undefined;
      void this.flush();
    }, this.deps.debounceMs);
  }

  /** Runs the pending batch now, without waiting for the debounce timer. Exposed for tests. */
  async flush(): Promise<void> {
    if (this.timer) {
      this.clearTimeoutFn(this.timer);
      this.timer = undefined;
    }
    const resolve = this.resolveFlushed;
    this.resolveFlushed = undefined;
    if (this.pending.size === 0) {
      resolve?.();
      return;
    }
    const paths = [...this.pending];
    this.pending.clear();
    for (let i = 0; i < paths.length; i += this.maxBatchSize) {
      await this.deps.markDirty(paths.slice(i, i + this.maxBatchSize));
    }
    this.deps.onMarked();
    resolve?.();
  }

  /** Resolves once the currently pending (or just-scheduled) batch has been flushed. */
  waitForIdle(): Promise<void> {
    return this.flushed;
  }

  dispose(): void {
    if (this.timer) {
      this.clearTimeoutFn(this.timer);
      this.timer = undefined;
    }
  }
}
