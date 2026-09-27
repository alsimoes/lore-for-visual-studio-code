import type { ChangeKind, FileChange } from '../lore/model.js';

export type ResourceGroupId = 'merge' | 'staged' | 'changes';

/** A one-letter status badge, matching the built-in Git extension's convention. */
export type StatusLetter = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '!';

export interface GroupedChange {
  group: ResourceGroupId;
  letter: StatusLetter;
  change: FileChange;
}

function letterFor(kind: ChangeKind, group: ResourceGroupId): StatusLetter {
  if (group === 'merge') {
    return '!';
  }
  if (kind === 'added' && group === 'changes') {
    // An added file that isn't staged yet is untracked, not "added" in the Git sense.
    return 'U';
  }
  switch (kind) {
    case 'modified':
      return 'M';
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'moved':
      return 'R';
    case 'copied':
      return 'C';
  }
}

/**
 * Assigns each change to exactly one SCM resource group, evaluated in the order documented in
 * PLAN.md §6.2: an unresolved conflict always wins, then staged, then a plain dirty change.
 * A file that is both staged and dirty (edited again after staging - see docs/spike-findings.md
 * spike S2) is shown only in Staged Changes, matching the plan's mitigation for that ambiguity.
 */
export function groupChange(change: FileChange): GroupedChange {
  let group: ResourceGroupId;
  if (change.conflict?.unresolved) {
    group = 'merge';
  } else if (change.staged) {
    group = 'staged';
  } else {
    group = 'changes';
  }
  return { group, letter: letterFor(change.kind, group), change };
}

export function groupChanges(changes: FileChange[]): GroupedChange[] {
  return changes.map(groupChange);
}
