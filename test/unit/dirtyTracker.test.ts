import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirtyTracker } from '../../src/repository/dirtyTracker.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DirtyTracker', () => {
  it('debounces multiple notifyChanged calls into a single markDirty batch', async () => {
    const markDirty = vi.fn().mockResolvedValue(undefined);
    const onMarked = vi.fn();
    const tracker = new DirtyTracker({ markDirty, onMarked, debounceMs: 300 });

    tracker.notifyChanged('a.txt');
    tracker.notifyChanged('b.txt');
    tracker.notifyChanged('a.txt'); // duplicate, should not appear twice

    expect(markDirty).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);

    expect(markDirty).toHaveBeenCalledTimes(1);
    expect(markDirty).toHaveBeenCalledWith(['a.txt', 'b.txt']);
    expect(onMarked).toHaveBeenCalledTimes(1);
  });

  it('resets the debounce timer on each new change', async () => {
    const markDirty = vi.fn().mockResolvedValue(undefined);
    const tracker = new DirtyTracker({ markDirty, onMarked: vi.fn(), debounceMs: 300 });

    tracker.notifyChanged('a.txt');
    await vi.advanceTimersByTimeAsync(200);
    tracker.notifyChanged('b.txt'); // resets the 300ms window
    await vi.advanceTimersByTimeAsync(200);

    expect(markDirty).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(markDirty).toHaveBeenCalledWith(['a.txt', 'b.txt']);
  });

  it('splits a batch larger than maxBatchSize into multiple markDirty calls', async () => {
    const markDirty = vi.fn().mockResolvedValue(undefined);
    const tracker = new DirtyTracker({
      markDirty,
      onMarked: vi.fn(),
      debounceMs: 10,
      maxBatchSize: 2,
    });

    tracker.notifyChanged('a');
    tracker.notifyChanged('b');
    tracker.notifyChanged('c');
    await vi.advanceTimersByTimeAsync(10);

    expect(markDirty).toHaveBeenCalledTimes(2);
    expect(markDirty).toHaveBeenNthCalledWith(1, ['a', 'b']);
    expect(markDirty).toHaveBeenNthCalledWith(2, ['c']);
  });

  it('flush() is a no-op when nothing is pending', async () => {
    const markDirty = vi.fn().mockResolvedValue(undefined);
    const onMarked = vi.fn();
    const tracker = new DirtyTracker({ markDirty, onMarked, debounceMs: 300 });

    await tracker.flush();

    expect(markDirty).not.toHaveBeenCalled();
    expect(onMarked).not.toHaveBeenCalled();
  });

  it('dispose() cancels a pending flush', async () => {
    const markDirty = vi.fn().mockResolvedValue(undefined);
    const tracker = new DirtyTracker({ markDirty, onMarked: vi.fn(), debounceMs: 300 });

    tracker.notifyChanged('a.txt');
    tracker.dispose();
    await vi.advanceTimersByTimeAsync(1000);

    expect(markDirty).not.toHaveBeenCalled();
  });
});
