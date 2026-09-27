/**
 * Serializes writes, lets reads run freely except against an in-flight write, and coalesces
 * refresh requests so a burst of triggers (watcher events, focus, manual refresh) collapses into
 * at most one extra run after the current one finishes. See PLAN.md §6.5.
 */
export class OperationQueue {
  private writeLock: Promise<unknown> = Promise.resolve();
  private refreshInFlight: Promise<void> | undefined;
  private refreshQueued = false;

  /** Runs `fn` once any in-flight write has settled. Multiple reads may run concurrently. */
  read<T>(fn: () => Promise<T>): Promise<T> {
    return this.writeLock.then(fn, fn);
  }

  /** Runs `fn` exclusively: after any prior write, and blocking reads/writes queued after it. */
  write<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeLock.then(fn, fn);
    this.writeLock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Requests a refresh. If one is already running, marks that another is needed and returns the
   * same promise the caller already has no way to distinguish from a fresh one - callers that
   * need to know the *next* refresh completed should await this call's return value again.
   */
  coalesceRefresh(fn: () => Promise<void>): Promise<void> {
    if (this.refreshInFlight) {
      this.refreshQueued = true;
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.read(fn).then(async () => {
      if (this.refreshQueued) {
        this.refreshQueued = false;
        this.refreshInFlight = undefined;
        await this.coalesceRefresh(fn);
      } else {
        this.refreshInFlight = undefined;
      }
    });
    return this.refreshInFlight;
  }
}
