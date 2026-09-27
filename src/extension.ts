import * as vscode from 'vscode';

let outputChannel: vscode.LogOutputChannel | undefined;

function getOutputChannel(): vscode.LogOutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('Lore SCM', { log: true });
  return outputChannel;
}

/**
 * Loaded lazily so a missing or incompatible native library can never fail extension
 * activation itself (see PLAN.md §3.3 and §6.14 "Native crash protection").
 */
async function loadLoreLibraryVersion(): Promise<string> {
  if (process.env.LORE_LIB_PATH === undefined) {
    const libraryPath = vscode.workspace.getConfiguration('loreScm').get<string | null>('libraryPath');
    if (libraryPath) {
      process.env.LORE_LIB_PATH = libraryPath;
    }
  }
  const { lore } = await import('@lore-vcs/sdk');
  const version: unknown = lore.version();
  return String(version);
}

export function activate(context: vscode.ExtensionContext): void {
  const log = getOutputChannel();
  log.info('Lore SCM activating');

  context.subscriptions.push(log);

  context.subscriptions.push(
    vscode.commands.registerCommand('loreScm.showOutput', () => {
      log.show();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('loreScm.showVersion', () => {
      void (async () => {
        try {
          const version = await loadLoreLibraryVersion();
          log.info(`Lore library version: ${version}`);
          void vscode.window.showInformationMessage(`Lore library version: ${version}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error(`Failed to load the Lore library: ${message}`);
          void vscode.window
            .showErrorMessage(`Failed to load the Lore library: ${message}`, 'Show Log')
            .then((choice) => {
              if (choice === 'Show Log') {
                log.show();
              }
            });
        }
      })();
    }),
  );

  log.info('Lore SCM activated');
}

export function deactivate(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}
