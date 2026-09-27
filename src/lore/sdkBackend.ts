import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogOutputChannel } from 'vscode';
import type { LoreBackend } from './backend.js';
import type { CommitResult, StatusSnapshot, SyncResult } from './model.js';
import { mapCommitResult, mapStatusEvents, mapSyncResult, type LoreRawEvent } from './eventMapping.js';
import { toLoreOperationError } from './errors.js';

type BackendFnName =
  | 'repositoryStatus'
  | 'fileWrite'
  | 'fileDirty'
  | 'fileStage'
  | 'fileStageMove'
  | 'fileUnstage'
  | 'fileReset'
  | 'revisionCommit'
  | 'revisionAmend'
  | 'branchPush'
  | 'revisionSync';

// Minimal shape of the parts of @lore-vcs/sdk this backend calls. Kept local (rather than
// importing the package's own types) so this file states exactly what it depends on.
interface LoreFluentApi {
  collectAsync(): Promise<LoreRawEvent[]>;
}
type LoreSdk = {
  version(): unknown;
  shutdown(): unknown;
} & Record<BackendFnName, (globals: object, args: object) => LoreFluentApi>;

async function importSdk(libraryPath: string | undefined): Promise<LoreSdk> {
  if (libraryPath && !process.env.LORE_LIB_PATH) {
    process.env.LORE_LIB_PATH = libraryPath;
  }
  const mod = (await import('@lore-vcs/sdk')) as unknown as { lore: LoreSdk };
  return mod.lore;
}

export class SdkBackend implements LoreBackend {
  readonly kind = 'sdk' as const;

  private constructor(
    private readonly sdk: LoreSdk,
    private readonly log: LogOutputChannel,
  ) {}

  static async create(libraryPath: string | undefined, log: LogOutputChannel): Promise<SdkBackend> {
    const sdk = await importSdk(libraryPath);
    const version = await Promise.resolve(sdk.version());
    log.info(`Lore library version: ${String(version)}`);
    return new SdkBackend(sdk, log);
  }

  async version(): Promise<string> {
    return String(await Promise.resolve(this.sdk.version()));
  }

  async dispose(): Promise<void> {
    await Promise.resolve(this.sdk.shutdown());
  }

  private async run(root: string, fnName: BackendFnName, args: object): Promise<LoreRawEvent[]> {
    const correlationId = randomUUID();
    const globals = { repositoryPath: root, workingDirectory: root, correlationId };
    const started = Date.now();
    this.log.trace(`[${correlationId}] ${fnName} ${JSON.stringify(args)}`);
    try {
      const events = await this.sdk[fnName](globals, args).collectAsync();
      this.log.debug(`[${correlationId}] ${fnName} ${Date.now() - started}ms`);
      return events;
    } catch (err) {
      this.log.debug(`[${correlationId}] ${fnName} failed after ${Date.now() - started}ms`);
      throw toLoreOperationError(err, fnName, correlationId);
    }
  }

  async status(root: string, opts?: { scan?: boolean; checkDirty?: boolean }): Promise<StatusSnapshot> {
    const events = await this.run(root, 'repositoryStatus', {
      scan: opts?.scan ?? false,
      checkDirty: opts?.checkDirty ?? false,
      // `staged: true` is always required, not just when the caller wants staged info: a
      // no-scan status call in the SAME process that marked a file dirty (via fileDirty or
      // fileStage) reports ZERO file events without it - the dirty flag is genuinely persisted
      // (a fresh process/CLI invocation sees it immediately), but this process's own
      // in-memory status cache isn't invalidated for the fast path unless `staged` is set. See
      // docs/spike-findings.md, Phase 2 addendum, for the full investigation.
      staged: true,
    });
    return mapStatusEvents(events);
  }

  async readFileAt(root: string, path: string, revision: string): Promise<Uint8Array> {
    const dir = join(tmpdir(), 'lore-vscode');
    await mkdir(dir, { recursive: true });
    const output = join(dir, randomUUID());
    try {
      await this.run(root, 'fileWrite', { path, revision, output });
      return await readFile(output);
    } catch (err) {
      // A file that doesn't exist at this revision (e.g. it was added later) reads as empty,
      // per PLAN.md §6.6, rather than surfacing an error to the diff/FS provider.
      if (err && typeof err === 'object' && 'category' in err && err.category === 'notFound') {
        return new Uint8Array();
      }
      throw err;
    } finally {
      await rm(output, { force: true });
    }
  }

  async markDirty(root: string, paths: string[]): Promise<void> {
    await this.run(root, 'fileDirty', { paths });
  }

  async stage(root: string, paths: string[], opts?: { scan?: boolean }): Promise<void> {
    await this.run(root, 'fileStage', { paths, scan: opts?.scan ?? false });
  }

  async stageMove(root: string, fromPath: string, toPath: string): Promise<void> {
    await this.run(root, 'fileStageMove', { fromPath, toPath });
  }

  async unstage(root: string, paths: string[]): Promise<void> {
    await this.run(root, 'fileUnstage', { paths });
  }

  async reset(root: string, paths: string[], opts?: { purge?: boolean; revision?: string }): Promise<void> {
    await this.run(root, 'fileReset', { paths, purge: opts?.purge ?? false, revision: opts?.revision });
  }

  async commit(root: string, message: string): Promise<CommitResult> {
    const events = await this.run(root, 'revisionCommit', { message });
    return mapCommitResult(events);
  }

  async amendMessage(root: string, message: string): Promise<void> {
    await this.run(root, 'revisionAmend', { message });
  }

  async push(root: string, opts?: { fastForwardMerge?: boolean }): Promise<void> {
    await this.run(root, 'branchPush', { fastForwardMerge: opts?.fastForwardMerge ?? false });
  }

  async sync(root: string, opts?: { revision?: string; reset?: boolean }): Promise<SyncResult> {
    const events = await this.run(root, 'revisionSync', { revision: opts?.revision, reset: opts?.reset ?? false });
    return mapSyncResult(events);
  }
}
