const targets = {
  'win32-x64': 'win32-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'darwin-arm64': 'darwin-arm64',
};

const key = `${process.platform}-${process.arch}`;
const target = targets[key];

if (!target) {
  process.stderr.write(
    `No @lore-vcs/sdk platform package is available for ${key}. ` +
      `Supported targets: ${Object.keys(targets).join(', ')}.\n`,
  );
  process.exit(1);
}

process.stdout.write(target);
