import { join } from 'node:path';
import * as vscode from 'vscode';
import type { FileChange } from '../lore/model.js';
import type { GroupedChange, StatusLetter } from '../repository/statusModel.js';

export function tooltipFor(change: FileChange, letter: StatusLetter): string {
  if (letter === '!') {
    return change.conflict?.unresolved ? 'Conflict' : 'Conflict (resolved)';
  }
  switch (letter) {
    case 'M':
      return 'Modified';
    case 'A':
      return 'Added';
    case 'U':
      return 'Untracked';
    case 'D':
      return 'Deleted';
    case 'R':
      return `Renamed from ${change.fromPath ?? '?'}`;
    case 'C':
      return `Copied from ${change.fromPath ?? '?'}`;
  }
}

export interface LoreResource extends vscode.SourceControlResourceState {
  readonly change: FileChange;
  readonly group: GroupedChange['group'];
}

/**
 * The colored M/A/D/U/R/C/! badge itself comes from `FileDecorationProvider` (decorations.ts),
 * which VS Code applies to a resource by its `resourceUri` in both the explorer and the SCM view
 * - the same as the built-in Git extension. `decorations` here only covers what
 * `SourceControlResourceState` itself controls: strike-through and the hover tooltip.
 */
export function toResourceState(root: string, grouped: GroupedChange): LoreResource {
  const { change, letter, group } = grouped;
  const resourceUri = vscode.Uri.file(join(root, change.path));
  return {
    resourceUri,
    change,
    group,
    command: {
      command: 'loreScm.openChange',
      title: 'Open Change',
      arguments: [root, change, group],
    },
    decorations: {
      strikeThrough: letter === 'D',
      tooltip: tooltipFor(change, letter),
    },
    contextValue: group === 'merge' ? 'merge' : 'change',
  };
}
