import * as vscode from 'vscode';
import type { StatusSnapshot } from '../lore/model.js';
import type { Repository } from '../repository/repository.js';
import { groupChanges } from '../repository/statusModel.js';
import { config } from '../config.js';
import { toResourceState, type LoreResource } from './resource.js';
import { LoreQuickDiffProvider } from './quickDiff.js';

function isUntracked(resource: LoreResource): boolean {
  return resource.group === 'changes' && resource.change.kind === 'added';
}

/** One `vscode.SourceControl` per open Lore repository, rendering its status (§6.2, §6.1). */
export class LoreScmProvider implements vscode.Disposable {
  readonly sourceControl: vscode.SourceControl;
  private readonly mergeGroup: vscode.SourceControlResourceGroup;
  private readonly stagedGroup: vscode.SourceControlResourceGroup;
  private readonly changesGroup: vscode.SourceControlResourceGroup;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(readonly repo: Repository) {
    this.sourceControl = vscode.scm.createSourceControl('loreScm', 'Lore', repo.rootUri);
    this.sourceControl.quickDiffProvider = new LoreQuickDiffProvider(repo);

    // Commit support (and enabling this input box) arrives in Phase 2.
    this.sourceControl.inputBox.enabled = false;
    this.sourceControl.inputBox.placeholder = 'Commit support arrives in Phase 2';

    this.mergeGroup = this.sourceControl.createResourceGroup('merge', 'Merge Changes');
    this.mergeGroup.hideWhenEmpty = true;
    this.stagedGroup = this.sourceControl.createResourceGroup('staged', 'Staged Changes');
    this.stagedGroup.hideWhenEmpty = true;
    this.changesGroup = this.sourceControl.createResourceGroup('changes', 'Changes');
    this.changesGroup.hideWhenEmpty = true;

    this.disposables.push(repo.onDidChangeStatus((snapshot) => this.render(snapshot)));
    if (repo.status) {
      this.render(repo.status);
    }
  }

  private render(snapshot: StatusSnapshot): void {
    const merge: LoreResource[] = [];
    const staged: LoreResource[] = [];
    const changes: LoreResource[] = [];
    for (const grouped of groupChanges(snapshot.changes)) {
      const resource = toResourceState(this.repo.root, grouped);
      switch (grouped.group) {
        case 'merge':
          merge.push(resource);
          break;
        case 'staged':
          staged.push(resource);
          break;
        case 'changes':
          changes.push(resource);
          break;
      }
    }
    this.mergeGroup.resourceStates = merge;
    this.stagedGroup.resourceStates = staged;
    this.changesGroup.resourceStates = changes;

    this.sourceControl.count = this.computeCount(merge, staged, changes);
    this.updateStatusBar(snapshot);
  }

  private computeCount(merge: LoreResource[], staged: LoreResource[], changes: LoreResource[]): number {
    if (config.countBadge === 'off') {
      return 0;
    }
    const total = merge.length + staged.length + changes.length;
    if (config.countBadge === 'tracked') {
      return total - changes.filter(isUntracked).length;
    }
    return total;
  }

  private updateStatusBar(snapshot: StatusSnapshot): void {
    const state = snapshot.state;
    const commands: vscode.Command[] = [
      {
        title: `$(git-branch) ${state.branchName}`,
        command: 'loreScm.showOutput',
        tooltip: `Lore branch: ${state.branchName} (#${state.revisionNumber})`,
      },
    ];
    if (state.remoteAvailable) {
      const parts: string[] = [];
      if (state.isRemoteAhead) {
        parts.push('$(arrow-down)');
      }
      if (state.isLocalAhead) {
        parts.push('$(arrow-up)');
      }
      if (parts.length > 0) {
        commands.push({
          title: parts.join(' '),
          command: 'loreScm.showOutput',
          tooltip: 'Remote state (push/sync arrive in Phase 2)',
        });
      }
    }
    this.sourceControl.statusBarCommands = commands;
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.sourceControl.dispose();
  }
}
