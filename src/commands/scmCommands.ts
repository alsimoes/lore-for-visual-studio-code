import { join } from 'node:path';
import * as vscode from 'vscode';
import type { FileChange } from '../lore/model.js';
import type { RepositoryManager } from '../repository/repositoryManager.js';
import type { ResourceGroupId } from '../repository/statusModel.js';
import { config } from '../config.js';
import { toLoreUri } from '../scm/loreUri.js';
import type { LoreResource } from '../scm/resource.js';
import { resolveRepository } from './commandUtils.js';

async function refreshCommand(
  repos: RepositoryManager | undefined,
  arg: unknown,
  opts?: { scan?: boolean },
): Promise<void> {
  if (!repos) {
    return;
  }
  const repo = resolveRepository(arg, repos);
  const targets = repo ? [repo] : repos.all;
  await Promise.all(targets.map((r) => r.refresh(opts)));
}

async function openChange(root: string, change: FileChange, group: ResourceGroupId): Promise<void> {
  const fileUri = vscode.Uri.file(join(root, change.path));
  const basename = change.path.split('/').pop() ?? change.path;

  if (change.kind === 'deleted') {
    const headUri = toLoreUri(fileUri.fsPath, { root, ref: '~HEAD' });
    await vscode.commands.executeCommand('vscode.open', headUri);
    return;
  }
  const isUntracked = group === 'changes' && change.kind === 'added';
  if (isUntracked || !config.openDiffOnClick) {
    await vscode.commands.executeCommand('vscode.open', fileUri);
    return;
  }

  // For a moved file, the HEAD-side content lives at the old path.
  const headRelativePath = change.fromPath ?? change.path;
  const headFsPath = join(root, headRelativePath);
  const left = toLoreUri(headFsPath, { root, ref: '~HEAD' });
  const title = `${basename} (${group === 'staged' ? 'Staged' : 'Working Tree'})`;
  await vscode.commands.executeCommand('vscode.diff', left, fileUri, title);
}

export function registerScmCommands(
  context: vscode.ExtensionContext,
  repos: RepositoryManager | undefined,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('loreScm.refresh', (arg?: unknown) => refreshCommand(repos, arg)),
    vscode.commands.registerCommand('loreScm.rescan', (arg?: unknown) =>
      refreshCommand(repos, arg, { scan: true }),
    ),
    vscode.commands.registerCommand('loreScm.openFile', async (resource: LoreResource | vscode.Uri) => {
      const uri = resource instanceof vscode.Uri ? resource : resource.resourceUri;
      await vscode.commands.executeCommand('vscode.open', uri);
    }),
    vscode.commands.registerCommand('loreScm.openHEADFile', async (resource: LoreResource) => {
      const repo = repos?.getRepositoryForUri(resource.resourceUri);
      if (!repo) {
        return;
      }
      const uri = toLoreUri(resource.resourceUri.fsPath, { root: repo.root, ref: '~HEAD' });
      await vscode.commands.executeCommand('vscode.open', uri);
    }),
    vscode.commands.registerCommand(
      'loreScm.openChange',
      (root: string, change: FileChange, group: ResourceGroupId) => openChange(root, change, group),
    ),
  );
}
