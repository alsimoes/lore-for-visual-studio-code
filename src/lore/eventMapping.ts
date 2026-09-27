import type { CommitResult, FileChange, ChangeKind, RevisionState, StatusSnapshot, SyncResult } from './model.js';

/**
 * A Lore event as produced by the SDK's `.collectAsync()`/callback path: `{ tag, tagName, data }`.
 * `CliBackend` (Phase 6) must normalize `lore --json`'s output to this same shape (real JS
 * booleans, numeric enums) via `parseLoreEventJSON` plus its own boolean coercion — see
 * docs/spike-findings.md, spike S4 — before these mappers are reused for it.
 */
export interface LoreRawEvent {
  tag: number;
  tagName: string;
  data: unknown;
}

function isZeroHash(hash: string): boolean {
  return /^0+$/.test(hash);
}

const FILE_ACTION_TO_KIND: Record<number, ChangeKind> = {
  0: 'modified',
  1: 'added',
  2: 'deleted',
  3: 'moved',
  4: 'copied',
};

interface RawStatusRevisionData {
  repository: string;
  branch: string;
  branchName: string;
  revision: string;
  revisionNumber: number;
  revisionStaged: string;
  revisionMerged: string;
  revisionLocal: string;
  revisionLocalNumber: number;
  revisionRemote: string;
  revisionRemoteNumber: number;
  isLocalAhead: boolean;
  isRemoteAhead: boolean;
  remoteAvailable: boolean;
  remoteAuthorized: boolean;
  remoteBranchExist: boolean;
}

export function mapRevisionState(data: RawStatusRevisionData): RevisionState {
  return {
    repositoryId: data.repository,
    branchId: data.branch,
    branchName: data.branchName,
    revision: data.revision,
    revisionNumber: data.revisionNumber,
    stagedRevision: isZeroHash(data.revisionStaged) ? undefined : data.revisionStaged,
    mergedRevision: isZeroHash(data.revisionMerged) ? undefined : data.revisionMerged,
    localRevision: data.revisionLocal,
    localRevisionNumber: data.revisionLocalNumber,
    remoteRevision: isZeroHash(data.revisionRemote) ? undefined : data.revisionRemote,
    remoteRevisionNumber: isZeroHash(data.revisionRemote) ? undefined : data.revisionRemoteNumber,
    isLocalAhead: data.isLocalAhead,
    isRemoteAhead: data.isRemoteAhead,
    remoteAvailable: data.remoteAvailable,
    remoteAuthorized: data.remoteAuthorized,
    remoteBranchExists: data.remoteBranchExist,
  };
}

interface RawStatusFileData {
  path: string;
  size: number;
  action: number;
  type: number;
  flagStaged: boolean;
  flagMerged: boolean;
  flagConflict: boolean;
  flagConflictUnresolved: boolean;
  flagConflictAutomerged: boolean;
  flagConflictMine: boolean;
  flagConflictTheirs: boolean;
  flagDirty: boolean;
  fromPath: string;
}

const NODE_TYPE_DIRECTORY = 0;

/** Returns undefined for directory entries, which the SCM view never lists as a change. */
export function mapFileChange(data: RawStatusFileData): FileChange | undefined {
  if (data.type === NODE_TYPE_DIRECTORY) {
    return undefined;
  }
  const kind = FILE_ACTION_TO_KIND[data.action] ?? 'modified';
  return {
    path: data.path,
    fromPath: data.fromPath || undefined,
    kind,
    staged: data.flagStaged,
    dirty: data.flagDirty,
    merged: data.flagMerged,
    conflict: data.flagConflict
      ? {
          unresolved: data.flagConflictUnresolved,
          automerged: data.flagConflictAutomerged,
          mine: data.flagConflictMine,
          theirs: data.flagConflictTheirs,
        }
      : undefined,
    size: data.size,
  };
}

/**
 * Builds a StatusSnapshot from the raw event stream of a `repositoryStatus` call. Returns the
 * full, untruncated change list - applying `loreScm.statusLimit` is a presentation policy that
 * belongs to whoever renders the snapshot (see `Repository.status()`), not this pure mapper.
 */
export function mapStatusEvents(events: LoreRawEvent[]): StatusSnapshot {
  let state: RevisionState | undefined;
  const changes: FileChange[] = [];

  for (const event of events) {
    if (event.tagName === 'repositoryStatusRevision') {
      state = mapRevisionState(event.data as RawStatusRevisionData);
    } else if (event.tagName === 'repositoryStatusFile') {
      const change = mapFileChange(event.data as RawStatusFileData);
      if (change) {
        changes.push(change);
      }
    }
  }

  if (!state) {
    throw new Error('repositoryStatus did not emit a repositoryStatusRevision event');
  }

  return { state, changes, truncated: false, takenAt: Date.now() };
}

/** Builds a CommitResult from the raw event stream of a `revisionCommit`/`revisionAmend` call. */
export function mapCommitResult(events: LoreRawEvent[]): CommitResult {
  const revisionEvent = events.find((e) => e.tagName === 'revisionCommitRevision');
  const data = revisionEvent?.data as { revision: string; revisionNumber: number } | undefined;
  if (!data) {
    throw new Error('revisionCommit did not emit a revisionCommitRevision event');
  }
  return { revision: data.revision, revisionNumber: data.revisionNumber };
}

/** Builds a SyncResult from the raw event stream of a `revisionSync` call. */
export function mapSyncResult(events: LoreRawEvent[]): SyncResult {
  const revisionEvent = events.find((e) => e.tagName === 'revisionSyncRevision');
  const data = revisionEvent?.data as
    | { revision: string; revisionNumber: number; flagMerge: boolean; flagConflict: boolean }
    | undefined;
  if (!data) {
    throw new Error('revisionSync did not emit a revisionSyncRevision event');
  }
  const conflictedPaths = events
    .filter((e) => e.tagName === 'branchMergeConflictFile')
    .map((e) => (e.data as { path: string }).path);
  return {
    revision: data.revision,
    revisionNumber: data.revisionNumber,
    merged: data.flagMerge,
    hasConflicts: data.flagConflict,
    conflictedPaths,
  };
}
