import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  label: 'integrationTests',
  files: 'out/test/integration/**/*.test.js',
  workspaceFolder: 'test/fixtures/workspace',
  mocha: {
    timeout: 20000,
  },
});
