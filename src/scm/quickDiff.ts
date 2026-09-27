import { relative } from 'node:path';
import * as vscode from 'vscode';
import type { Repository } from '../repository/repository.js';
import { config } from '../config.js';
import { toLoreUri } from './loreUri.js';

/** Feeds the editor gutter's quick diff markers for tracked, modified files (§6.6). */
export class LoreQuickDiffProvider implements vscode.QuickDiffProvider {
  constructor(private readonly repo: Repository) {}

  provideOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (uri.scheme !== 'file') {
      return undefined;
    }
    const status = this.repo.status;
    if (!status) {
      return undefined;
    }
    const relativePath = relative(this.repo.root, uri.fsPath).split('\\').join('/');
    const change = status.changes.find((c) => c.path === relativePath);
    // No change, an added/untracked file, or a file too large: nothing to compare against.
    if (!change || change.kind === 'added' || change.size > config.quickDiffMaxSize) {
      return undefined;
    }
    return toLoreUri(uri.fsPath, { root: this.repo.root, ref: '~HEAD' });
  }
}
