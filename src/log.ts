import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

export function getLogChannel(): vscode.LogOutputChannel {
  channel ??= vscode.window.createOutputChannel('Lore SCM', { log: true });
  return channel;
}

export function disposeLogChannel(): void {
  channel?.dispose();
  channel = undefined;
}
