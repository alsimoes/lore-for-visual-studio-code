import * as vscode from 'vscode';
import type { LogOutputChannel } from 'vscode';
import type { LoreBackend } from '../lore/backend.js';
import type { RepositoryManager } from '../repository/repositoryManager.js';
import { registerRepoCommands } from './repoCommands.js';
import { registerScmCommands } from './scmCommands.js';

export function registerCommands(
  context: vscode.ExtensionContext,
  repos: RepositoryManager | undefined,
  backend: LoreBackend | undefined,
  log: LogOutputChannel,
): void {
  registerRepoCommands(context, backend, log);
  registerScmCommands(context, repos);
}
