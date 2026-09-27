import * as vscode from 'vscode';
import type { LogOutputChannel } from 'vscode';
import { getLogChannel, disposeLogChannel } from './log.js';
import { config } from './config.js';
import { createBackend } from './lore/backendFactory.js';
import type { LoreBackend } from './lore/backend.js';
import { RepositoryManager } from './repository/repositoryManager.js';
import { LoreFileSystemProvider } from './scm/loreFileSystemProvider.js';
import { LORE_SCM_SCHEME } from './scm/loreUri.js';
import { LoreDecorationProvider } from './scm/decorations.js';
import { LoreScmProvider } from './scm/scmProvider.js';
import { registerCommands } from './commands/index.js';

async function updateHasRepositoryContext(repos: RepositoryManager): Promise<void> {
  await vscode.commands.executeCommand('setContext', 'loreScm.hasRepository', repos.all.length > 0);
}

function activateRepositorySupport(
  context: vscode.ExtensionContext,
  backend: LoreBackend,
  log: LogOutputChannel,
): RepositoryManager {
  const repos = new RepositoryManager(backend, context.workspaceState, log);
  context.subscriptions.push(repos);

  const fileSystemProvider = new LoreFileSystemProvider(repos);
  context.subscriptions.push(
    fileSystemProvider,
    vscode.workspace.registerFileSystemProvider(LORE_SCM_SCHEME, fileSystemProvider, {
      isCaseSensitive: process.platform !== 'win32' && process.platform !== 'darwin',
      isReadonly: true,
    }),
  );

  const decorationProvider = new LoreDecorationProvider(repos);
  context.subscriptions.push(
    decorationProvider,
    vscode.window.registerFileDecorationProvider(decorationProvider),
  );

  const scmProviders = new Map<string, LoreScmProvider>();
  context.subscriptions.push(
    repos.onDidOpenRepository((repo) => {
      scmProviders.set(repo.root, new LoreScmProvider(repo));
      void updateHasRepositoryContext(repos);
    }),
    repos.onDidCloseRepository((repo) => {
      scmProviders.get(repo.root)?.dispose();
      scmProviders.delete(repo.root);
      void updateHasRepositoryContext(repos);
    }),
    { dispose: () => scmProviders.forEach((provider) => provider.dispose()) },
  );

  return repos;
}

async function loadBackend(log: LogOutputChannel): Promise<LoreBackend | undefined> {
  // The native library load can fail (missing platform package, incompatible LORE_LIB_PATH,
  // ...). Per PLAN.md §6.14/§10, that must never take down the whole extension: activate()
  // continues without repository support, but showVersion/showOutput still work for diagnosis.
  try {
    return await createBackend(config.backend, config.libraryPath, log);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Failed to load the Lore backend: ${message}`);
    void vscode.window
      .showErrorMessage(`Lore SCM: failed to load the Lore backend. ${message}`, 'Show Log')
      .then((choice) => {
        if (choice === 'Show Log') {
          log.show();
        }
      });
    return undefined;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = getLogChannel();
  log.info('Lore SCM activating');
  context.subscriptions.push({ dispose: disposeLogChannel });

  if (!config.enabled) {
    log.info('loreScm.enabled is false; not activating repository support');
    registerCommands(context, undefined, undefined, log);
    return;
  }

  const backend = await loadBackend(log);
  const repos = backend ? activateRepositorySupport(context, backend, log) : undefined;
  if (repos) {
    await repos.scan();
  }

  registerCommands(context, repos, backend, log);

  log.info('Lore SCM activated');
}

export function deactivate(): void {
  disposeLogChannel();
}
