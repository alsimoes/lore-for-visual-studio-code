import * as assert from 'assert';
import * as vscode from 'vscode';

suite('extension', () => {
  test('activates and registers commands', async () => {
    const extension = vscode.extensions.getExtension('alsimoes.lore-scm');
    assert.ok(extension, 'extension not found');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('loreScm.showVersion'));
    assert.ok(commands.includes('loreScm.showOutput'));
  });
});
