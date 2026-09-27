export type ChangeKind = 'modified' | 'added' | 'deleted' | 'moved' | 'copied';

export interface FileChange {
  /** Relative to the working tree root, forward slashes. */
  path: string;
  /** Previous path, for moved/copied changes. */
  fromPath?: string | undefined;
  kind: ChangeKind;
  staged: boolean;
  dirty: boolean;
  conflict?:
    | {
        unresolved: boolean;
        automerged: boolean;
        mine: boolean;
        theirs: boolean;
      }
    | undefined;
  merged: boolean;
  size: number;
}

export interface RevisionState {
  repositoryId: string;
  branchId: string;
  branchName: string;
  /** Hash of the current (committed) revision. */
  revision: string;
  revisionNumber: number;
  /** Hash of the staged state, or undefined when nothing is staged. */
  stagedRevision?: string | undefined;
  /** Hash of the incoming revision of a pending merge, or undefined when none is in progress. */
  mergedRevision?: string | undefined;
  localRevision: string;
  localRevisionNumber: number;
  remoteRevision?: string | undefined;
  remoteRevisionNumber?: number | undefined;
  isLocalAhead: boolean;
  isRemoteAhead: boolean;
  remoteAvailable: boolean;
  remoteAuthorized: boolean;
  remoteBranchExists: boolean;
}

export interface StatusSnapshot {
  state: RevisionState;
  changes: FileChange[];
  /** Set when the file count exceeded loreScm.statusLimit and the list was truncated. */
  truncated: boolean;
  takenAt: number;
}
