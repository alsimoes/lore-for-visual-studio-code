import * as vscode from 'vscode';
import type { LogOutputChannel } from 'vscode';
import type { LoreBackend } from '../lore/backend.js';
import type { RepositoryManager } from '../repository/repositoryManager.js';
import { registerRepoCommands } from './repoCommands.js';
import { registerScmCommands } from './scmCommands.js';
import { registerCommitCommands, type InputBoxLookup } from './commitCommands.js';
import { registerRemoteCommands } from './remoteCommands.js';
import { registerIdentityCommands } from './identityCommands.js';

export function registerCommands(
  context: vscode.ExtensionContext,
  repos: RepositoryManager | undefined,
  backend: LoreBackend | undefined,
  log: LogOutputChannel,
  getInputBox: InputBoxLookup,
): void {
  registerRepoCommands(context, backend, log);
  registerScmCommands(context, repos);
  registerCommitCommands(context, repos, getInputBox);
  registerRemoteCommands(context, repos);
  registerIdentityCommands(context, repos);
}
