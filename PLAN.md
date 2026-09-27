# Lore for Visual Studio Code — Development Plan

> **Audience:** an autonomous coding agent (Claude Sonnet 5) implementing this extension from an empty
> repository, plus the human maintainer reviewing its work.
> **Goal:** a VS Code extension that makes [Lore](https://epicgames.github.io/lore/), Epic Games' open-source
> version control system, feel as native in VS Code as the built-in Git integration does.
> **Research snapshot:** 2026-09-27. Lore CLI `0.10.1-nightly`, JS SDK `@lore-vcs/sdk@0.10.0`
> (npm), Lore repo commit `a0286e9`, lore-js commit `72e0cf6`. Lore is **pre-1.0**, so verify every API
> detail below against the installed SDK before relying on it (see §7, Phase 0).

### Decisions already made by the maintainer

| Item | Value |
|---|---|
| Extension ID | **`alsimoes.lore-scm`** (`package.json`: `"publisher": "alsimoes"`, `"name": "lore-scm"`) |
| Display name | **Lore SCM (Community)** |
| Description | "Unofficial, community-maintained source control integration for the Lore version control system. Not affiliated with or endorsed by Epic Games." |
| Identifier prefix | **`loreScm`** for all commands, settings, views, context keys and colors (for example `loreScm.commit`, `loreScm.backend`, `loreScm.history`, `loreScmDecoration.*`). The SCM provider id is `loreScm`. The virtual URI scheme is `lore-scm:` |
| User-visible labels | SCM provider label "Lore". Output channel "Lore SCM". Command category "Lore SCM" |
| Icon and branding | Original artwork only. **Don't** use the Lore or Epic logos, and don't imply official status |
| Distribution (for now) | **Local install only**: the maintainer builds a `.vsix` and installs it into their own VS Code (§9.1). Nothing is published. Publishing (Open VSX first, then the VS Code Marketplace) is deferred to future releases, after a period of real use (§9.2) |
| Official Epic plugin | When it ships, the maintainer decides whether to discontinue or keep this project. Until then, keep every identifier distinct so both extensions can be installed side by side |
| Target platform (for now) | **Windows x64 only** (`win32-x64`). Other platforms (linux-x64, linux-arm64, darwin-arm64, and a CLI-only universal build) are added when publishing starts (§9.2). Keep the code platform-neutral (use `path`, no hard-coded separators, case-insensitive path handling only on Windows) so adding them later is packaging work, not a rewrite |
| Lore server | A **local server on the maintainer's machine**. Tests use a throwaway zero-config server. Daily use (dogfooding) uses a persistent local server (§7 Phase 0, task 2) |
| Lore version | The maintainer has `lore 0.10.0` installed at `C:\Users\andre\bin\lore.exe`, which matches the pinned SDK `@lore-vcs/sdk@0.10.0`. Keep the CLI, the server and the SDK on the same minor version |
| License | **MIT** (same as Lore and the Lore JS SDK). Add `LICENSE` in Phase 0 |
| Git workflow | **One PR per phase into `main`** (§9.3). The agent never merges its own PRs |

Why these values: an Epic extension would likely use an `epicgames` publisher and `lore.*` identifiers.
Open VSX already has an unrelated extension with the display name "Lore" (`lore-ai.lore-cursor-extension`).
The `alsimoes` namespace was free on Open VSX on 2026-09-27. The `loreScm` prefix and the `lore-scm:`
scheme also avoid runtime collisions: VS Code rejects a second `FileSystemProvider` registered for the same
scheme, and duplicate command IDs would conflict.

---

## Table of contents

1. [How to use this document](#1-how-to-use-this-document)
2. [Lore in one page (for someone who knows Git)](#2-lore-in-one-page-for-someone-who-knows-git)
3. [Integration strategy: SDK vs CLI](#3-integration-strategy-sdk-vs-cli)
4. [Architecture](#4-architecture)
5. [Feature parity matrix (Git → Lore)](#5-feature-parity-matrix-git--lore)
6. [Detailed designs](#6-detailed-designs)
7. [Phased delivery plan](#7-phased-delivery-plan)
8. [Testing strategy](#8-testing-strategy)
9. [Build, packaging, CI, release](#9-build-packaging-ci-release)
10. [Risks and open decisions](#10-risks-and-open-decisions)
11. [Rules for the implementing agent](#11-rules-for-the-implementing-agent)
12. [References](#12-references)

---

## 1. How to use this document

- Work **phase by phase** (§7). Each phase ends with acceptance criteria. Don't start a phase until the
  previous one's criteria pass.
- **Phase 0 is mandatory.** It checks the assumptions this plan makes about Lore's behavior. Record the
  results in `docs/spike-findings.md`. When a finding contradicts this plan, the finding wins: update the
  design, and note the change in `docs/spike-findings.md`.
- The source of truth for API names and shapes is the installed SDK's type declarations:
  - `node_modules/@lore-vcs/sdk/dist/index.d.ts`: every function, with a doc comment listing the events
    it emits.
  - `node_modules/@lore-vcs/sdk/dist/types/args/index.d.ts`: argument interfaces.
  - `node_modules/@lore-vcs/sdk/dist/types/events/index.d.ts`: event payload interfaces.
  - `node_modules/@lore-vcs/sdk/dist/types/enums/index.d.ts`: `LoreEventTag`, `LoreFileAction`, and the
    other enums.
  Read these before you write a backend call. Never invent a field name.
- The sketches in this document are illustrative TypeScript. Adapt them; don't paste them in blindly.

---

## 2. Lore in one page (for someone who knows Git)

| Concept | Lore | Closest Git analogue | Notes for the extension |
|---|---|---|---|
| Model | **Centralized**, content-addressed Merkle tree, immutable revision chain | Distributed DAG | Commit and stage work **offline**. Push and sync need the server. |
| Working tree marker | `.lore/` directory at the working tree root. Holds `.lore/config.toml` (`remote_url`, `identity`, `[store]`, `[file]`) | `.git/` | Use `.lore/config.toml` to detect a repository. Never show `.lore/**` as a change. |
| Instance | One working tree (checkout) of a repository. The same repository can have many instances on one machine | worktree | |
| Remote URL | `lore://host:41337/<repo-name>` (QUIC/gRPC on 41337, HTTP health on 41339) | `origin` URL | Only one remote per working tree. Changing it is unsafe. |
| Revision | Identified by a **hash signature** (hex) **and** a sequential **revision number** | commit SHA | Revision specs: full hash, `[branch]@<number>`, `[branch]@LATEST`, `<branch>@<hash>` |
| Branch | Lightweight mutable reference. Has a name, an ID (hex), a category, a creator, a parent branch and a branch point. Branches can be **archived** and **protected** | branch | Local latest and remote latest are tracked separately. |
| Dirty flag | Marks "this file differs from the committed revision". **`lore status` doesn't scan the disk by default**: it reports only files already marked dirty. `lore dirty <paths>` marks files cheaply. `--scan` walks the filesystem and persists the flags | (Git always stats the index) | **This is the key integration point.** The extension must tell Lore which files changed (§6.3). |
| Stage | Records intent to include a change in the next revision. `lore stage` covers add, modify and delete. `lore stage move` records a rename | `git add` | Staging a directory stages only its **dirty** files, unless you pass `--scan`. |
| Commit | `lore commit "<msg>"` commits the staged state. It stays local until `lore push` | `git commit` | `lore revision amend` changes the last commit's **message** only. |
| Push | `lore push` / `branch push`. Rejected if the remote branch moved. `--fast-forward-merge` lets the server fast-forward | `git push` | |
| Sync | `lore sync [revision]` pulls to the remote latest (or a given revision). Diverged local work is **auto-merged** | `git pull` | Can produce conflicts. |
| Merge | `lore branch merge <source>` merges the source into the current branch. Subcommands: `start`, `resolve [mine|theirs]`, `unresolve`, `restart`, `abort`, `into` | `git merge` | Cherry-pick and revert have the same resolve, abort and restart flow. |
| Reset / discard | `lore reset <paths>` (`file reset`), with `--purge` to delete untracked files and `--revision` | `git restore` | |
| Locks | `lore lock acquire|status|query|release`. Per branch, per path. **Today they inform rather than enforce** | Git LFS locks | Important for binary assets in game development. |
| Ignore | `.loreignore` (outbound filter: never staged or committed) | `.gitignore` | During `repositoryStatus`, ignored paths are reported by `LORE_EVENT_FILTER_EXCLUDE` (`tagName: "filterExclude"`), not `PATH_IGNORE` (verified in Phase 0, spike S2; `docs/spike-findings.md`). |
| View | `.lore/view`: sparse inbound filter (which subset is on disk) | sparse checkout | Files outside the view aren't on disk. Don't report them as deleted. |
| Links and layers | Compose other repositories into subtrees (pinned links, overlaid layers) | submodules | Out of scope until Phase 6 (read-only display). |
| Shared store | A per-machine store deduplicated across working trees | alternates | Transparent to the extension. |
| Metadata | Key/value pairs on repositories, branches, revisions and files. A revision's reserved keys include `message`, `timestamp`, `created-by`, `committed-by`, `merged-by`, `branch`, `cherry-picked-from`, `reverted-from`, `restored-from` | commit headers and trailers | The commit message and author come from **metadata events**. |
| Auth | `lore auth login` (browser OAuth flow; emits an `AUTH_URL` event), token login, `logout`, `info` | credential helper | A demo server runs with auth disabled. |
| Notifications | `notification subscribe` streams server push events: branch created, deleted or pushed; resource locked or unlocked | none | Lets the extension refresh live. |
| Background service | Optional per-user daemon that runs commands (`lore service …`, user `config.toml [service]`) | fsmonitor | **The extension must not change the user's service settings** (§6.16). |

**Epic's own position:** the Lore roadmap lists a "VS Code plugin" as *in progress (2026)*. ADR-00009 says
the JS bindings were created because "the first application that needs this is the Visual Studio Code
plugin". Both statements confirm the intended integration path, and they mean an official extension may
appear later (§10).

---

## 3. Integration strategy: SDK vs CLI

### 3.1 Options evaluated

| Option | Description | Verdict |
|---|---|---|
| **A. `@lore-vcs/sdk` (in-process FFI)** | Official JS/TS SDK, published on npm (`0.10.0`). It loads the Lore C library (`lorelib-*.dll/.so/.dylib`) through **koffi**. The library ships in platform packages `@lore-vcs/sdk-amd64-unknown-windows`, `-amd64-unknown-linux`, `-arm64-apple-darwin` and `-arm64-graviton-linux`. The TypeScript types for args, events and enums are generated. Calls are async and stream typed events | **Primary** |
| **B. `lore` CLI with hidden `--json` flag** | `lore --json <command>` prints one JSON event per line (`{"tagName":"repositoryStatusFile","data":{…}}`). This is the same event model the SDK uses: the CLI is built on the same library. `parseLoreEventJSON()` turns these lines into typed `LoreEvent` objects, but is exported from the subpath `@lore-vcs/sdk/types/events`, not the package root (verified in Phase 0, spike S4). It normalizes string enums (e.g. `"action":"add"` → `1`) but does **not** convert the CLI's numeric 0/1 booleans on revision-status fields (e.g. `isLocalAhead`) to real JS booleans — `CliBackend`'s mapping must do that coercion itself. The flag is **hidden**, so it's not a documented contract | **Fallback backend**, behind the same interface |
| C. Parse human CLI output | Brittle. ADR-00009 explicitly rejects it | Rejected |

### 3.2 Decision

1. Define a **`LoreBackend` interface** in terms of the extension's own domain types (§4.3). Nothing above
   the backend layer may import from `@lore-vcs/sdk`.
2. Implement **`SdkBackend`** first. Implement **`CliBackend`** (spawn `lore --json …` and parse each line
   with `parseLoreEventJSON`) in Phase 6, or earlier if Phase 0 shows the SDK can't load in the extension
   host.
3. Add a setting `loreScm.backend`: `"auto" | "sdk" | "cli"`, default `"auto"`. `auto` tries the SDK and
   falls back to the CLI.

### 3.3 SDK facts the implementation depends on (verified in SDK 0.10.0)

- **Fluent API:** `lore.<fn>(globals: LoreGlobalArgs, args: Lore<Fn>Args)` returns a `LoreFluentApi` with
  these methods:
  - `.callback(cb)`: called once per event. The event object is backed by native memory that is **freed
    when the callback returns**. Read `event.data` only inside the callback, or call `event.clone()` to
    keep it.
  - `.filterByType(...tags)`, `.userContext(n)`, `.stringDecodeMode(mode)`.
  - `.waitAsync(): Promise<number>`: rejects with `LoreError` (fields `returnCode` and `errorDetail`) when
    the status isn't 0.
  - `.collectAsync(): Promise<LoreEvent[]>`: returns JS-owned events and throws `LoreError` on failure.
  - `.asyncIter()`: an async generator.
- Every function emits `LOG`, sometimes `ERROR` (non-fatal), then `COMPLETE` (`status`, plus
  `error: { errorCode, message, traceLocations }`), then `END`.
- **Library loading happens at import time.** `@lore-vcs/sdk/dist/functions/ffi.js` calls `koffi.load()`
  at module top level, using `process.env.LORE_LIB_PATH` or the platform package. So:
  - Import the SDK **lazily** (`await import('@lore-vcs/sdk')`) inside a `try/catch`, never at the top of
    a module.
  - Support a setting `loreScm.libraryPath`. Assign it to `process.env.LORE_LIB_PATH` **before** the first
    import.
  - `lore.version()` reports the library version. Log it at startup.
- **Supported platforms:** win32-x64, linux-x64, linux-arm64, darwin-arm64. There are **no** win32-arm64
  or darwin-x64 builds. On those platforms, use the CLI backend if a `lore` binary exists; otherwise show
  an "unsupported platform" message.
- **Useful global args** (`LoreGlobalArgs`): `repositoryPath`, `workingDirectory`, `correlationId`,
  `offline`, `local`, `remote`, `dryRun`, `force`, `identity`, `storeKeepAlive` and
  `storeKeepAliveSeconds` (avoid reopening the store for consecutive calls in one process),
  `eventIntervalMs` (progress cadence), `noGc`.
- **Global functions:** `lore.logConfigure({file, filePath, level})`,
  `lore.globalCallback(LoreEventTag.LOG, cb)`, `lore.shutdown()` (call it in `deactivate`),
  `lore.setThreadLimit(n)`.
- **No cancellation API was found.** Long operations (clone, sync, push) can't be cancelled. Show their
  progress as non-cancellable. **Confirmed in Phase 0 (spike S12)**: no `cancel`/`abort`/`AbortSignal`
  API exists in the SDK's type surface outside the domain-specific merge/revert/cherry-pick "abort",
  which aborts merge *state*, not a running call.
- **Functions missing from the SDK** (CLI only): cherry-pick, bisect, `branch latest list`,
  `shared-store list`, `completions`, `logfile`. Leave them out, or route them to the CLI backend.

### 3.4 Key SDK functions, by feature

| Feature | SDK function(s) | Key events |
|---|---|---|
| Status | `repositoryStatus({ scan?, checkDirty?, staged?, paths?, revisionOnly?, count? })` | `REPOSITORY_STATUS_REVISION`, `REPOSITORY_STATUS_FILE`, `REPOSITORY_STATUS_SUMMARY`, `PATH_IGNORE` |
| Mark changed | `fileDirty({paths})`, `fileDirtyMove({fromPath,toPath})`, `fileDirtyCopy` | none |
| Stage / unstage | `fileStage({paths, scan?})`, `fileStageMove({fromPath,toPath})`, `fileUnstage({paths})` | `FILE_STAGE_*`, `FILE_UNSTAGE_*` |
| Discard | `fileReset({paths, revision?, purge?})`, `fileResetToLastMerged` | `FILE_RESET_*` |
| Commit | `revisionCommit({message})`, `revisionAmend({message})` | `REVISION_COMMIT_*` (`REVISION_COMMIT_REVISION` holds the new hash and number) |
| Push | `branchPush({branch?, fastForwardMerge?})` | `BRANCH_PUSH_*` |
| Sync | `revisionSync({revision?, reset?, forwardChanges?})` | `REVISION_SYNC_TARGET`, `REVISION_SYNC_FILE`, `REVISION_SYNC_PROGRESS`, `REVISION_SYNC_REVISION`, `BRANCH_MERGE_CONFLICT_FILE` |
| File content at a revision | `fileWrite({path, revision, output})` (writes to a temp file) | `FILE_WRITE` |
| Diff | `fileDiff({paths, sourceRevision?, targetRevision?, diff3?, contextLines?})` (unified patch text); `revisionDiff({revisionSource, revisionTarget?, paths?})` (list of changed files with old and new addresses) | `FILE_DIFF`, `REVISION_DIFF_FILE` |
| History | `revisionHistory({revision?, branch?, length?, onlyBranch?})`, `revisionInfo({revision, delta?, metadata?})`, `fileHistory({path, length?, branch?})` | `REVISION_HISTORY`, `REVISION_HISTORY_ENTRY` followed by `METADATA` events; `FILE_HISTORY` |
| Branches | `branchList({archived?})`, `branchInfo`, `branchCreate({branch})`, `branchSwitch({branch, revision?, reset?})`, `branchArchive`, `branchProtect` / `branchUnprotect`, `branchDiff` | `BRANCH_LIST_ENTRY` (`name`, `id`, `latest`, `isCurrent`, `archived`, `creator`, `created`) |
| Merge | `branchMergeStart({branch, message?, noCommit?})`, `branchMergeResolve({paths})`, `branchMergeResolveMine`, `branchMergeResolveTheirs`, `branchMergeUnresolve`, `branchMergeRestart`, `branchMergeAbort`, `branchMergeInto` | `BRANCH_MERGE_START_*`, `BRANCH_MERGE_CONFLICT_FILE` |
| Revert | `revisionRevert({revision, message?, noCommit?})` and its `Resolve`, `ResolveMine`, `ResolveTheirs`, `Unresolve`, `Restart`, `Abort` variants | `REVERT_*` |
| Locks | `lockFileAcquire({paths, branch?})`, `lockFileRelease({paths, branch?, owner?})`, `lockFileStatus({paths, branch?})`, `lockFileQuery({branch?, owner?, path?})` | `LOCK_FILE_STATUS` / `LOCK_FILE_QUERY` (`path`, `owner`, `lockedAt`, `branch`) |
| Notifications | `notificationSubscribe({})`, `notificationUnsubscribe({})` | `NOTIFICATION_BRANCH_PUSHED` (`revision`, `revisionNumber`, `branch`, `userId`), `NOTIFICATION_BRANCH_CREATED` / `DELETED`, `NOTIFICATION_RESOURCE_LOCKED` / `UNLOCKED` (`userId`, `branch`, `paths`) |
| Auth | `authLoginInteractive({remoteUrl, noBrowser})`, `authLoginWithToken`, `authLogout`, `authList`, `authLocalUserInfo`, `authUserInfo({userIds})` | `AUTH_URL` (`url`), `AUTH_USER_INFO` (`id`, `name`), `AUTH_IDENTITY` |
| Repository | `repositoryCreate({repositoryUrl})` (with `offline: true`, the URL is just a name), `repositoryClone({repositoryUrl, revision?, view?, useSharedStore?})`, `repositoryInfo`, `repositoryConfigGet` | `REPOSITORY_CREATE`, `REPOSITORY_CLONE_BEGIN` / `PROGRESS` / `END` |

`LoreFileAction` has these values: `KEEP=0`, `ADD=1`, `DELETE=2`, `MOVE=3`, `COPY=4`. **Confirmed in
Phase 0 (spike S2): `KEEP` on a dirty or staged file does mean "modified"**. Also confirmed: a plain
filesystem rename (not routed through `fileDirtyMove`/`fileStageMove`) scans as an independent
delete+add pair, never as `MOVE` — the DirtyTracker's explicit move-tracking (§6.3) is required to
get `R old → new` semantics at all, not an optimization over what scanning would find anyway.

---

## 4. Architecture

### 4.1 Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ VS Code UI surfaces                                                  │
│  SCM view · status bar · explorer decorations · quick diff gutter    │
│  diff editors · History / Branches / Locks tree views · commands     │
├──────────────────────────────────────────────────────────────────────┤
│ Presentation layer   (src/scm, src/views, src/ui, src/commands)      │
│  reads the Model, issues commands to Repository                      │
├──────────────────────────────────────────────────────────────────────┤
│ Model layer          (src/repository)                                │
│  RepositoryManager · Repository (state + operation queue)            │
│  DirtyTracker · Refresher · LockCache · NotificationListener         │
├──────────────────────────────────────────────────────────────────────┤
│ Backend layer        (src/lore)                                      │
│  LoreBackend interface · SdkBackend · CliBackend · error mapping     │
├──────────────────────────────────────────────────────────────────────┤
│ @lore-vcs/sdk (koffi → lorelib)   |   `lore --json` child process    │
└──────────────────────────────────────────────────────────────────────┘
```

Rules:
- **Presentation never calls the backend directly.** It goes through `Repository` methods, which queue
  and serialize operations.
- **The backend returns plain JS domain objects**, not SDK events, and throws only `LoreOperationError`.
- Every backend call gets a `correlationId` (a UUID), which is logged with the call's arguments and
  duration.

### 4.2 Source layout

```
.
├─ package.json                # manifest + contributes (§6.17)
├─ tsconfig.json               # strict, ES2022, module commonjs (bundled)
├─ esbuild.mjs                 # bundles src/extension.ts → dist/extension.js
├─ .vscodeignore
├─ .vscode/launch.json, tasks.json
├─ src/
│  ├─ extension.ts             # activate/deactivate, wiring, context keys
│  ├─ config.ts                # typed accessors for `loreScm.*` settings
│  ├─ log.ts                   # LogOutputChannel wrapper
│  ├─ lore/
│  │  ├─ backend.ts            # LoreBackend interface
│  │  ├─ model.ts              # domain types (§4.3)
│  │  ├─ sdkBackend.ts         # SDK implementation (lazy import)
│  │  ├─ cliBackend.ts         # `lore --json` implementation
│  │  ├─ eventMapping.ts       # SDK event → domain object mappers (pure, unit-tested)
│  │  ├─ errors.ts             # LoreOperationError, code table, classification
│  │  └─ backendFactory.ts     # resolves loreScm.backend setting, fallback logic
│  ├─ repository/
│  │  ├─ repositoryManager.ts  # discovery, open/close, lookup by Uri
│  │  ├─ repository.ts         # per-working-tree state, public operations
│  │  ├─ operationQueue.ts     # read/write scheduling, refresh coalescing
│  │  ├─ dirtyTracker.ts       # FS events → batched fileDirty/fileDirtyMove
│  │  ├─ statusModel.ts        # status events → groups (pure, unit-tested)
│  │  ├─ lockCache.ts
│  │  └─ notificationListener.ts
│  ├─ scm/
│  │  ├─ scmProvider.ts        # SourceControl + resource groups
│  │  ├─ resource.ts           # LoreResource (SourceControlResourceState)
│  │  ├─ loreUri.ts            # toLoreUri/fromLoreUri
│  │  ├─ loreFileSystemProvider.ts # read-only `lore-scm:` scheme
│  │  ├─ quickDiff.ts
│  │  └─ decorations.ts        # FileDecorationProvider (status + locks)
│  ├─ views/
│  │  ├─ historyView.ts
│  │  ├─ branchesView.ts
│  │  └─ locksView.ts
│  ├─ ui/
│  │  ├─ statusBar.ts
│  │  ├─ progress.ts
│  │  └─ pickers.ts            # branch/revision quick picks
│  └─ commands/
│     ├─ index.ts              # registerCommands()
│     ├─ scmCommands.ts  branchCommands.ts  historyCommands.ts
│     ├─ lockCommands.ts  authCommands.ts  repoCommands.ts
├─ test/
│  ├─ unit/                    # vitest, no VS Code, no native lib
│  ├─ integration/             # @vscode/test-cli + mocha, real SDK, temp repos
│  └─ fixtures/
├─ scripts/
│  ├─ spike/                   # Phase 0 scripts (node + tsx)
│  ├─ start-test-server.ps1 / stop-test-server.ps1
│  ├─ start-dev-server.ps1
│  ├─ vsce-target.mjs
│  └─ install-local.mjs
└─ docs/
   ├─ spike-findings.md
   └─ architecture.md
```

### 4.3 Domain types and backend interface (sketch)

```ts
// src/lore/model.ts
export type ChangeKind = 'modified' | 'added' | 'deleted' | 'moved' | 'copied' | 'untracked';

export interface FileChange {
  path: string;            // relative to the working tree root, forward slashes
  fromPath?: string;       // for moved/copied
  kind: ChangeKind;
  staged: boolean;
  dirty: boolean;
  conflict?: {
    unresolved: boolean;
    automerged: boolean;
    resolution?: 'mine' | 'theirs';
  };
  fromMerge: boolean;
  size: number;
}

export interface RevisionState {
  repositoryId: string;
  branchId: string;
  branchName: string;
  revision: string;          // hash of the current revision
  revisionNumber: number;
  stagedRevision?: string;   // undefined when zero hash
  mergeInProgress?: string;  // revisionMerged, undefined when zero
  localLatest: string;  localLatestNumber: number;
  remoteLatest?: string; remoteLatestNumber?: number;
  isLocalAhead: boolean; isRemoteAhead: boolean;
  remoteAvailable: boolean; remoteAuthorized: boolean; remoteBranchExists: boolean;
}

export interface StatusSnapshot {
  state: RevisionState;
  changes: FileChange[];
  ignored?: string[];
  takenAt: number;
}

export interface RevisionSummary {
  revision: string; revisionNumber: number; parents: [string, string | undefined];
  message: string; timestamp?: Date; author?: string /* user id */; metadata: Record<string, unknown>;
}

export interface BranchSummary {
  id: string; name: string; latest: string; isCurrent: boolean; archived: boolean;
  location: 'local' | 'remote'; creator?: string; created?: Date; category?: string;
}

export interface LockInfo { path: string; owner: string; lockedAt: Date; branchId?: string; }

export interface ProgressSink {
  report(p: { message?: string; fraction?: number }): void;
}
```

```ts
// src/lore/backend.ts
export interface LoreBackend {
  readonly kind: 'sdk' | 'cli';
  version(): Promise<string>;
  dispose(): Promise<void>;

  // status & tracking
  status(root: string, opts: { scan?: boolean; checkDirty?: boolean; paths?: string[] }): Promise<StatusSnapshot>;
  markDirty(root: string, paths: string[]): Promise<void>;
  markMoved(root: string, from: string, to: string): Promise<void>;

  // working tree
  stage(root: string, paths: string[], opts?: { scan?: boolean }): Promise<void>;
  stageMove(root: string, from: string, to: string): Promise<void>;
  unstage(root: string, paths: string[]): Promise<void>;
  reset(root: string, paths: string[], opts?: { purge?: boolean; revision?: string }): Promise<void>;
  commit(root: string, message: string, p?: ProgressSink): Promise<{ revision: string; revisionNumber: number }>;
  amendMessage(root: string, message: string): Promise<void>;

  // remote
  push(root: string, opts?: { fastForwardMerge?: boolean }, p?: ProgressSink): Promise<void>;
  sync(root: string, opts?: { revision?: string; reset?: boolean }, p?: ProgressSink): Promise<SyncResult>;

  // content & diff
  readFileAt(root: string, path: string, revision: string): Promise<Uint8Array>;
  revisionDiff(root: string, source: string, target?: string, paths?: string[]): Promise<RevisionFileDiff[]>;

  // history
  history(root: string, opts: { revision?: string; branch?: string; length: number }): Promise<RevisionSummary[]>;
  fileHistory(root: string, path: string, length: number): Promise<FileHistoryEntry[]>;
  revisionInfo(root: string, revision: string): Promise<RevisionSummary>;

  // branches & merge
  listBranches(root: string, opts?: { archived?: boolean }): Promise<BranchSummary[]>;
  createBranch(root: string, name: string): Promise<void>;
  switchBranch(root: string, name: string, opts?: { revision?: string; reset?: boolean }, p?: ProgressSink): Promise<void>;
  archiveBranch(root: string, name: string): Promise<void>;
  mergeStart(root: string, source: string, opts?: { message?: string; noCommit?: boolean }, p?: ProgressSink): Promise<MergeResult>;
  mergeResolve(root: string, paths: string[], how: 'manual' | 'mine' | 'theirs'): Promise<void>;
  mergeUnresolve(root: string, paths: string[]): Promise<void>;
  mergeAbort(root: string): Promise<void>;
  revert(root: string, revision: string, opts?: { message?: string; noCommit?: boolean }): Promise<MergeResult>;

  // locks
  lockAcquire(root: string, paths: string[]): Promise<void>;
  lockRelease(root: string, paths: string[]): Promise<void>;
  lockStatus(root: string, paths: string[]): Promise<LockInfo[]>;
  lockQuery(root: string, q: { owner?: string; path?: string }): Promise<LockInfo[]>;

  // auth, identity, notifications
  login(root: string, openUrl: (url: string) => Promise<void>): Promise<void>;
  logout(root: string): Promise<void>;
  currentUser(root: string): Promise<{ id: string; name: string } | undefined>;
  resolveUsers(root: string, ids: string[]): Promise<Map<string, string>>;
  subscribeNotifications(root: string, onEvent: (e: LoreNotification) => void): Promise<Disposable>;

  // repository lifecycle
  clone(url: string, targetDir: string, opts?: { branch?: string }, p?: ProgressSink): Promise<void>;
  create(dir: string, urlOrName: string, opts?: { offline?: boolean }): Promise<void>;
}
```

### 4.4 SDK call helper (sketch)

```ts
// src/lore/sdkBackend.ts (excerpt)
private async run<T>(
  root: string,
  fnName: keyof typeof this.sdk.lore,
  args: object,
  onEvent: (e: LoreEventFFI) => void,
  extraGlobals: Partial<LoreGlobalArgs> = {},
): Promise<void> {
  const globals: LoreGlobalArgs = {
    repositoryPath: root,
    workingDirectory: root,
    correlationId: randomUUID(),
    ...this.defaultGlobals,          // e.g. storeKeepAlive per Phase 0 finding S5
    ...extraGlobals,
  };
  const started = Date.now();
  this.log.trace(`[${globals.correlationId}] ${String(fnName)} ${JSON.stringify(args)}`);
  try {
    await (this.sdk.lore as any)[fnName](globals, args)
      .callback((e: LoreEventFFI) => onEvent(e))    // copy what you need INSIDE the callback
      .waitAsync();
  } catch (err) {
    throw toLoreOperationError(err, String(fnName));     // §6.14
  } finally {
    this.log.debug(`[${globals.correlationId}] ${String(fnName)} ${Date.now() - started}ms`);
  }
}
```

`status()` then becomes a small reducer: on `REPOSITORY_STATUS_REVISION`, fill `state`; on
`REPOSITORY_STATUS_FILE`, push a mapped `FileChange` (the mapper lives in `eventMapping.ts`, which is pure
and unit-tested with recorded event fixtures from Phase 0).

---

## 5. Feature parity matrix (Git → Lore)

| Built-in Git feature | Lore equivalent | Phase |
|---|---|---|
| Auto-detect repositories in workspace folders (and parent folders) | Search for `.lore/config.toml` | 1 |
| SCM view with Merge Changes / Staged Changes / Changes groups | `repositoryStatus` | 1 |
| Explorer and tab decorations (M/A/D/U/R, colors) | `FileDecorationProvider` fed by the status model | 1 |
| Click a change to open the diff (HEAD ↔ working, HEAD ↔ staged) | `lore-scm:` FS provider backed by `fileWrite` | 1 |
| Quick diff gutter (added, modified and deleted line markers) | `quickDiffProvider` → `lore-scm:` URI at the current revision | 1 |
| Open File / Open File (HEAD) | Commands | 1 |
| Status bar: branch name, sync indicator | `SourceControl.statusBarCommands` | 1 (read) / 2 (actions) |
| Output channel "Git" | LogOutputChannel "Lore SCM" | 1 |
| Stage / Unstage / Discard (file, selection, all) | `fileStage` / `fileUnstage` / `fileReset` | 2 |
| Commit (Ctrl+Enter), "no staged changes, stage all?" smart commit | `revisionCommit` | 2 |
| Commit amend | `revisionAmend` (**message only**) | 2 |
| Push / Pull / Sync, "Publish Branch" | `branchPush` / `revisionSync` | 2 |
| Auto-refresh on FS changes | `DirtyTracker` + `.lore/` watcher | 2 |
| Checkout / create / delete branch | `branchSwitch` / `branchCreate` / `branchArchive` | 3 |
| Merge branch, conflict handling, "Accept Current/Incoming" | `branchMergeStart`, `resolveMine` / `Theirs`, mark resolved | 3 |
| Merge editor (3-way) | Optional: `_open.mergeEditor` with base, mine and theirs from `lore-scm:` URIs | 3 (stretch) |
| Revert commit | `revisionRevert` | 4 |
| Source Control Graph / timeline / file history | History tree view (+ file history) | 4 |
| Open file at revision, compare with previous | `lore-scm:` URIs + `vscode.diff` | 4 |
| Clone repository, Initialize repository | `repositoryClone`, `repositoryCreate` + welcome views | 5 |
| Credential prompts, GitHub sign-in | `authLoginInteractive` (`AUTH_URL` → `env.openExternal`) | 5 |
| Git LFS locks (via extensions) | **First-class locks**: decorations, Locks view, warn-on-edit | 5 |
| Periodic `git fetch` | Server push notifications (+ polling fallback) | 5 |
| Git blame (via extensions) | Out of scope (no line-level blame API found) | none |
| Stash | No Lore equivalent found | none |

---

## 6. Detailed designs

### 6.1 Activation and repository discovery

- `activationEvents`: `"workspaceContains:.lore/config.toml"`, `"workspaceContains:*/.lore/config.toml"`,
  and `"onStartupFinished"` (a cheap check for parent-folder repositories). Commands activate the
  extension implicitly.
- `RepositoryManager.scan()`:
  1. For each workspace folder, walk **up** from the folder to the filesystem root, looking for
     `.lore/config.toml`. Stop at the first hit. This handles a workspace opened on a subfolder.
  2. Walk **down** to `loreScm.repositoryScanMaxDepth` (default `1`), skipping `loreScm.repositoryScanIgnoredFolders`
     (default `["node_modules", ".git"]`), to find nested working trees.
  3. Open each root once. Dedupe with `realpath` and case-insensitive compare on Windows.
- React to `workspace.onDidChangeWorkspaceFolders`.
- Setting `loreScm.enabled` (default `true`). Setting `loreScm.autoRepositoryDetection`: `true | false |
  "subFolders" | "openEditors"` (mirrors Git).
- Context keys: `loreScm.state` (`"uninitialized" | "initialized" | "noRepository" | "backendError"`),
  `loreScm.hasRepository`, `loreScm.mergeInProgress`, `loreScm.hasRemote`.

### 6.2 Status model

`repositoryStatus` emits one `REPOSITORY_STATUS_REVISION` event and zero or more
`REPOSITORY_STATUS_FILE` events (with flags `flagStaged`, `flagDirty`, `flagMerged`, `flagConflict`,
`flagConflictUnresolved`, `flagConflictAutomerged`, `flagConflictMine` and `flagConflictTheirs`, plus
`action`, `type`, `fromPath` and `size`).

**Group assignment** (pure function in `statusModel.ts`):

| Condition (evaluate in order) | Group | Letter | Color token |
|---|---|---|---|
| `flagConflict && flagConflictUnresolved` | **Merge Changes** | `!` | `loreScmDecoration.conflictingResourceForeground` |
| `flagStaged` | **Staged Changes** | from action | per action |
| `flagDirty` (not staged) | **Changes** | from action (`U` for an unstaged `ADD`) | per action |
| `type == DIRECTORY` | skip (only files are shown) | | |

Action → letter: `KEEP`→`M` (modified), `ADD`→`A` (staged) or `U` (untracked), `DELETE`→`D`
(strike-through), `MOVE`→`R` (show `fromPath → path`), `COPY`→`C`.

Contribute colors under `contributes.colors`. Their defaults reference the Git colors, so themes look
right: `"loreScmDecoration.modifiedResourceForeground": { "dark": "gitDecoration.modifiedResourceForeground", … }`.

**Open question for Phase 0 (S2):** after a file is staged and then edited again, does Lore still show it
as one node (`flagStaged && flagDirty`)? LEP "modified file tracking" says dirty and staged share **one
action per node**, and that staging doesn't clear the dirty flag. So `flagDirty` can't be used alone to
mean "has unstaged edits". **Phase 0 spike S2 confirmed there's no reliable signal to split them**:
a staged-then-edited node stays a single `flagStaged && flagDirty` node, and its reported `size`
(and presumably `hash`) reflects the *staged* content even under `status({scan:true})` — so a naive
UI would show the wrong size/diff. Show a staged file **only** in Staged Changes. When the user
commits, warn if the file's on-disk hash differs from what was staged. Use `fileInfo` with
`local: true` passed as a **global** arg (it returns `localHash`/`localSize` for the live disk
content alongside `hash`/`size` for the committed revision — there is no separate "staged hash") as
the check, or re-stage the file before committing (setting `loreScm.restageModifiedOnCommit`,
default `true` — **this is load-bearing, not just a nicety**, since without it a commit silently
uses stale staged bytes).

Also:
- Resource groups use `hideWhenEmpty`. Merge Changes is hidden unless a merge is in progress.
- `SourceControl.count` = number of changes (setting `loreScm.countBadge`: `all | tracked | off`).
- If the change count exceeds `loreScm.statusLimit` (default 10 000), show a warning banner and truncate,
  like Git does.

### 6.3 Dirty tracking (critical for correctness and performance)

Lore doesn't find edits on its own. `lore status` without `--scan` only reports files already marked
dirty. The extension is the "IDE change detection" integration that LEP 2026-05-03 was designed for.

`DirtyTracker` for each repository:

1. **Initial reconcile.** On repository open, run `status({ scan: true })` in the background, with a
   window progress indicator. Control this with setting `loreScm.scanOnOpen`: `"always" | "never" | "auto"`
   (default `"auto"`: scan unless the last scan of this repository took longer than
   `loreScm.scanSlowThresholdMs`, default 10 000). Store the timing in `workspaceState`.
2. **Live tracking.** Use `workspace.createFileSystemWatcher(new RelativePattern(root, '**/*'))` plus
   `workspace.onDidCreateFiles`, `onDidDeleteFiles`, `onDidRenameFiles` and `onDidSaveTextDocument`.
   - Ignore anything under `<root>/.lore/`. Ignore paths in nested working trees (they belong to another
     repository). Optionally pre-filter with `.loreignore` (Lore filters them anyway).
   - Collect paths into a `Set`. **Debounce** by `loreScm.dirtyDebounceMs` (default 300 ms), then call
     `markDirty(root, [...paths])`. Split batches larger than 1 000 paths.
   - For renames that VS Code reports through `onDidRenameFiles` (explorer drag, refactorings), call
     `markMoved(from, to)` for each file so history is preserved. For directories, enumerate the files
     under them.
   - After marking, schedule a **cheap** refresh: `status({})` with no scan.
3. **Safety net.** Every `loreScm.checkDirtyIntervalSec` (default 300, `0` = off) and on window focus, run
   `status({ checkDirty: true })`. This clears stale dirty flags, for example when a file was edited back
   to its original content.
4. **Manual.** The command `loreScm.refresh` does a no-scan status. The command `loreScm.rescan` runs a full
   `status({ scan: true })`.
5. **External tool changes.** The OS watcher sees changes from build tools, Unreal Editor and terminals,
   because `createFileSystemWatcher` reports every disk event. VS Code's file watcher excludes
   (`files.watcherExclude`) can hide changes. Document this, and add a hint in the output channel when a
   scan finds changes the watcher missed.

### 6.4 Refresh and state change detection

- After **any** write operation the extension runs, it refreshes (no scan).
- Watch `<root>/.lore/**` with a second watcher. On change, **if no operation from the extension is
  running**, schedule a refresh after 500 ms. This catches CLI commands run in the terminal
  (`lore commit`, `lore sync`, `lore branch switch`). **Phase 0 (spike S13) found the glob cannot be
  narrowed**: `.lore/immutable/` and `.lore/mutable/` are a content-addressed, sharded store, and
  every operation touches a different, unpredictable set of shard files (including short-lived
  `*.pending`/`*.new` markers). The debounce is the real defense against watcher noise, not glob
  narrowing; keep watching the whole `.lore/**` tree.
- On window focus, refresh if the last refresh is older than 5 s (setting `loreScm.autorefresh`, default
  `true`).
- Remote state: the status revision event carries `revisionRemote*`, `isRemoteAhead` and
  `remoteAvailable`. Get fresh remote state without syncing in one of two ways:
  - (a) notifications (§6.12), or
  - (b) poll every `loreScm.remoteRefreshIntervalSec` (default 180; `0` = off) with a status call. **Phase 0
    S10:** does a plain status contact the remote? The `remote` and `local` global args suggest you can
    choose; use `revisionOnly: true` for cheapness.

### 6.5 Operation queue

`Repository` owns an `OperationQueue`:
- **Write ops** (stage, commit, sync, switch, merge, lock, …) run **exclusively**, in FIFO order.
- **Read ops** (status, history, content, lock status) may run concurrently with each other, but not with
  a write op.
- **Status refresh is coalesced.** If a refresh is requested while one is running, run exactly one more
  after it finishes.
- While a write op runs, set `SourceControl.inputBox.enabled = false` and the context key `loreScm.busy`,
  and show `$(sync~spin)` in the status bar item.
- Expose `onDidRunOperation(op, error?)` so views can refresh.
- **Phase 0 spike S5**: no "store busy" contention was observed between an SDK call holding
  `storeKeepAlive` and a concurrent CLI `dirty`/`status`/`stage`/`commit` (interleaved, not
  necessarily simultaneous — see `docs/spike-findings.md`). Keep the retry-with-backoff for error
  codes 30/31/32 anyway (§6.14) as cheap insurance the spike couldn't fully rule out under true
  simultaneous access.

### 6.6 `lore-scm:` URIs, the file system provider, and quick diff

- URI format: `lore-scm:/<absolute fs path>?<json>`, where json = `{ "root": "<repo root>", "ref": "<ref>" }`.
  `ref` is one of:
  - a full revision hash;
  - `~HEAD`: the current revision, resolved at read time from the latest status snapshot;
  - `~STAGED`: the staged state (see S3);
  - `~BASE` / `~MINE` / `~THEIRS`: for conflicts (S6).
- Register a **read-only `FileSystemProvider`** (`workspace.registerFileSystemProvider('lore-scm', p,
  { isReadonly: true, isCaseSensitive: <per OS> })`), not a `TextDocumentContentProvider`. That way
  binary files (images, `.uasset`) open in the right editors, and image diffs work.
- `readFile(uri)`:
  1. Resolve `ref` to a hash.
  2. Look it up in an **LRU cache** keyed by `hash + path` (content-addressed, so entries never go stale;
     default cap 50 MB).
  3. On a miss, call `backend.readFileAt(root, path, hash)`. The SDK implementation calls `fileWrite`
     into `os.tmpdir()/lore-vscode/<uuid>`, reads the bytes, and deletes the temp file.
  4. If the file doesn't exist at that revision, return an empty file (for added files). Don't throw.
- `stat()` returns the size from the cache, or `0`, with `mtime` = 0.
- `watch()` is a no-op, except that a `~HEAD` or `~STAGED` URI fires `onDidChangeFile` after refreshes
  whose revision or staged hash changed. This makes open diff editors and quick diff update.
- **Quick diff:** `sourceControl.quickDiffProvider = { provideOriginalResource: uri => isTracked(uri) ?
  toLoreUri(uri, '~HEAD') : undefined }`. Return `undefined` for untracked files, for files outside the
  view, and for files larger than `loreScm.quickDiffMaxSize` (default 5 MB).
- Clicking a resource opens:
  - Changes group: `vscode.diff(lore ~HEAD, file:)`, titled `name (Working Tree)`.
  - Staged group: `vscode.diff(lore ~HEAD, lore ~STAGED)`, titled `name (Staged)`. **Phase 0 spike S3
    confirmed there is no `fileWrite` revision keyword for staged content** (`"STAGED"`/`"staged"`
    both fail with "revision not found") — fall back to the working file (`lore ~HEAD` vs `file:`)
    for this diff, same as the Changes group. This is required, not just a contingency.
  - Deleted: `vscode.open(lore ~HEAD)`. Added or untracked: `vscode.open(file)`.
  - Setting `loreScm.openDiffOnClick` (default `true`).

### 6.7 Commit flow

- `SourceControl.inputBox.placeholder = "Message (Ctrl+Enter to commit on '<branch>')"`.
  `acceptInputCommand = loreScm.commit`.
- `loreScm.commit`:
  1. If the message is empty, prompt with an input box. If the user cancels, stop.
  2. If nothing is staged:
     - if `loreScm.enableSmartCommit` is `true` (default `false`), stage all changes;
     - otherwise ask "There are no staged changes. Stage all your changes and commit them directly?"
       with **Yes / Always / Never / Cancel** (persist the choice in the setting).
  3. With `loreScm.restageModifiedOnCommit`, re-stage staged files that were edited after staging (§6.2).
  4. Call `commit(message)` and show progress (`REVISION_COMMIT_PROGRESS`).
  5. Clear the input box, refresh, and show a brief notification: "Committed revision N". Setting
     `loreScm.postCommitCommand`: `"none" | "push" | "sync"` (default `"none"`).
- Errors:
  - `NothingStaged` (40): show the step 2 prompt.
  - `MissingIdentity` (110): offer "Set identity…". Prompt for an email, then write `identity = "…"`
    into `.lore/config.toml` with a TOML library (for example `smol-toml`), keeping the other keys
    unchanged.
- `loreScm.commitAmendMessage`: prefill the input box with the last revision's `message` metadata, then call
  `revisionAmend`. The command title must make clear that this changes **only the message**.
- Also add "Commit Staged", "Commit All" and "Undo Last Commit" (the last is **not supported**: omit it).

### 6.8 Push and sync

- `loreScm.push` → `branchPush({})`. On `BranchAdvanced` (41), offer **Sync & Push** (sync, then push again)
  or **Push with fast-forward merge** (`fastForwardMerge: true`).
- `loreScm.sync` → `revisionSync({})`, with progress from `REVISION_SYNC_PROGRESS`
  (`fileUpdate/fileUpdateTotal`, `bytesUpdate/bytesUpdateTotal`).
  - If `REVISION_SYNC_REVISION` or conflict events report conflicts, focus the SCM view and show "Sync
    produced N conflicts".
  - On `LocalModifications` (44), offer **Commit first** or **Discard local changes and sync** (the second
    passes `reset: true`, behind a **modal confirmation**).
- `loreScm.syncAndPush` is the status bar sync action: sync if the remote is ahead, then push if local is
  ahead.
- Status bar sync item text: `$(sync) ↓{behind} ↑{ahead}`. Compute the counts from
  `revisionRemoteNumber - revisionNumber` and `revisionLocalNumber - revisionRemoteNumber` **if Phase 0
  S10 confirms** that revision numbers are sequential along a branch. Otherwise show only `↓`/`↑` arrows
  from `isRemoteAhead` / `isLocalAhead`.
- If there's no remote (`NoRemote`, 111, or an empty `remote_url`), hide push and sync. Set context key
  `loreScm.hasRemote=false`.
- If `remoteBranchExists == false` and the local branch has revisions, the status bar shows
  **"Publish Branch"**, which runs `branchPush`.
- Setting `loreScm.confirmSync` (default `true`).

### 6.9 Branches

- Status bar branch item `$(git-branch) <name>` (use a Lore-specific icon if one is contributed). Clicking
  it opens a **branch quick pick**:
  - `+ Create new branch…`
  - `+ Create new branch from…` (pick a revision)
  - separator, then local branches (current branch marked), then remote-only branches
  - `Show archived branches`
- **Switch:** `branchSwitch({branch})`. With local modifications, Lore may refuse (`LocalModifications`)
  or carry them over. Handle this like sync: offer "Discard and switch" (`reset: true`, modal confirm) or
  Cancel.
- **Create:** validate the name client-side (non-empty, no whitespace) before calling
  `branchCreate({branch})` — **Phase 0 spike S11 found the server accepts almost anything** except an
  empty string (names with spaces, `..`-like segments, and 300-character names were all accepted
  with no error), so client-side validation is the only real guard. **`branchCreate` already
  switches to the new branch** (confirmed in S11); no follow-up `branchSwitch` call is needed.
- **Archive** (Lore's "delete"): confirm, then `branchArchive`. Handle `DeleteCurrent` (48) and
  `DeleteDefault` (49).
- **Protect / Unprotect:** from the Branches view context menu.
- **Branches view** (`loreScm.branches`, contributed to the `scm` container): a tree of branches with
  inline actions (Switch, Merge into current, Archive, Compare with current via `branchDiff`, Copy name).

### 6.10 Merge, revert, and conflicts

- `loreScm.merge` → pick a source branch → `branchMergeStart({branch, message})`.
  - If it's clean, it auto-commits (unless `noCommit`). Refresh.
  - If it conflicts, set `loreScm.mergeInProgress`. The Merge Changes group lists the conflicted files.
    Show an SCM action banner "Merging <source>: N conflicts".
- Per-file actions in Merge Changes (context menu and inline):
  - **Accept Mine** → `mergeResolve([p], 'mine')`
  - **Accept Theirs** → `mergeResolve([p], 'theirs')`
  - **Mark as Resolved** → `mergeResolve([p], 'manual')` (the plain `branchMergeResolve`), after the user
    edits the file
  - **Open (3-way)** → merge editor (stretch)
  - **Unresolve** → `mergeUnresolve`
- Group actions: **Abort Merge** (`branchMergeAbort`, with confirmation), **Restart Merge**. When all
  conflicts are resolved, the commit input placeholder changes to "Commit merge of <source>".
- **Phase 0 spike S6 confirmed:** conflict markers ARE written to disk, in standard diff3 form
  (`<<<<<<< ours` / `||||||| original` / `=======` / `>>>>>>> theirs`) — close enough to Git's own
  `merge=diff3` style that VS Code's built-in conflict CodeLens works with **no custom provider**.
  `branchMergeResolve`/`ResolveMine`/`ResolveTheirs` rewrite the file and clear the markers, but a
  `revisionCommit` is still required afterwards to finalize the (two-parent) merge revision.
  **`fileDiff({diff3:true}) does not work on an in-progress conflicted file`** (it returns only
  `FILTER_EXCLUDE` events for that path) — don't rely on it for base/mine/theirs. `branchInfo`'s
  `branchPoint` was only checked on the target branch (where it's legitimately zero); re-verify it
  on the source branch before depending on it, or derive the common ancestor from the merge
  revision's two parents instead.
  - Since markers are already on disk, prefer parsing them directly over building a merge editor
    input from `fileDiff`/`branchPoint`. If a real 3-way merge editor (not just markers) is still
    wanted, treat base/mine/theirs URI resolution as its own follow-up spike in Phase 3.
  - For binary conflicts, offer only Mine or Theirs.
  - **New constraint (spike S6): `branchMergeStart` requires a configured remote**, even to merge
    two fully local branches in the same working tree — it fails with `NoRemote` (111) on a
    `repositoryCreate({offline:true})` repository. Branch merge (and likely revert/cherry-pick) is
    unavailable in a repository with no remote at all; document this in the README.
- **Revert:** from the History view, `revisionRevert({revision})`. Its conflicts use the same Merge
  Changes UI, wired to the `revisionRevert*` resolve functions. Keep a per-repository `pendingOperation:
  'merge' | 'revert' | undefined` so group actions call the right family.

### 6.11 History

- **History view** (`loreScm.history`, in the `scm` container; visible when `loreScm.hasRepository`).
  - Root nodes: revisions on the current branch, from `history({length: 50})`. A "Load more…" node
    fetches the next page using `revision = <last hash>`.
  - Label: first line of `message`. Description: `#<number> · <author display name> · <relative time>`.
    Tooltip: a Markdown hover with the full message, hash (with a copy link), author, date, parents, and
    the `cherry-picked-from` / `reverted-from` metadata when present.
  - Expand a revision to see its changed files: `revisionDiff(parent, rev)`, using the first parent, and
    for the first revision the empty tree. Click a file to open `vscode.diff(lore-scm:parent, lore-scm:rev)`.
  - Context menu: Copy hash; Copy revision number; Sync working tree to this revision (`revisionSync`,
    with confirmation); Revert this revision; Create branch from here; Compare with working tree.
  - Merge revisions (second parent set) show a merge icon.
- **File history:**
  - The command `loreScm.fileHistory` (editor title context and explorer context) shows a quick pick, or a
    filter mode in the History view, for `fileHistory(path)`.
  - Selecting an entry opens `vscode.diff(lore-scm:prev, lore-scm:this)`.
  - Moves (`fromPath`) are followed automatically.
- **Timeline:** the `TimelineProvider` API is proposed (not usable in Marketplace extensions). Check
  `vscode.d.ts` for the engine version you target. If `registerTimelineProvider` is **finalized**, add a
  provider backed by `fileHistory`. Otherwise skip it.
- **SCM graph:** likewise, use `SourceControlHistoryProvider` only if it's finalized in the targeted
  `vscode.d.ts`. Otherwise the History tree view is the deliverable.
- **Author names:** metadata values `committed-by` / `created-by` are user ids. Resolve them with
  `authUserInfo` (needs the remote and auth), falling back to `authLocalUserInfo`, then to the raw id.
  Cache the results per session. **Phase 0 spike S7 found that on a server with no auth endpoint
  configured, both `authUserInfo` and `authLocalUserInfo` fail outright** (`NoRemote`/`Operation not
  supported`) — the raw-id fallback is the common case on such servers, not a rare edge case, so the
  History view's author display must read well as a raw `identity` string, not just as a name.
  Metadata values themselves are a tagged union `{tag, tagName, data}` (`tagName` one of `"string"`,
  `"numeric"`, `"context"` at least) — unwrap `.data` by `tagName` in `eventMapping.ts`.
- **Timestamp:** the `timestamp` metadata key. Phase 0 S7 determines its type and unit.

### 6.12 Locks and notifications

Locks matter most for binary assets in game projects. Lore locks are currently **advisory** — and
Phase 0 spike S8 found this is stronger than it sounds: against a demo-style server, a second
identity could silently re-acquire an already-held lock (`ignored: true`, no error), push a commit
that edits the locked file with no rejection, and release another identity's lock with **no
ownership check at all**. Treat the extension's own confirmation dialogs as the *only* real
protection a user has, not a courtesy layered on top of server-side enforcement. Also: on a server
with no auth endpoint configured, `lockFileStatus`/`lockFileQuery`'s `owner` field is the literal
string `"<unknown>"` — handle that as an expected value in the Locks view and lock decorations, not
an edge case.

- **LockCache** per repository: a `Map<path, LockInfo>` for the current branch, filled by
  `lockQuery({})` (all locks on the branch) on open and every `loreScm.locks.refreshIntervalSec` (default
  120), and updated from notifications.
- **Decorations:** a `FileDecorationProvider` adds a lock badge (for example `🔒` or `L`) to locked files
  in the explorer and tabs. Tooltip: "Locked by <name> since <date>". Mine and theirs use different
  colors.
- **Commands:**
  - `loreScm.lock` / `loreScm.unlock` (explorer, SCM resource and editor title context menus; multi-select)
  - `loreScm.lockStatus`
  - `loreScm.showMyLocks`
  - `loreScm.releaseAllMyLocks` (with confirmation)
- **Locks view** (`loreScm.locks`): grouped by owner. Inline "Unlock" for your own locks. "Reveal in
  Explorer".
- **Warn on edit:** on the first `onDidChangeTextDocument` for a file that someone else has locked, show a
  warning once per file per session: "<file> is locked by <name>. Your changes may conflict." with Show
  Lock / Dismiss. Setting `loreScm.locks.warnOnEdit` (default `true`).
- **Auto-lock** (optional): setting `loreScm.locks.autoLockPatterns` (default `[]`, for example
  `["**/*.uasset", "**/*.umap"]`). On the first edit, offer to acquire the lock.
- **Commit hint:** after pushing, offer to release your locks on files that were in the pushed
  revisions. Setting `loreScm.locks.releaseAfterPush`: `"ask" | "always" | "never"`.
- **NotificationListener:** when the remote is available and authorized, call `notificationSubscribe`
  once per repository. Phase 0 S9 determines whether the call stays open until `notificationUnsubscribe`
  (the likely case, since events stream through the callback) and how to reconnect. Handle:
  - `BRANCH_PUSHED` on the current branch by another user: refresh remote state, and optionally show
    "N new revisions on <branch>". Setting `loreScm.notifications.showIncoming`.
  - `RESOURCE_LOCKED` / `RESOURCE_UNLOCKED`: update the LockCache and fire a decoration change.
  - `BRANCH_CREATED` / `DELETED`: invalidate the branch list.
  - Disconnect: reconnect with backoff (5 s, 10 s, … up to 5 min), and fall back to polling meanwhile.

### 6.13 Auth, clone, and create

- **Auth state** comes from the status revision event:
  - `remoteAvailable && !remoteAuthorized` → the status bar shows `$(account) Sign in to Lore`.
  - Any `NotAuthenticated` (16) or `TokenNotFound` (18) error → a notification with **Sign In**.
- `loreScm.signIn` → `authLoginInteractive({remoteUrl, noBrowser: true})`. On the `AUTH_URL` event, call
  `env.openExternal(url)` and show "Complete sign-in in your browser…" as a cancellable-looking progress.
  (It can't really be cancelled; if the user dismisses it, just stop showing it.)
- `loreScm.signInWithToken`: an input box for the token type and token (`password: true`) →
  `authLoginWithToken`. **Never log tokens**, and never store them in VS Code settings. Lore keeps its
  own secure store.
- `loreScm.signOut` → `authLogout`. `loreScm.showIdentity` → `authLocalUserInfo`.
- `loreScm.clone`:
  1. Input box for the URL (validate `^lore://`).
  2. Folder picker for the parent directory, then a name defaulting to the repo name.
  3. Optionally a branch.
  4. `repositoryClone` with notification progress (`REPOSITORY_CLONE_PROGRESS`).
  5. On completion, offer Open / Open in New Window / Add to Workspace.
  6. Setting `loreScm.defaultCloneDirectory`. Option `loreScm.clone.useSharedStore`: `"inherit" | "enabled" |
     "disabled"`, mapping to `LoreSharedStoreMode`.
- `loreScm.init` ("Create Lore Repository"): pick a folder, then choose "Local only (offline)" or "On
  server…" (URL `lore://host:port/name`) → `repositoryCreate`.
- **Welcome views** (`viewsWelcome` for `scm`, when `!loreScm.hasRepository && loreScm.state == noRepository`):
  "Create Lore Repository" and "Clone Lore Repository" buttons.

### 6.14 Error handling

- `LoreOperationError` holds `{ code: number, name?: string, message: string, operation: string,
  correlationId: string, category }`.
- Categories come from the code ranges in `docs/developing/code-standards/errors.md` (Lore repo):
  - 3–15 input
  - 16–27 auth
  - 28–39 connectivity
  - 40–55 repository state
  - 56–63 already exists
  - 79–99 not found
  - 110–117 configuration
  - 118–125 resource limits
  - 193–200 library lifecycle
  - −1 internal
- Named codes (verified in `lore-base/src/error.rs` at commit `a0286e9`). Keep them in **one** table in
  `errors.ts`, and re-verify against the SDK version you pin:

| Code | Name | UX |
|---|---|---|
| 16 | NotAuthenticated | "Sign in" action |
| 17 | NotAuthorized | "You don't have access to this repository" |
| 18 | TokenNotFound | "Sign in" action |
| 19 | WriteRequired | "Write access required" |
| 28 / 29 | Disconnected / NotConnected | Status bar shows offline. Retry action |
| 30 / 31 / 32 | Maintenance / SlowDown / ServiceUnavailable | Automatic retry with backoff (3×), then error |
| 40 | NothingStaged | Smart-commit prompt |
| 41 | BranchAdvanced | "Sync & Push" / fast-forward options |
| 42 | Divergent | Offer sync (auto-merge) |
| 43 | Conflict | Focus Merge Changes |
| 44 | LocalModifications | Commit first / discard-and-continue (modal) |
| 45 | LockNotOwned | "Locked by someone else" |
| 47–49 | DeleteProtected / DeleteCurrent / DeleteDefault | Explain why the branch can't be archived |
| 57 | BranchAlreadyExists | Re-prompt for the name |
| 89 | RepositoryNotFound | Check the URL |
| 110 | MissingIdentity | "Set identity…" |
| 111 | NoRemote | Hide remote actions |
| 193 | ShutDown | Recreate the backend |
| −1 | Internal | "Unexpected error". Link to "Open Lore Log" |

- Every error notification includes a **"Show Log"** button that reveals the output channel, scrolled to
  the correlation id.
- **Native crash protection:** an FFI crash would take down the extension host. Mitigations:
  - Wrap every SDK call in `try/catch`.
  - Never pass `undefined` where the SDK expects arrays (use `[]`).
  - Keep koffi callbacks tiny.
  - Offer `loreScm.backend: "cli"` as the escape hatch, and mention it in the README troubleshooting
    section.

### 6.15 Logging and output

- `window.createOutputChannel('Lore SCM', { log: true })`.
- Setting `loreScm.logLevel` (`off|error|warn|info|debug|trace`, default `info`) maps to both the
  channel's filtering and `lore.logConfigure({ file: true, filePath: context.logUri.fsPath, level })`.
- `lore.globalCallback(LOG, …)` forwards library logs at or above the configured level.
- Log every operation: `▶ commit (id) args…` / `✔ commit 812ms` / `✖ commit code=41 BranchAdvanced`.
- Command `loreScm.showOutput`.

### 6.16 Settings (`contributes.configuration`, prefix `loreScm.`)

| Setting | Type / default | Purpose |
|---|---|---|
| `enabled` | bool `true` | Master switch |
| `backend` | `"auto"`\|`"sdk"`\|`"cli"` = `auto` | §3.2 |
| `path` | string\|null | Path to the `lore` executable (CLI backend, version check) |
| `libraryPath` | string\|null | Override for `LORE_LIB_PATH` (use your installed lorelib) |
| `autoRepositoryDetection` | `true`\|`false`\|`"subFolders"`\|`"openEditors"` = `true` | §6.1 |
| `repositoryScanMaxDepth` | number `1` | §6.1 |
| `repositoryScanIgnoredFolders` | string[] | §6.1 |
| `scanOnOpen` | `"auto"`\|`"always"`\|`"never"` = `auto` | §6.3 |
| `scanSlowThresholdMs` | number `10000` | §6.3 |
| `dirtyDebounceMs` | number `300` | §6.3 |
| `checkDirtyIntervalSec` | number `300` | §6.3 |
| `autorefresh` | bool `true` | §6.4 |
| `remoteRefreshIntervalSec` | number `180` | §6.4 |
| `statusLimit` | number `10000` | §6.2 |
| `countBadge` | `"all"`\|`"tracked"`\|`"off"` = `all` | §6.2 |
| `openDiffOnClick` | bool `true` | §6.6 |
| `quickDiffMaxSize` | number `5242880` | §6.6 |
| `enableSmartCommit` | bool `false` | §6.7 |
| `restageModifiedOnCommit` | bool `true` | §6.2 |
| `postCommitCommand` | `"none"`\|`"push"`\|`"sync"` = `none` | §6.7 |
| `confirmSync` | bool `true` | §6.8 |
| `defaultCloneDirectory` | string\|null | §6.13 |
| `clone.useSharedStore` | `"inherit"`\|`"enabled"`\|`"disabled"` = `inherit` | §6.13 |
| `locks.warnOnEdit` | bool `true` | §6.12 |
| `locks.autoLockPatterns` | string[] `[]` | §6.12 |
| `locks.releaseAfterPush` | `"ask"`\|`"always"`\|`"never"` = `ask` | §6.12 |
| `locks.refreshIntervalSec` | number `120` | §6.12 |
| `notifications.enabled` | bool `true` | §6.12 |
| `notifications.showIncoming` | bool `true` | §6.12 |
| `logLevel` | enum `info` | §6.15 |

**Don't touch the user's Lore configuration.** Never call `serviceSetExecutable`,
`serviceSetUseAutomatically`, `serviceStart` or `sharedStoreSetUseAutomatically`, and never edit the user
`config.toml`. The Lore docs specifically warn that a bundled editor plugin must not become the machine's
service executable by accident. The **only** file the extension may write is `.lore/config.toml`
`identity`, and only after an explicit user action (§6.7).

### 6.17 `package.json` contributes (skeleton)

- **Commands** (all under category `"Lore SCM"`, id prefix `loreScm.`):
  - Repository: `refresh`, `rescan`, `init`, `clone`, `openRepository`, `close`, `showOutput`, `showVersion`
  - Staging and commit: `stage`, `stageAll`, `unstage`, `unstageAll`, `discard`, `discardAll`,
    `openFile`, `openHEADFile`, `openChange`, `commit`, `commitStaged`, `commitAll`, `commitAmendMessage`
  - Remote: `push`, `sync`, `syncAndPush`, `publishBranch`
  - Branches: `checkout` (switch), `branchCreate`, `branchCreateFrom`, `branchArchive`, `branchProtect`,
    `branchUnprotect`
  - Merge and revert: `merge`, `mergeAbort`, `mergeRestart`, `acceptMine`, `acceptTheirs`,
    `markResolved`, `unresolve`, `openMergeEditor`, `revertRevision`
  - History: `fileHistory`, `showRevision`, `copyRevisionHash`, `syncToRevision`, `compareWithWorkingTree`
  - Locks: `lock`, `unlock`, `lockStatus`, `showMyLocks`, `releaseAllMyLocks`
  - Auth: `signIn`, `signInWithToken`, `signOut`, `showIdentity`
- **Menus** (use `when` clauses with `scmProvider == loreScm`):
  - `scm/title`: commit (navigation), refresh (navigation), push, sync, checkout, merge, "…" submenu
  - `scm/resourceGroup/context`: stageAll, unstageAll, discardAll, and for `scmResourceGroup == merge`:
    acceptMine / acceptTheirs for all, mergeAbort
  - `scm/resourceState/context`: stage / unstage / discard / openFile / openHEADFile / lock / unlock /
    fileHistory; acceptMine / acceptTheirs / markResolved for `scmResourceGroup == merge`
  - `editor/title` (when `resourceScheme == file && loreScm.hasRepository`): openChange, lock, fileHistory
  - `explorer/context`: lock, unlock, fileHistory, stage
  - `view/title` and `view/item/context` for `loreScm.history`, `loreScm.branches` and `loreScm.locks`
  - `commandPalette`: hide resource-only commands (`"when": "false"`)
- **Views:** in the `scm` container, `loreScm.history` ("Lore History"), `loreScm.branches` ("Lore Branches")
  and `loreScm.locks` ("Lore Locks"), all `when: loreScm.hasRepository`.
- **`viewsWelcome`:** §6.13.
- **Colors:**
  - `loreScmDecoration.{modified,added,deleted,untracked,renamed,conflicting}ResourceForeground` (defaults
    reference the `gitDecoration.*` colors)
  - `loreScmDecoration.lockedByMeForeground`, `loreScmDecoration.lockedByOtherForeground`
- **Keybindings:** none by default, except the SCM commit (handled by `acceptInputCommand`).
- **`capabilities`:** `"untrustedWorkspaces": { "supported": false, "description": "Lore runs native code
  and reads repository configuration." }` and `"virtualWorkspaces": false`.
- **`extensionKind`:** `["workspace"]`. The extension must run where the files are (Remote-SSH, WSL and
  Dev Containers work if the remote OS is supported).

---

## 7. Phased delivery plan

Each phase ends with **acceptance criteria (AC)**. Commit in small, reviewable steps. The rough estimates
assume one agent working sequentially.

### Phase 0 — Scaffolding and spikes (≈ 2–3 days)

**Tasks**
1. Scaffold the extension manually (no interactive generators):
   - `package.json` with `"publisher": "alsimoes"`, `"name": "lore-scm"`, `"displayName": "Lore SCM (Community)"`,
     the description from "Decisions already made", `engines.vscode` set to the current stable minus two
     minors, and a matching `@types/vscode`
   - TypeScript strict, esbuild bundling, ESLint (typescript-eslint flat config) and Prettier
   - `.vscode/launch.json` ("Run Extension", "Extension Tests")
   - `npm` as the package manager
   - `LICENSE` (MIT, copyright André Simões) and a `.gitignore`
   - Dependency: `@lore-vcs/sdk` pinned to an **exact** version (for example `0.10.0`)
   - devDependency `@vscode/vsce`, and the scripts `build:prod`, `package:local` and `install:local`
     (§9.1)
2. Local Lore server scripts (PowerShell, since the platform is Windows):
   - Prerequisite: `loreserver.exe` must be on PATH (normally next to `lore.exe` in `%USERPROFILE%\bin`).
     If it's missing, the scripts tell the **maintainer** to install it with the official install script
     (see Lore's Quickstart, Step 1). The agent must not download or run install scripts itself.
   - `scripts/start-test-server.ps1`: throwaway server for tests and spikes. Start `loreserver` with zero
     config (ephemeral self-signed certificate, store under the temp folder, auth disabled) as a
     background process, and wait for `http://127.0.0.1:41339/health_check` to return 200. The paired
     `scripts/stop-test-server.ps1` stops it.
   - `scripts/start-dev-server.ps1`: **persistent** server for daily use, following Lore's how-to
     "Deploy a local Lore Server". It uses `C:\loreserver\config\local.toml` with
     `[immutable_store.local] path = "C:\\loreserver\\store"` and
     `[mutable_store.local] path = "C:\\loreserver\\store"`, plus a stable QUIC certificate (see the
     how-to), and runs `loreserver --config C:\loreserver\config`. The script creates the config only if
     it doesn't exist and never overwrites it. The agent asks the maintainer before creating anything
     outside the repo.
   - Both servers use ports 41337 and 41339, so only one can run at a time. The scripts detect an
     already-running server through the health check and say so, instead of starting a second one.
3. Write spike scripts in `scripts/spike/` (runnable with `npx tsx`). Each one prints the **raw events as
   JSON** into `test/fixtures/events/<name>.json`; they become the unit-test fixtures. Answer every
   question below and record the answers in `docs/spike-findings.md`:

| Id | Question | How |
|---|---|---|
| S1 | Does the SDK load **inside the VS Code extension host** (Electron) on win32-x64 (the maintainer's machine and CI)? | Minimal extension command that lazy-imports the SDK and shows `lore.version()` |
| S2 | Status semantics: which `action`/flags does a modified, added (untracked), deleted, moved or staged file produce? Is `KEEP` "modified"? Is a file edited after staging distinguishable? Is `.loreignore` respected? | Offline repo (`repositoryCreate` with `offline:true`). Mutate files. `status({scan:true})`, then `status({})`, `fileDirty`, `fileStage`, and edit again |
| S3 | How do you read file bytes at (a) the current revision, (b) the staged state, (c) `branch@LATEST`? Does `fileWrite` accept `revisionStaged` as `revision`? | `fileWrite({path, revision, output})` variants |
| S4 | `lore --json status --scan` output: one JSON object per line? Does `parseLoreEventJSON` parse it? Field naming of `data`? | Run the CLI and parse |
| S5 | Concurrency: while the extension process holds the store (`storeKeepAlive: true`), can the CLI in a terminal run `status` / `commit`? What errors appear? Same without keep-alive? | Two processes |
| S6 | Conflicts: two working trees, conflicting edits to a text file and a binary file, then `sync` or `branch merge`. What's on disk (markers?), which status flags, which events? How do you get base/mine/theirs? What do `resolve`, `resolve mine`, `resolve theirs` and `abort` do on disk? Is a commit required afterwards? | Demo server |
| S7 | History: which `METADATA` keys follow each `REVISION_HISTORY_ENTRY`? Value type of `message`, `timestamp` (unit?), `committed-by`. Does `authLocalUserInfo` resolve ids offline? | Demo server with `--identity` set |
| S8 | Locks: acquire/status/query/release on the demo server. Owner id format, `lockedAt` unit. Can a non-owner release? Is anything enforced? | Two identities |
| S9 | Notifications: does `notificationSubscribe(...).waitAsync()` stay pending until `notificationUnsubscribe`? Do events arrive for your own actions? How do you stop it cleanly on `deactivate`? | Demo server, push from the CLI |
| S10 | Remote state: does a plain `repositoryStatus` query the remote (network latency)? Does `local: true` avoid it? Are revision numbers contiguous along a branch, so ahead/behind = number difference? | Demo server + a second clone pushing |
| S11 | Does `branchCreate` also switch to the new branch? Branch name rules? | Offline repo |
| S12 | Is there any cancellation mechanism? What happens to a pending promise on `lore.shutdown()`? | Read the SDK source + experiment |
| S13 | Which files under `.lore/` change on commit, stage, sync and switch? (For the §6.4 watcher glob) | FS watch while running CLI commands |
| S14 | Service interplay: with `LORE_USE_SERVICE=1` and a configured service, do SDK calls get routed to the service? Any behavioral difference? | Env var experiment |

**AC**
- `npm run build`, `npm run lint` and `npm test` (empty suites) pass.
- F5 launches the Extension Development Host. The command "Lore SCM: Show Version" (`loreScm.showVersion`) displays the library
  version on Windows x64.
- `docs/spike-findings.md` answers S1–S14, with event fixtures committed under `test/fixtures/events/`.
- This plan is amended wherever a finding contradicts it.

### Phase 1 — Read-only SCM integration (≈ 4–5 days)

**Tasks**
- `log.ts`, `config.ts`, `errors.ts`, `backend.ts`, `model.ts`, `eventMapping.ts` (with unit tests against
  the fixtures), and `SdkBackend` for `status`, `readFileAt`, `version`.
- `RepositoryManager` discovery (§6.1). `Repository` with the operation queue and a refresh.
- `ScmProvider`: resource groups (§6.2), `count`, `inputBox` (disabled until Phase 2).
- `LoreFileSystemProvider` + LRU cache. Quick diff. Click-to-diff (§6.6).
- `FileDecorationProvider` (status letters and colors).
- Status bar: branch name (read-only) + remote state indicator (read-only).
- Commands: `refresh`, `rescan`, `openFile`, `openHEADFile`, `openChange`, `showOutput`.
- Initial scan on open (§6.3 step 1). `.lore/` watcher (§6.4).

**AC**
- Opening a folder containing a Lore working tree shows a "Lore" provider in the SCM view within 2 s (plus
  the scan time) with the correct groups for modified, added, deleted and moved files.
- The gutter shows quick diff markers for modified tracked files. Clicking a change opens a correct
  side-by-side diff, including for an image file.
- Running `lore commit` in an external terminal updates the SCM view within about 2 s, with no manual
  refresh.
- Unit test coverage of `eventMapping.ts` and `statusModel.ts` is ≥ 90 %.
- `npm run install:local` (§9.1) succeeds on the maintainer's Windows x64 machine, and the **installed**
  extension (not F5) activates in a Lore working tree. From here on, every phase ends with a local install
  for daily use.

### Phase 2 — Core write workflow (≈ 4–5 days)

**Tasks**
- `DirtyTracker` (§6.3, all steps) with unit tests. Inject the timers and the FS event source.
- Backend: `markDirty`, `markMoved`, `stage`, `stageMove`, `unstage`, `reset`, `commit`, `amendMessage`,
  `push`, `sync`.
- Commands: stage / unstage / discard (single, multi-select, all), commit variants, smart-commit prompt,
  amend message, push, sync, syncAndPush, publishBranch.
- Progress UI (`window.withProgress`, `ProgressLocation.SourceControl` for quick operations,
  `Notification` for push, sync and clone).
- Error UX for codes 40, 41, 44, 110 and 111 (§6.14).
- Discard: modal confirmation. For untracked files, use `purge: true` (or move them to the trash, per
  Phase 0 findings).

**AC**
- **Round trip:** edit a file in VS Code, and it appears in Changes within 1 s with no scan. Then Stage →
  Commit (Ctrl+Enter) → Push against the demo server. The CLI's `lore status` in a second clone, after
  `lore sync`, shows the new revision.
- A rename in the Explorer shows as `R old → new` and commits as a move (`lore file history new` shows the
  old path).
- Discarding a modification restores the file contents. Discarding an untracked file removes it (after
  confirmation).
- Pushing when the remote moved shows the "Sync & Push" option, and that option succeeds.
- Integration tests cover these flows (§8).

### Phase 3 — Branches, merge, conflicts (≈ 4–5 days)

**Tasks**
- Branch quick pick, create / switch / archive / protect, Branches view (§6.9).
- Merge start, the conflict group, and the resolve actions. Abort and restart. `mergeInProgress` context
  (§6.10).
- Status bar sync counts (if S10 allows).
- Stretch: merge editor integration (if S6 shows it's feasible).

**AC**
- Create a branch, commit on it, switch to main (the file disappears), merge the branch (the file
  appears), push. This reproduces the Lore quickstart steps 7–9 entirely through the UI.
- A conflicting merge shows the files in Merge Changes. Accept Mine / Accept Theirs / manual edit + Mark
  Resolved each lead to a committable state. Abort restores the pre-merge state.

### Phase 4 — History (≈ 3–4 days)

**Tasks**
- History view with paging, the revision → files → diff drill-down, tooltips, and author name
  resolution (§6.11).
- File history command. Revert revision (same conflict UI). Sync to a revision. Create a branch from a
  revision. Compare with the working tree.
- A timeline provider **only if** the API is finalized in the targeted engine.

**AC**
- The History view lists revisions with message, number, author and relative date. Expanding a revision
  shows its changed files. Clicking a file shows the correct before/after diff.
- File history follows a moved file across its move.
- Reverting a revision creates a new revision whose `reverted-from` metadata shows up in the tooltip.

### Phase 5 — Collaboration: auth, locks, notifications, clone and create (≈ 4–5 days)

**Tasks**
- Sign in / sign in with token / sign out / show identity. Auth-aware status bar (§6.13).
- LockCache, lock decorations, lock commands, Locks view, warn-on-edit, auto-lock patterns,
  release-after-push (§6.12).
- NotificationListener with reconnect and polling fallback.
- Clone and init commands, and the welcome views.

**AC**
- User A locks `Content/Hero.uasset`. Within 5 s, user B's explorer shows the lock badge with A's name,
  and editing it warns. A unlocks, and B's badge disappears.
- A push by user B shows as incoming for user A without a manual refresh (notification path), and polling
  covers it when notifications are disabled.
- Cloning from the command palette with progress works, then opens the folder with the SCM provider
  active.
- Sign-in opens the browser URL from the `AUTH_URL` event. (Test with an auth-enabled server if one is
  available; otherwise document it as manually verified.)

### Phase 6 — Hardening, CLI backend, release (≈ 4–6 days)

**Tasks**
- `CliBackend` (spawn `lore --json …`, parse lines with `parseLoreEventJSON`, map to the same domain
  types). Run the **same backend contract test suite** against both backends (§8).
- Backend fallback logic (§3.2). Version check: warn when the CLI and the library differ by minor version.
- Performance pass on a synthetic large repository (100k files, 5 GB of binaries):
  - status without a scan in under 300 ms
  - dirty batching with no event-loop stalls over 50 ms
  - SCM group rendering capped by `statusLimit`
- Read-only display of links and layers (optional): decorate link mount folders.
- Accessibility: every icon-only action has a title. Every status bar item has `accessibilityInformation`.
- README (features, screenshots, requirements, supported platforms, settings, troubleshooting including
  `loreScm.backend: "cli"` and `loreScm.libraryPath`), CHANGELOG, LICENSE (MIT, matching Lore), and
  `SECURITY.md`.
- Platform-specific VSIX packaging and CI (§9). **No publishing in this phase**: the deliverable is
  VSIX files the maintainer installs locally (§9.1). The README must say "Unofficial / not affiliated with
  Epic Games", include a section "Relationship to the official Lore extension", and document the local
  install steps from §9.1.

**AC**
- The contract suite passes on both backends on win32-x64 in CI.
- The VSIX for each target installs into a clean VS Code and works with **no** separately installed Lore
  (SDK backend).
- The README is complete. `vsce ls` shows no stray files. Each VSIX is under 60 MB.

---

## 8. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Unit | **vitest** (Node, no VS Code, no native library) | `eventMapping`, `statusModel`, `errors` classification, `DirtyTracker` batching and debouncing (fake timers), `OperationQueue` scheduling, `loreUri` round-trips, ahead/behind math. Run on recorded fixtures from Phase 0 |
| Backend contract | vitest + real SDK (and later the CLI) | A single parameterized suite `backendContract.test.ts(backend)`: create an offline repo in a temp dir, write files, status, stage, commit, history, readFileAt, reset, branch create/switch, merge with conflict. Server-dependent cases (push, sync, locks, notifications) run only when `LORE_TEST_SERVER=lore://127.0.0.1:41337` is set |
| Extension integration | **@vscode/test-cli** + @vscode/test-electron (mocha) | Open a fixture workspace containing an offline Lore repo. Assert SCM groups via the extension's exported test API (`activate()` returns `{ repositories, … }` when `LORE_VSCODE_TEST=1`). Run commands with `executeCommand` and check the results |
| Manual | Checklist in `docs/manual-test.md` | Auth flow, merge editor, multi-root workspaces, Remote-SSH/WSL, large-repo feel |

Rules:
- Tests create repositories under `os.tmpdir()` and clean up.
- Set `LORE_SERVICE_SOCKET=lore_service-vscode-tests-<pid>` in the test environment, so the tests never
  touch a developer's running Lore service (recommended in Lore's config docs).
- CI starts the throwaway server (`scripts/start-test-server.ps1`) for the server-dependent suite.

---

## 9. Build, packaging, CI, release

- **Bundling:** esbuild takes `src/extension.ts` and produces `dist/extension.js` (`format: 'cjs'`,
  `platform: 'node'`, `target: 'node20'`, sourcemaps in dev, minify in prod). **External:** `vscode`,
  `koffi`, `@lore-vcs/sdk`, and `@lore-vcs/sdk-*`, because they contain native code or load files relative
  to their own location. Keep those packages in `node_modules` inside the VSIX.
- **`.vscodeignore`:** exclude `src/**`, `test/**`, `scripts/**`, `docs/**`, `**/*.map` (prod), and all of
  `node_modules/**` **except** `node_modules/koffi/**`, `node_modules/@lore-vcs/**`, and their runtime
  dependencies. Optionally prune the koffi prebuilds for other platforms in a `vscode:prepublish` step to
  shrink each VSIX.
- **Platform-specific VSIX:** for now only `vsce package --target win32-x64`, containing only
  `@lore-vcs/sdk-amd64-unknown-windows`. When publishing starts (§9.2), add `linux-x64`, `linux-arm64` and
  `darwin-arm64` VSIXs, plus a **universal VSIX with no native SDK** (CLI backend only) for other targets
  (`win32-arm64`, `darwin-x64`, `alpine-*`) that requires a user-installed `lore`.
- **CI (GitHub Actions):**
  - `ci.yml` runs on PRs to `main` on **`windows-latest` only**. Steps: `npm ci`, lint, unit tests,
    contract tests (with the throwaway server; download the `lore`/`loreserver` 0.10.x release binaries
    from GitHub Releases in the workflow), extension integration tests, and
    `vsce package --target win32-x64`. Upload the VSIX as an artifact. Add runners when more platforms
    are added.
  - No release or publish workflow yet. The CI VSIX artifacts are enough for local installs on other
    machines. Add `release.yml` only when §9.2 starts.

### 9.1 Local install (current distribution)

The maintainer uses the extension by installing a locally built VSIX into their normal VS Code. Nothing is
uploaded anywhere.

- `package.json` scripts, added in Phase 0:
  - `"package:local": "npm run build:prod && vsce package --target <host target> --out dist-vsix/"`. Use a
    tiny Node helper (`scripts/vsce-target.mjs`) that maps `process.platform`/`process.arch` to the vsce
    target (`win32-x64`, `linux-x64`, `linux-arm64` or `darwin-arm64`), so the same command works on any
    machine.
  - `"install:local": "node scripts/install-local.mjs"`. The script runs `package:local`, finds the VSIX
    it just produced (`dist-vsix/lore-scm-<target>-<version>.vsix`), and runs
    `code --install-extension <file> --force`. It prints a clear error if the `code` command isn't on
    PATH (on Windows it is by default; on macOS, run "Shell Command: Install 'code' command in PATH").
- Add `dist-vsix/` to `.gitignore` and `.vscodeignore`.
- **Never** pass `--no-dependencies` to vsce. The SDK, its platform package and koffi must be inside the
  VSIX.
- Build on the OS you'll run it on. `npm ci` installs only the host platform's `@lore-vcs/sdk-*` package,
  so a Windows-built VSIX doesn't work in WSL or on macOS.
- Update routine: bump the patch `version` in `package.json` (`0.1.0` → `0.1.1`; don't use pre-release
  suffixes like `-dev.1`, which vsce may reject), then run `npm run install:local` and reload the window
  (**Developer: Reload Window**). VS Code replaces the old version in place.
- Uninstall: `code --uninstall-extension alsimoes.lore-scm`.
- While developing, use F5 (Extension Development Host). When a phase passes its acceptance criteria,
  install the VSIX into your everyday VS Code and use it on real Lore projects. Record problems in
  GitHub Issues or `docs/dogfooding.md`.

### 9.2 Publishing (future releases, not started)

Start this only when the maintainer says so. Until then the agent must not create publisher accounts,
tokens, publish workflows or tags.

- **Open VSX first:**
  - One-time setup, done by the maintainer:
    1. Create an Eclipse account at https://open-vsx.org and sign the Publisher Agreement.
    2. Create an access token.
    3. Run `npx ovsx create-namespace alsimoes -p <token>`.
    4. Optionally request namespace verification.
  - Per release, for each target VSIX: `npx ovsx publish <file>.vsix -p $OVSX_PAT`. Open VSX supports
    platform-specific VSIXs; the target comes from the VSIX built with `vsce package --target`. Also
    publish the universal CLI-only VSIX.
  - Use `ovsx` (not `vsce publish`) as a devDependency. **Don't** add a Marketplace publishing job yet.
  - Reach: Open VSX serves VSCodium, Cursor, Windsurf, Gitpod, Eclipse Theia and other editors. Microsoft
    VS Code doesn't use it, so VS Code users install the VSIX from the GitHub Release. Keep the manifest
    Marketplace-ready (icon, `repository`, `license`, `categories: ["SCM Providers"]`, keywords
    `lore`, `vcs`, `scm`, `epic`, `unreal`) so adding the Marketplace later is only a new publish job.
- **VS Code Marketplace later:** create an Azure DevOps publisher with the **same**
  id (`alsimoes`), so the extension ID stays `alsimoes.lore-scm` in both galleries. Then add a second
  manual job using `vsce publish --packagePath`.

### 9.3 Versioning and branching

- **Versioning:** SemVer, starting at `0.1.0`. Pin `@lore-vcs/sdk` exactly. Record which SDK and Lore
  versions each extension release was tested with in the CHANGELOG. Renovate/Dependabot PRs for the SDK
  must run the full contract suite.
- **Branching: one PR per phase into `main`.**
  - For each phase, create a branch from the latest `main`, named `phase-<n>-<slug>` (for example
    `phase-0-scaffolding`, `phase-1-readonly-scm`).
  - Commit in small steps with Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
  - When the phase's acceptance criteria pass, push the branch and open a PR into `main` with
    `gh pr create`. The PR description lists each acceptance criterion with how it was verified, the
    spike findings or plan changes made in the phase, and anything that needs manual checking by the
    maintainer.
  - **The agent never merges PRs and never pushes to `main` directly.** The maintainer reviews, merges,
    and installs the result locally (§9.1). The next phase starts from the updated `main`.
  - If the maintainer requests changes, push fixes to the same branch.

---

## 10. Risks and open decisions

| Risk | Impact | Mitigation |
|---|---|---|
| **Lore is pre-1.0.** APIs, event shapes and error codes change between releases (error codes were renumbered once already) | Breakage on SDK upgrade | Exact pin. Keep the domain model separate from SDK types. Record fixtures. Run the contract suite on every SDK bump. Map error codes in one table |
| **The SDK loads a native library in the extension host.** A crash takes down all extensions | Severe UX impact | Lazy import. Defensive arguments. `loreScm.backend: "cli"` escape hatch. Offer the CLI backend automatically after a load failure |
| **An official Epic VS Code plugin is on the 2026 roadmap** | Duplicate effort; users may confuse the two | Distinct ID, prefix and scheme (see "Decisions already made" at the top), so the two can coexist. An "Unofficial" disclaimer and no Epic logos. When the official plugin ships, the maintainer decides to discontinue or keep this one. If it's discontinued before publishing, just archive the repo. If it's discontinued after publishing: publish a final version whose README points to the official extension, then deprecate the listing |
| **Dirty tracking relies on file watcher events**, which `files.watcherExclude`, network drives or huge trees can drop | Missed changes | Periodic `checkDirty`, a manual rescan, and a "changes found by scan that the watcher missed" hint |
| **Confirmed (S2):** staged-then-edited files are not distinguishable, and even report the staged (not disk) size under a scan | Wrong commit content, wrong displayed size | Re-stage on commit, default `true` (§6.2) |
| **Resolved (S6):** conflict mechanics — markers on disk, diff3-compatible, commit still required, but merge needs a configured remote even for local-only branches | N/A | See §6.10 and `docs/spike-findings.md` |
| No win32-arm64 / darwin-x64 SDK builds | Some future users lack the SDK path | Universal VSIX with the CLI backend (when publishing starts) |
| The zero-config server's store is temporary (cleared on reboot) | Lost work while dogfooding | Use the persistent dev server (`start-dev-server.ps1`) for real work, and the throwaway server only for tests |
| **Confirmed worse than assumed (S8):** locks are advisory — any identity can silently steal-acquire or release another identity's lock, with no ownership check observed | Users may expect enforcement | Wording ("informs, doesn't prevent"). Warn-on-edit is the *only* real protection, not a courtesy |
| Concurrency with the CLI (S5: no contention observed, but interleaved not simultaneous) or the Lore service (S14: not tested, starting the service would reconfigure the maintainer's machine — see §11.6) | Store lock errors | Retry with backoff regardless, as cheap insurance |

Former open decisions (ID, prefix, distribution, platform, server, license, git workflow) are now resolved; see "Decisions already made"
at the top of this document. Remaining items to settle when publishing starts (§9.2): the extension icon and the Open VSX namespace
setup (done by the maintainer).

---

## 11. Rules for the implementing agent

1. **Verify before you use.** Check every Lore function, argument and event field against the installed
   `.d.ts` files (§1). If something in this plan doesn't exist, find the closest real API, document the
   change in `docs/spike-findings.md`, and continue.
2. **Layering is enforced.** Only `src/lore/**` may import `@lore-vcs/sdk`. Add an ESLint
   `no-restricted-imports` rule for this.
3. **Copy SDK event data inside the callback.** Never keep a `LoreEventFFI` beyond its callback. Use
   `event.clone()` or map it to a domain object immediately.
4. **Async hygiene:** no floating promises (ESLint `@typescript-eslint/no-floating-promises`). Every
   disposable goes into `context.subscriptions` or a class `dispose()`.
5. **Destructive actions** (discard, reset sync, abort merge, archive branch, release others' locks)
   always need a modal confirmation, and none are bound to default keybindings.
6. **Never** log tokens or identity tokens. Never write to user-level Lore config. Never start or
   configure the Lore service.
7. Keep the UX close to the built-in Git extension's wording and placement, so users feel at home.
   Where Lore semantics differ (sync, amend, archive, locks), say so in the command title or tooltip.
8. Each PR-sized step must include tests for new pure logic, and must keep `npm run lint && npm test`
   green.
9. When blocked by missing server features (auth, notifications), implement against the contract, guard
   the feature by capability detection, and document the manual verification step.
10. Don't publish, tag releases, merge PRs, or push to `main`. Push only phase branches and open PRs
    (§9.3).

---

## 12. References

**Lore documentation** (https://epicgames.github.io/lore/)
- Quickstart: https://epicgames.github.io/lore/tutorials/quickstart/
- CLI command reference: https://epicgames.github.io/lore/reference/lore-cli-commands/
- CLI configuration: https://epicgames.github.io/lore/reference/lore-cli-config/
- Background service: https://epicgames.github.io/lore/tutorials/run-commands-through-the-service/
- Deploy a local server: https://epicgames.github.io/lore/how-to/deploy-local-lore-server/
- Install the CLI: https://epicgames.github.io/lore/how-to/install-lore-cli/
- System design: https://epicgames.github.io/lore/explanation/system-design/
- Glossary: https://epicgames.github.io/lore/glossary/
- Roadmap: https://epicgames.github.io/lore/roadmap/
- ADR-00009 (JS bindings, the VS Code motivation): https://epicgames.github.io/lore/developing/decisions/00009-lore-library-js-bindings/
- ADR-00017 (error detail on the Complete event): https://epicgames.github.io/lore/developing/decisions/00017-ffi-error-detail-on-complete-event/
- Error code allocation: https://epicgames.github.io/lore/developing/code-standards/errors/
- LEP "Modified file tracking" (dirty flags; why IDE integration must call `dirty`): `docs/proposals/2026-05-03-modified-file-tracking.md` in the Lore repo
- LEP "Successor locks for unmergeable files": `docs/proposals/2026-06-19-successor-locks-unmergeable-files.md`

**Source repositories**
- Lore (library, server, CLI): https://github.com/EpicGames/lore. See `lore-base/src/error.rs` (error
  codes), `lore-revision/src/event.rs` (`LoreEvent`, serde `tagName`/`data`),
  `lore-revision/src/metadata.rs` (reserved metadata keys), `lore-client/src/cli/` (the CLI is a
  consumer of the same API; a good reference for how to use each call).
- JS SDK: https://github.com/EpicGames/lore-js (npm `@lore-vcs/sdk`). See `examples/esm/example.ts`.
- Community: Discord https://discord.gg/E4SFJKRPbg · Issues https://github.com/EpicGames/lore/issues

**VS Code**
- Source Control API guide: https://code.visualstudio.com/api/extension-guides/scm-provider
- API reference (`scm`, `FileSystemProvider`, `FileDecorationProvider`, `TreeView`): https://code.visualstudio.com/api/references/vscode-api
- Contribution points: https://code.visualstudio.com/api/references/contribution-points
- `when` clause contexts (`scmProvider`, `scmResourceGroup`, …): https://code.visualstudio.com/api/references/when-clause-contexts
- Built-in Git extension source (the reference implementation to mirror): https://github.com/microsoft/vscode/tree/main/extensions/git
- Testing extensions: https://code.visualstudio.com/api/working-with-extensions/testing-extension
- Platform-specific extensions: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions
- Bundling with esbuild: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
