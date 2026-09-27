import * as vscode from 'vscode';
import type { LogOutputChannel } from 'vscode';
import type { LoreBackend } from '../lore/backend.js';

export function registerRepoCommands(
  context: vscode.ExtensionContext,
  backend: LoreBackend | undefined,
  log: LogOutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('loreScm.showOutput', () => {
      log.show();
    }),
    vscode.commands.registerCommand('loreScm.showVersion', async () => {
      if (!backend) {
        void vscode.window.showErrorMessage(
          'The Lore backend failed to load. See "Show Log" in the output channel.',
        );
        return;
      }
      try {
        const version = await backend.version();
        log.info(`Lore library version: ${version}`);
        void vscode.window.showInformationMessage(`Lore library version: ${version}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`Failed to get the Lore library version: ${message}`);
        void vscode.window
          .showErrorMessage(`Failed to get the Lore library version: ${message}`, 'Show Log')
          .then((choice) => {
            if (choice === 'Show Log') {
              log.show();
            }
          });
      }
    }),
  );
}
