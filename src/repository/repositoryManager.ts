import { access, readdir, realpath } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import * as vscode from 'vscode';
import type { LogOutputChannel, Memento } from 'vscode';
import type { LoreBackend } from '../lore/backend.js';
import { config } from '../config.js';
import { Repository } from './repository.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isLoreWorkingTree(dir: string): Promise<boolean> {
  return exists(join(dir, '.lore', 'config.toml'));
}

/** Walks up from `startDir` to the filesystem root, stopping at the first Lore working tree. */
async function findRepoRootUpward(startDir: string): Promise<string | undefined> {
  let dir = startDir;
  for (;;) {
    if (await isLoreWorkingTree(dir)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** Walks down from `rootDir` up to `maxDepth` levels, looking for nested working trees. */
async function findRepoRootsDownward(
  rootDir: string,
  maxDepth: number,
  ignoredFolders: readonly string[],
): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.lore' || ignoredFolders.includes(entry.name)) {
        continue;
      }
      const childDir = join(dir, entry.name);
      if (await isLoreWorkingTree(childDir)) {
        found.push(childDir);
        // Don't descend into a repository we already found, to avoid picking up its own
        // nested working trees as if they belonged to the parent scan.
        continue;
      }
      await walk(childDir, depth + 1);
    }
  }
  await walk(rootDir, 1);
  return found;
}

function normalizeKey(root: string): string {
  const normalized = root.replace(/[/\\]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

const LAST_SCAN_MS_PREFIX = 'loreScm.lastScanMs.';
const FOCUS_REFRESH_MIN_AGE_MS = 5000;

export class RepositoryManager implements vscode.Disposable {
  private readonly repositories = new Map<string, Repository>();
  private readonly onDidOpenRepositoryEmitter = new vscode.EventEmitter<Repository>();
  readonly onDidOpenRepository = this.onDidOpenRepositoryEmitter.event;
  private readonly onDidCloseRepositoryEmitter = new vscode.EventEmitter<Repository>();
  readonly onDidCloseRepository = this.onDidCloseRepositoryEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly backend: LoreBackend,
    private readonly workspaceState: Memento,
    private readonly log: LogOutputChannel,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.scan()),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.refreshStaleOnFocus();
        }
      }),
    );
  }

  /** On window focus, refresh any repository whose last refresh is older than 5s (§6.4). */
  private refreshStaleOnFocus(): void {
    if (!config.autorefresh) {
      return;
    }
    const now = Date.now();
    for (const repo of this.repositories.values()) {
      if (now - repo.lastRefreshedAt >= FOCUS_REFRESH_MIN_AGE_MS) {
        void repo.refresh();
      }
    }
  }

  get all(): Repository[] {
    return [...this.repositories.values()];
  }

  getRepositoryForUri(uri: vscode.Uri): Repository | undefined {
    if (uri.scheme !== 'file') {
      return undefined;
    }
    let best: Repository | undefined;
    for (const repo of this.repositories.values()) {
      if (uri.fsPath === repo.root || uri.fsPath.startsWith(repo.root + sep)) {
        if (!best || repo.root.length > best.root.length) {
          best = repo;
        }
      }
    }
    return best;
  }

  /** Discovers Lore working trees per PLAN.md §6.1 and opens any not already open. */
  async scan(): Promise<void> {
    if (!config.enabled) {
      return;
    }
    const detection = config.autoRepositoryDetection;
    if (detection === false) {
      return;
    }

    const roots = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const upRoot = await findRepoRootUpward(folder.uri.fsPath);
      if (upRoot) {
        roots.add(upRoot);
      }
      // "true", "subFolders" and "openEditors" all enable the bounded down-scan for now; a
      // narrower openEditors-only mode (tracking active editors instead of scanning) is a
      // possible future refinement, not required by Phase 1's acceptance criteria.
      const nested = await findRepoRootsDownward(
        folder.uri.fsPath,
        config.repositoryScanMaxDepth,
        config.repositoryScanIgnoredFolders,
      );
      for (const root of nested) {
        roots.add(root);
      }
    }

    const openKeys = new Set(this.repositories.keys());
    for (const root of roots) {
      const canonical = await realpath(root).catch(() => root);
      const key = normalizeKey(canonical);
      openKeys.delete(key);
      if (!this.repositories.has(key)) {
        await this.open(canonical, key);
      }
    }
    for (const staleKey of openKeys) {
      this.close(staleKey);
    }
  }

  private shouldScanOnOpen(key: string): boolean {
    const setting = config.scanOnOpen;
    if (setting === 'always') {
      return true;
    }
    if (setting === 'never') {
      return false;
    }
    const lastMs = this.workspaceState.get<number>(LAST_SCAN_MS_PREFIX + key);
    return lastMs === undefined || lastMs <= config.scanSlowThresholdMs;
  }

  private async open(root: string, key: string): Promise<void> {
    const repo = new Repository(root, this.backend, this.log);
    this.repositories.set(key, repo);
    this.log.info(`Opened Lore repository at ${root}`);
    this.onDidOpenRepositoryEmitter.fire(repo);

    const scan = this.shouldScanOnOpen(key);
    const started = Date.now();
    await repo.refresh({ scan });
    if (scan) {
      await this.workspaceState.update(LAST_SCAN_MS_PREFIX + key, Date.now() - started);
    }
  }

  private close(key: string): void {
    const repo = this.repositories.get(key);
    if (!repo) {
      return;
    }
    this.repositories.delete(key);
    repo.dispose();
    this.onDidCloseRepositoryEmitter.fire(repo);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    for (const repo of this.repositories.values()) {
      repo.dispose();
    }
    this.repositories.clear();
    this.onDidOpenRepositoryEmitter.dispose();
    this.onDidCloseRepositoryEmitter.dispose();
  }
}
