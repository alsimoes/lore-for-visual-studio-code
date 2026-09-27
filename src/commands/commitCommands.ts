import * as vscode from 'vscode';
import type { RepositoryManager } from '../repository/repositoryManager.js';
import type { Repository } from '../repository/repository.js';
import { config } from '../config.js';
import { LoreOperationError } from '../lore/errors.js';
import { resolveRepository, resolveResources } from './commandUtils.js';

export type InputBoxLookup = (repo: Repository) => vscode.SourceControlInputBox | undefined;

function relativePaths(resources: { change: { path: string } }[]): string[] {
  return resources.map((r) => r.change.path);
}

async function stageCommand(first: unknown, rest: unknown, repos: RepositoryManager): Promise<void> {
  const resolved = resolveResources(first, rest, repos);
  if (!resolved) {
    return;
  }
  await resolved.repo.stage(relativePaths(resolved.resources));
}

async function unstageCommand(first: unknown, rest: unknown, repos: RepositoryManager): Promise<void> {
  const resolved = resolveResources(first, rest, repos);
  if (!resolved) {
    return;
  }
  await resolved.repo.unstage(relativePaths(resolved.resources));
}

async function discardCommand(first: unknown, rest: unknown, repos: RepositoryManager): Promise<void> {
  const resolved = resolveResources(first, rest, repos);
  if (!resolved) {
    return;
  }
  const { repo, resources } = resolved;
  const label = resources.length === 1 ? resources[0].change.path : `${resources.length} files`;
  const confirmed = await vscode.window.showWarningMessage(
    `Discard changes in ${label}? This can't be undone.`,
    { modal: true },
    'Discard Changes',
  );
  if (confirmed !== 'Discard Changes') {
    return;
  }
  // An untracked (unstaged "added") file has no committed revision to reset to: purge deletes it.
  const untracked = resources.filter((r) => r.group === 'changes' && r.change.kind === 'added');
  const tracked = resources.filter((r) => !untracked.includes(r));
  if (untracked.length > 0) {
    await repo.discard(relativePaths(untracked), { purge: true });
  }
  if (tracked.length > 0) {
    await repo.discard(relativePaths(tracked));
  }
}

/** Re-stages files that are both staged and dirty, so a stale staged blob isn't committed (§6.2, §6.7). */
async function restageModifiedIfNeeded(repo: Repository): Promise<void> {
  if (!config.restageModifiedOnCommit) {
    return;
  }
  const staleStaged = (repo.status?.changes ?? []).filter((c) => c.staged && c.dirty).map((c) => c.path);
  if (staleStaged.length > 0) {
    await repo.stage(staleStaged);
  }
}

async function ensureSomethingStaged(repo: Repository): Promise<boolean> {
  const hasStaged = (repo.status?.changes ?? []).some((c) => c.staged);
  if (hasStaged) {
    return true;
  }
  if (config.enableSmartCommit) {
    await repo.stage((repo.status?.changes ?? []).map((c) => c.path));
    return true;
  }
  const choice = await vscode.window.showInformationMessage(
    'There are no staged changes. Stage all your changes and commit them directly?',
    'Yes',
    'Always',
    'Never',
    'Cancel',
  );
  if (choice === 'Cancel' || choice === undefined) {
    return false;
  }
  if (choice === 'Always' || choice === 'Never') {
    await vscode.workspace
      .getConfiguration('loreScm')
      .update('enableSmartCommit', choice === 'Always', vscode.ConfigurationTarget.Global);
  }
  if (choice === 'Never') {
    return false;
  }
  await repo.stage((repo.status?.changes ?? []).map((c) => c.path));
  return true;
}

async function runCommit(repo: Repository, message: string): Promise<void> {
  await restageModifiedIfNeeded(repo);
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.SourceControl, title: 'Committing…' },
    () => repo.commit(message),
  );
  void vscode.window.showInformationMessage(`Committed revision ${result.revisionNumber}.`);
  if (config.postCommitCommand === 'push') {
    await vscode.commands.executeCommand('loreScm.push');
  } else if (config.postCommitCommand === 'sync') {
    await vscode.commands.executeCommand('loreScm.sync');
  }
}

