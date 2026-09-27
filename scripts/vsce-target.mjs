const TARGETS = {
  'win32-x64': 'win32-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'darwin-arm64': 'darwin-arm64',
};

/** Maps the running process's platform/arch to a vsce target, or throws if there's no match. */
export function getVsceTarget() {
  const key = `${process.platform}-${process.arch}`;
  const target = TARGETS[key];
  if (!target) {
    throw new Error(
      `No @lore-vcs/sdk platform package is available for ${key}. ` +
        `Supported targets: ${Object.keys(TARGETS).join(', ')}.`,
    );
  }
  return target;
}
