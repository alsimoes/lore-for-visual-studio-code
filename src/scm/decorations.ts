import { join } from 'node:path';
import * as vscode from 'vscode';
import type { RepositoryManager } from '../repository/repositoryManager.js';
import type { Repository } from '../repository/repository.js';
import { groupChange, type GroupedChange, type StatusLetter } from '../repository/statusModel.js';
import { tooltipFor } from './resource.js';

const COLOR_BY_LETTER: Record<StatusLetter, string> = {
  M: 'loreScmDecoration.modifiedResourceForeground',
  A: 'loreScmDecoration.addedResourceForeground',
  U: 'loreScmDecoration.untrackedResourceForeground',
  D: 'loreScmDecoration.deletedResourceForeground',
  R: 'loreScmDecoration.renamedResourceForeground',
  C: 'loreScmDecoration.renamedResourceForeground',
  '!': 'loreScmDecoration.conflictingResourceForeground',
};

/** Feeds explorer/tab decorations from each open repository's current status (§6.2, §6.17). */
export class LoreDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.onDidChangeFileDecorationsEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly byRepoRoot = new Map<string, Map<string, GroupedChange>>();

  constructor(repos: RepositoryManager) {
    this.disposables.push(
      repos.onDidOpenRepository((repo) => this.trackRepository(repo)),
      repos.onDidCloseRepository((repo) => {
        this.byRepoRoot.delete(repo.root);
        this.fireAll();
      }),
    );
    for (const repo of repos.all) {
      this.trackRepository(repo);
    }
  }

  private trackRepository(repo: Repository): void {
    this.disposables.push(
      repo.onDidChangeStatus((snapshot) => {
        const index = new Map<string, GroupedChange>();
        for (const change of snapshot.changes) {
          index.set(join(repo.root, change.path), groupChange(change));
        }
        this.byRepoRoot.set(repo.root, index);
        this.fireAll();
      }),
    );
  }

  private fireAll(): void {
    this.onDidChangeFileDecorationsEmitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'file') {
      return undefined;
    }
    for (const index of this.byRepoRoot.values()) {
      const grouped = index.get(uri.fsPath);
      if (grouped) {
        return new vscode.FileDecoration(
          grouped.letter,
          tooltipFor(grouped.change, grouped.letter),
          new vscode.ThemeColor(COLOR_BY_LETTER[grouped.letter]),
        );
      }
    }
    return undefined;
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeFileDecorationsEmitter.dispose();
  }
}
