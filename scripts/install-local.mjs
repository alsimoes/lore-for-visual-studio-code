import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const outDir = 'dist-vsix';

execFileSync('npm', ['run', 'package:local'], { stdio: 'inherit', shell: true });

const vsixFiles = readdirSync(outDir)
  .filter((f) => f.endsWith('.vsix'))
  .map((f) => ({ name: f, path: join(outDir, f), mtime: statSync(join(outDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (vsixFiles.length === 0) {
  console.error(`No .vsix file found in ${outDir}/ after packaging.`);
  process.exit(1);
}

const vsix = vsixFiles[0];
console.log(`Installing ${vsix.name}...`);

try {
  execFileSync('code', ['--install-extension', vsix.path, '--force'], { stdio: 'inherit', shell: true });
} catch {
  console.error(
    "Failed to run 'code'. Make sure the VS Code 'code' command is on your PATH " +
      "(Command Palette > Shell Command: Install 'code' command in PATH), then retry.",
  );
  process.exit(1);
}

console.log('Installed. Run "Developer: Reload Window" in VS Code to pick up the update.');
