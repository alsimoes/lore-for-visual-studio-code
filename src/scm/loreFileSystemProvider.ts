import { relative } from 'node:path';
import * as vscode from 'vscode';
import type { RepositoryManager } from '../repository/repositoryManager.js';
import type { Repository } from '../repository/repository.js';
import { fromLoreUri } from './loreUri.js';

const CACHE_CAPACITY_BYTES = 50 * 1024 * 1024;

/**
 * Content-addressed cache: entries are keyed by `hash:path`, so a cached entry never goes stale
 * (a given hash always maps to the same bytes) and is only ever evicted for space, LRU-style.
 */
class ContentCache {
  private readonly entries = new Map<string, Uint8Array>();
  private size = 0;

  get(key: string): Uint8Array | undefined {
    const value = this.entries.get(key);
    if (value) {
      // Refresh recency.
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  put(key: string, value: Uint8Array): void {
    this.entries.set(key, value);
    this.size += value.byteLength;
    while (this.size > CACHE_CAPACITY_BYTES && this.entries.size > 1) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.size -= oldest?.byteLength ?? 0;
    }
  }
}

/**
 * Read-only `lore-scm:` scheme backed by `fileWrite`. Registered as a FileSystemProvider (not a
 * TextDocumentContentProvider) so binary files, including images, open and diff correctly.
 */
export class LoreFileSystemProvider implements vscode.FileSystemProvider {
  private readonly cache = new ContentCache();
  private readonly onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

  constructor(private readonly repos: RepositoryManager) {}

  private findRepository(root: string): Repository {
    const repo = this.repos.all.find((r) => r.root === root);
    if (!repo) {
      throw vscode.FileSystemError.FileNotFound(`Lore repository not open: ${root}`);
    }
    return repo;
  }

  private resolveRef(repo: Repository, ref: string): string {
    if (ref === '~HEAD') {
      const revision = repo.status?.state.revision;
      if (!revision) {
        throw vscode.FileSystemError.Unavailable('No status available yet for this repository');
      }
      return revision;
    }
    return ref;
  }

  private async load(uri: vscode.Uri): Promise<Uint8Array> {
    const { root, ref, path } = fromLoreUri(uri);
    const repo = this.findRepository(root);
    const hash = this.resolveRef(repo, ref);
    const relativePath = relative(root, path).split('\\').join('/');
    const key = `${hash}:${relativePath}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const bytes = await repo.readFileAt(relativePath, hash);
    this.cache.put(key, bytes);
    return bytes;
  }

  watch(): vscode.Disposable {
    // No-op: content is content-addressed and immutable once fetched. Callers that need to
    // react to the repository's HEAD moving should listen to Repository.onDidChangeStatus
    // instead of expecting file-watch events on a `lore-scm:` URI.
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const bytes = await this.load(uri);
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.byteLength };
  }

  readDirectory(): [string, vscode.FileType][] {
    throw vscode.FileSystemError.FileNotADirectory();
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return this.load(uri);
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('The lore-scm: file system is read-only.');
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions('The lore-scm: file system is read-only.');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('The lore-scm: file system is read-only.');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('The lore-scm: file system is read-only.');
  }

  dispose(): void {
    this.onDidChangeFileEmitter.dispose();
  }
}
