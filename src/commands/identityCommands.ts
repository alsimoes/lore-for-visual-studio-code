import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { parse, stringify } from 'smol-toml';
import type { RepositoryManager } from '../repository/repositoryManager.js';
import { resolveRepository } from './commandUtils.js';

/**
 * The only file this extension ever writes outside of Lore's own SDK calls, and only the
 * `identity` key within it, after an explicit user action (§6.16). Never touches user-level Lore
 * config or any other key.
 */
async function setIdentity(root: string, identity: string): Promise<void> {
  const configPath = join(root, '.lore', 'config.toml');
  const raw = await readFile(configPath, 'utf8');
  const parsed = parse(raw) as Record<string, unknown>;
  parsed.identity = identity;
  await writeFile(configPath, stringify(parsed), 'utf8');
}

async function setIdentityCommand(repos: RepositoryManager, arg: unknown): Promise<void> {
  const repo = resolveRepository(arg, repos) ?? repos.all[0];
  if (!repo) {
    return;
  }
  const identity = await vscode.window.showInputBox({
    prompt: 'Identity for Lore commits in this repository (usually your email)',
    placeHolder: 'you@example.com',
  });
  if (!identity) {
    return;
  }
  try {
    await setIdentity(repo.root, identity);
    void vscode.window.showInformationMessage(`Lore identity set to "${identity}".`);
    await repo.refresh();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Failed to set identity: ${message}`);
  }
}

export function registerIdentityCommands(context: vscode.ExtensionContext, repos: RepositoryManager | undefined): void {
  if (!repos) {
    return;
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('loreScm.setIdentity', (arg?: unknown) => setIdentityCommand(repos, arg)),
  );
}