async function handleCommitError(err: unknown): Promise<void> {
  if (err instanceof LoreOperationError && err.errorName === 'MissingIdentity') {
    const choice = await vscode.window.showErrorMessage(
      'Lore needs an identity before it can commit.',
      'Set Identity…',
    );
    if (choice) {
      await vscode.commands.executeCommand('loreScm.setIdentity');
    }
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  void vscode.window.showErrorMessage(`Commit failed: ${message}`, 'Show Log').then((choice) => {
    if (choice) {
      void vscode.commands.executeCommand('loreScm.showOutput');
    }
  });
}

async function commitCommand(
  repos: RepositoryManager,
  getInputBox: InputBoxLookup,
  arg: unknown,
  opts: { stageAll?: boolean } = {},
): Promise<void> {
  const repo = resolveRepository(arg, repos) ?? repos.all[0];
  if (!repo) {
    return;
  }
  const inputBox = getInputBox(repo);
  let message = inputBox?.value ?? '';
  if (!message) {
    message = (await vscode.window.showInputBox({ prompt: 'Commit message' })) ?? '';
    if (!message) {
      return;
    }
  }
  if (opts.stageAll) {
    await repo.stage((repo.status?.changes ?? []).map((c) => c.path));
  } else if (!(await ensureSomethingStaged(repo))) {
    return;
  }
  try {
    await runCommit(repo, message);
    if (inputBox) {
      inputBox.value = '';
    }
  } catch (err) {
    await handleCommitError(err);
  }
}

async function commitAmendMessageCommand(repos: RepositoryManager, arg: unknown): Promise<void> {
  const repo = resolveRepository(arg, repos) ?? repos.all[0];
  if (!repo) {
    return;
  }
  const message = await vscode.window.showInputBox({
    prompt: 'New message for the last revision (this changes only the message, not its content)',
  });
  if (!message) {
    return;
  }
  try {
    await repo.amendMessage(message);
    void vscode.window.showInformationMessage('Revision message amended.');
  } catch (err) {
    await handleCommitError(err);
  }
}

export function registerCommitCommands(
  context: vscode.ExtensionContext,
  repos: RepositoryManager | undefined,
  getInputBox: InputBoxLookup,
): void {
  if (!repos) {
    return;
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('loreScm.stage', (first?: unknown, rest?: unknown) =>
      stageCommand(first, rest, repos),
    ),
    vscode.commands.registerCommand('loreScm.stageAll', (first?: unknown, rest?: unknown) =>
      stageCommand(first, rest, repos),
    ),
    vscode.commands.registerCommand('loreScm.unstage', (first?: unknown, rest?: unknown) =>
      unstageCommand(first, rest, repos),
    ),
    vscode.commands.registerCommand('loreScm.unstageAll', (first?: unknown, rest?: unknown) =>
      unstageCommand(first, rest, repos),
    ),
    vscode.commands.registerCommand('loreScm.discard', (first?: unknown, rest?: unknown) =>
      discardCommand(first, rest, repos),
    ),
    vscode.commands.registerCommand('loreScm.discardAll', (first?: unknown, rest?: unknown) =>
      discardCommand(first, rest, repos),
    ),
    vscode.commands.registerCommand('loreScm.commit', (arg?: unknown) => commitCommand(repos, getInputBox, arg)),
    vscode.commands.registerCommand('loreScm.commitStaged', (arg?: unknown) =>
      commitCommand(repos, getInputBox, arg),
    ),
    vscode.commands.registerCommand('loreScm.commitAll', (arg?: unknown) =>
      commitCommand(repos, getInputBox, arg, { stageAll: true }),
    ),
    vscode.commands.registerCommand('loreScm.commitAmendMessage', (arg?: unknown) =>
      commitAmendMessageCommand(repos, arg),
    ),
  );
}
