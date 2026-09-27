import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mapCommitResult,
  mapFileChange,
  mapRevisionState,
  mapStatusEvents,
  mapSyncResult,
  type LoreRawEvent,
} from '../../src/lore/eventMapping.js';

function loadFixture(name: string): LoreRawEvent[] {
  const path = join(__dirname, '..', 'fixtures', 'events', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as LoreRawEvent[];
}

describe('mapRevisionState', () => {
  it('turns zero hashes into undefined (nothing staged / no pending merge / no remote)', () => {
    const events = loadFixture('s2-status-scan-after-mutation');
    const revisionEvent = events.find((e) => e.tagName === 'repositoryStatusRevision')!;
    const state = mapRevisionState(revisionEvent.data as Parameters<typeof mapRevisionState>[0]);

    expect(state.branchName).toBe('main');
    expect(state.stagedRevision).toBe('d2615108ad13071adb2e9b7f1754000c7adb226f64034ba696720ef26cab74ec');
    expect(state.mergedRevision).toBeUndefined();
    expect(state.remoteRevision).toBeUndefined();
    expect(state.remoteRevisionNumber).toBeUndefined();
    expect(state.remoteAvailable).toBe(false);
  });

  it('carries real values through for a pending merge with a reachable, authorized remote', () => {
    const events = loadFixture('s6-status-after-resolve');
    const revisionEvent = events.find((e) => e.tagName === 'repositoryStatusRevision')!;
    const state = mapRevisionState(revisionEvent.data as Parameters<typeof mapRevisionState>[0]);

    expect(state.mergedRevision).toBe('09fdb4fd4de5a2b1e6cccba4d77e431270f0a8b4bd638f4829fcb03d65e7ec6d');
    expect(state.remoteAvailable).toBe(true);
    expect(state.remoteAuthorized).toBe(true);
    expect(state.remoteBranchExists).toBe(true);
    expect(state.isLocalAhead).toBe(true);
  });

  it('keeps a real remote revision hash and number after a push', () => {
    const events = loadFixture('s10-status-after-push');
    const revisionEvent = events.find((e) => e.tagName === 'repositoryStatusRevision')!;
    const state = mapRevisionState(revisionEvent.data as Parameters<typeof mapRevisionState>[0]);

    expect(state.remoteRevision).toBe('da95e88ffc856dd5c363a4a4e8aba493e688f18d0bcc58bd73abb1d2fe4a0579');
    expect(state.remoteRevisionNumber).toBe(1);
  });

  it('turns a zero staged-revision hash into undefined (nothing staged)', () => {
    const state = mapRevisionState({
      repository: 'r',
      branch: 'b',
      branchName: 'main',
      revision: 'h',
      revisionNumber: 1,
      revisionStaged: '0000000000000000000000000000000000000000000000000000000000000000',
      revisionMerged: '0000000000000000000000000000000000000000000000000000000000000000',
      revisionLocal: 'h',
      revisionLocalNumber: 1,
      revisionRemote: '0000000000000000000000000000000000000000000000000000000000000000',
      revisionRemoteNumber: 0,
      isLocalAhead: false,
      isRemoteAhead: false,
      remoteAvailable: false,
      remoteAuthorized: false,
      remoteBranchExist: false,
    });
    expect(state.stagedRevision).toBeUndefined();
  });
});

describe('mapFileChange', () => {
  it('maps each LoreFileAction to the right ChangeKind', () => {
    const events = loadFixture('s2-status-scan-after-mutation');
    const files = events.filter((e) => e.tagName === 'repositoryStatusFile');
    const byPath = Object.fromEntries(
      files.map((e) => [
        (e.data as { path: string }).path,
        mapFileChange(e.data as Parameters<typeof mapFileChange>[0]),
      ]),
    );

    expect(byPath['tracked.txt']?.kind).toBe('modified'); // KEEP
    expect(byPath['new.txt']?.kind).toBe('added'); // ADD
    expect(byPath['to-delete.txt']?.kind).toBe('deleted'); // DELETE
  });

  it('maps MOVE and COPY, and returns undefined for a directory entry', () => {
    const moved = mapFileChange({
      path: 'sub/renamed.txt',
      size: 7,
      action: 3,
      type: 1,
      flagStaged: false,
      flagMerged: false,
      flagConflict: false,
      flagConflictUnresolved: false,
      flagConflictAutomerged: false,
      flagConflictMine: false,
      flagConflictTheirs: false,
      flagDirty: true,
      fromPath: 'sub/nested.txt',
    });
    expect(moved?.kind).toBe('moved');
    expect(moved?.fromPath).toBe('sub/nested.txt');

    const copied = mapFileChange({
      path: 'copy.txt',
      size: 7,
      action: 4,
      type: 1,
      flagStaged: true,
      flagMerged: false,
      flagConflict: false,
      flagConflictUnresolved: false,
      flagConflictAutomerged: false,
      flagConflictMine: false,
      flagConflictTheirs: false,
      flagDirty: false,
      fromPath: 'original.txt',
    });
    expect(copied?.kind).toBe('copied');

    const directory = mapFileChange({
      path: 'sub',
      size: 0,
      action: 0,
      type: 0,
      flagStaged: false,
      flagMerged: false,
      flagConflict: false,
      flagConflictUnresolved: false,
      flagConflictAutomerged: false,
      flagConflictMine: false,
      flagConflictTheirs: false,
      flagDirty: true,
      fromPath: '',
    });
    expect(directory).toBeUndefined();
  });

  it('builds a conflict object only when flagConflict is set, from a real resolved-merge fixture', () => {
    const events = loadFixture('s6-status-after-resolve');
    const fileEvent = events.find((e) => e.tagName === 'repositoryStatusFile')!;
    const change = mapFileChange(fileEvent.data as Parameters<typeof mapFileChange>[0]);

    expect(change?.conflict).toEqual({
      unresolved: false,
      automerged: false,
      mine: false,
      theirs: true,
    });
    expect(change?.staged).toBe(true);
    expect(change?.merged).toBe(true);
  });

  it('reports an unresolved conflict', () => {
    const change = mapFileChange({
      path: 'shared.txt',
      size: 27,
      action: 0,
      type: 1,
      flagStaged: false,
      flagMerged: true,
      flagConflict: true,
      flagConflictUnresolved: true,
      flagConflictAutomerged: false,
      flagConflictMine: false,
      flagConflictTheirs: false,
      flagDirty: true,
      fromPath: '',
    });
    expect(change?.conflict?.unresolved).toBe(true);
  });

  it('falls back to "modified" for an action value outside the known enum', () => {
    const change = mapFileChange({
      path: 'weird.txt',
      size: 1,
      action: 99,
      type: 1,
      flagStaged: false,
      flagMerged: false,
      flagConflict: false,
      flagConflictUnresolved: false,
      flagConflictAutomerged: false,
      flagConflictMine: false,
      flagConflictTheirs: false,
      flagDirty: true,
      fromPath: '',
    });
    expect(change?.kind).toBe('modified');
  });

  it('omits fromPath for a plain (non-moved) change', () => {
    const change = mapFileChange({
      path: 'tracked.txt',
      size: 15,
      action: 0,
      type: 1,
      flagStaged: false,
      flagMerged: false,
      flagConflict: false,
      flagConflictUnresolved: false,
      flagConflictAutomerged: false,
      flagConflictMine: false,
      flagConflictTheirs: false,
      flagDirty: true,
      fromPath: '',
    });
    expect(change?.fromPath).toBeUndefined();
  });
});

describe('mapStatusEvents', () => {
  it('builds a full StatusSnapshot from a real event stream, ignoring filterExclude/summary/complete/end', () => {
    const events = loadFixture('s2-status-scan-after-mutation');
    const snapshot = mapStatusEvents(events);

    expect(snapshot.state.branchName).toBe('main');
    expect(snapshot.changes).toHaveLength(6);
    expect(snapshot.changes.map((c) => c.path)).not.toContain('ignored.txt');
    expect(snapshot.truncated).toBe(false);
  });

  it('throws when there is no repositoryStatusRevision event', () => {
    expect(() => mapStatusEvents([{ tag: 2, tagName: 'complete', data: {} }])).toThrow(
      /repositoryStatusRevision/,
    );
  });
});

describe('mapCommitResult', () => {
  it('extracts the revision hash and number from a real commit event stream', () => {
    const result = mapCommitResult(loadFixture('s2-commit-baseline'));
    expect(result.revisionNumber).toBe(1);
    expect(result.revision).toMatch(/^[0-9a-f]+$/);
  });

  it('throws when there is no revisionCommitRevision event', () => {
    expect(() => mapCommitResult([{ tag: 2, tagName: 'complete', data: {} }])).toThrow(
      /revisionCommitRevision/,
    );
  });
});

describe('mapSyncResult', () => {
  it('reports a clean fast-forward sync with no conflicts', () => {
    const result = mapSyncResult([
      {
        tag: 0,
        tagName: 'revisionSyncRevision',
        data: { revision: 'abc123', revisionNumber: 3, flagMerge: false, flagConflict: false },
      },
    ]);
    expect(result).toEqual({
      revision: 'abc123',
      revisionNumber: 3,
      merged: false,
      hasConflicts: false,
      conflictedPaths: [],
    });
  });

  it('collects conflicted paths from branchMergeConflictFile events', () => {
    const result = mapSyncResult([
      { tag: 0, tagName: 'branchMergeConflictFile', data: { path: 'a.txt' } },
      { tag: 0, tagName: 'branchMergeConflictFile', data: { path: 'b.txt' } },
      {
        tag: 0,
        tagName: 'revisionSyncRevision',
        data: { revision: 'def456', revisionNumber: 0, flagMerge: true, flagConflict: true },
      },
    ]);
    expect(result.hasConflicts).toBe(true);
    expect(result.merged).toBe(true);
    expect(result.conflictedPaths).toEqual(['a.txt', 'b.txt']);
  });

  it('throws when there is no revisionSyncRevision event', () => {
    expect(() => mapSyncResult([{ tag: 2, tagName: 'complete', data: {} }])).toThrow(/revisionSyncRevision/);
  });
});
