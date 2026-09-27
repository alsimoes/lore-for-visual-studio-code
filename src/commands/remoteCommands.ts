import * as vscode from 'vscode';
import type { RepositoryManager } from '../repository/repositoryManager.js';
import type { Repository } from '../repository/repository.js';
import { config } from '../config.js';
import { LoreOperationError } from '../lore/errors.js';
import { resolveRepository } from './commandUtils.js';

async function runPush(repo: Repository, opts?: { fastForwardMerge?: boolean }): Promise<void> {
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Pushing…' }, () =>
    repo.push(opts),
  );
}

async function runSync(repo: Repository, opts?: { revision?: string; reset?: boolean }): Promise<void> {
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Syncing…' },
    () => repo.sync(opts),
  );
  if (result.hasConflicts) {
    await vscode.commands.executeCommand('workbench.view.scm');
    void vscode.window.showWarningMessage(`Sync produced ${result.conflictedPaths.length} conflict(s).`);
  }
}

async function pushCommand(repos: RepositoryManager, arg: unknown): Promise<void> {
  const repo = resolveRepository(arg, repos) ?? repos.all[0];
  if (!repo) {
    return;
  }
  try {
    await runPush(repo);
  } catch (err) {
    if (err instanceof LoreOperationError && err.errorName === 'BranchAdvanced') {
      const choice = await vscode.window.showWarningMessage(
        'The remote branch has moved. Sync first, then push again, or push with a fast-forward merge?',
        'Sync && Push',
        'Push with Fast-Forward Merge',
      );
      if (choice === 'Sync && Push') {
        await runSync(repo);
        await runPush(repo);
      } else if (choice === 'Push with Fast-Forward Merge') {
        await runPush(repo, { fastForwardMerge: true });
      }
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Push failed: ${message}`);
  }
}

async function syncCommand(repos: RepositoryManager, arg: unknown): Promise<void> {
  const repo = resolveRepository(arg, repos) ?? repos.all[0];
  if (!repo) {
    return;
  }
  if (config.confirmSync) {
    const confirmed = await vscode.window.showInformationMessage(
      `Sync working tree with the remote branch "${repo.status?.state.branchName ?? ''}"?`,
      { modal: true },
      'Sync',
    );
    if (confirmed !== 'Sync') {
      return;
    }
  }
  try {
    await runSync(repo);
  } catch (err) {
    if (err instanceof LoreOperationError && err.errorName === 'LocalModifications') {
      const choice = await vscode.window.showWarningMessage(
        'Sync would overwrite local modifications.',
        { modal: true },
        'Commit First',
        'Discard Local Changes and Sync',
      );
      if (choice === 'Discard Local Changes and Sync') {
        await runSync(repo, { reset: true });
      }
      // "Commit First": the user commits from the SCM view themselves; nothing more to do here.
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Sync failed: ${message}`);
  }
}

async function syncAndPushCommand(repos: RepositoryManager, arg: unknown): Promise<void> {
  const repo = resolveRepository(arg, repos) ?? repos.all[0];
  if (!repo) {
    return;
  }
  if (repo.status?.state.isRemoteAhead) {
    await syncCommand(repos, arg);
  }
  // Re-read status: syncing above (if it ran) refreshes it, and local-ahead may now differ.
  if (repo.status?.state.isLocalAhead) {
    await pushCommand(repos, arg);
  }
}

export function registerRemoteCommands(context: vscode.ExtensionContext, repos: RepositoryManager | undefined): void {
  if (!repos) {
    return;
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('loreScm.push', (arg?: unknown) => pushCommand(repos, arg)),
    vscode.commands.registerCommand('loreScm.sync', (arg?: unknown) => syncCommand(repos, arg)),
    vscode.commands.registerCommand('loreScm.syncAndPush', (arg?: unknown) => syncAndPushCommand(repos, arg)),
    vscode.commands.registerCommand('loreScm.publishBranch', (arg?: unknown) => pushCommand(repos, arg)),
  );
}
