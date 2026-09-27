# Phase 0 spike findings

Run against `@lore-vcs/sdk@0.10.0` (koffi/native) and `lore.exe 0.10.0+1172-lore_v0.10.0__urc_main`
on Windows x64. Server-dependent spikes (S6-S10) ran against the maintainer's real, already-running
Lore server at `lore://argoneon:41337`, using disposable repositories named `vscode-ext-spike-*`
created for this purpose (not the maintainer's real projects). Those throwaway repos were deleted
from the server afterward where the delete succeeded (see S8/S10 notes for two that didn't).

Raw event JSON for every run is under `test/fixtures/events/`. Scripts are under `scripts/spike/`
and can be re-run with `npx tsx scripts/spike/<name>.ts`.

`loreserver.exe` (for `start-test-server.ps1` / `start-dev-server.ps1`) was **not installed** on
the maintainer's machine during Phase 0. Those two scripts are written defensively (they check for
the prerequisite and tell the maintainer to install it) but their actual `loreserver` invocation is
**unverified** — see the NOTE comments in each script. All spikes below instead used the
already-running `lore://argoneon:41337` server, which the maintainer pointed the agent at.

## S1 — Does the SDK load inside a Node/Electron host on win32-x64?

**Yes.** `await import('@lore-vcs/sdk')` loads cleanly in a plain Node 25 process in ~80ms, and
`lore.version()` reports `0.10.0+1172-lore_v0.10.0__urc_main`, exactly matching the installed
`lore.exe` CLI version. `lore.shutdown()` returns cleanly with no dangling handles or crash.

This was verified in plain Node, not inside the actual VS Code extension host (Electron), since
this environment can't launch an interactive Extension Development Host. Given koffi's native
loading mechanism is identical either way, this is strong evidence but not a substitute for a
manual F5 check — **the maintainer should still confirm "Lore SCM: Show Version" works after
installing the Phase 0 VSIX (Phase 0 AC)**.

Bonus finding: the version string contains `urc_main` — "URC" appears to be Lore's internal
codename (see also the `.urc/immutable/` and `.urc/mutable/` wording inside the SDK's own arg
comments, and the `.lore/` store's directory layout in S13). Irrelevant to the extension's design,
just an FYI so the naming doesn't look like a typo if it comes up again.

## S2 — Status semantics

Fixtures: `s2-*.json`.

- **`KEEP` (action `0`) does mean "modified".** A content-only edit to a committed file reports
  `action: KEEP` with `flagDirty: true`. Confirmed the plan's assumption.
- **Without `scan` or an explicit `fileDirty`/`checkDirty` call, `status({})` is completely blind**
  to an on-disk edit — it returns zero file events, not even a stale one. Confirmed exactly as the
  plan describes.
- **Staged-then-edited-again files are a single node with both flags set**
  (`flagStaged: true, flagDirty: true`), never split into two nodes. Confirms the plan's §6.2 LEP
  reference. **Additionally** (not previously known): the file's `size` (and presumably `hash`,
  though not directly observed) reported by `status`/`fileInfo` for such a node reflects the
  **staged** content, not the current on-disk bytes — even when the status call passes
  `scan: true`. Only `fileInfo`'s `localSize`/`localHash` (with the `local: true` **global** arg,
  not a call arg) reflect the live disk content. **This means `restageModifiedOnCommit` (§6.7) is
  not just a nice-to-have: without it, a commit will silently use stale staged bytes, and the UI's
  displayed size for such a resource would be wrong too if it trusts `status`'s `size` field.**
- **`checkDirty` does clear a stale dirty flag** when on-disk content is reverted to match the
  committed revision again (confirmed: after `fileDirty` on an unchanged file, then a genuine
  revert-to-original, `status({checkDirty:true})` reports zero changes for that file). Matches the
  plan's documentation of the flag.
- **A plain filesystem rename is reported as delete+add, not `MOVE`,** when detected via `scan`
  (`renameSync` outside of Lore's knowledge → old path shows `action: DELETE`, new path shows
  `action: ADD`). **This confirms why §6.3's plan to call `fileDirtyMove`/`fileStageMove` explicitly
  for VS Code-detected renames is necessary, not optional** — a scan alone never reconstructs a
  move from two independent add/delete detections.
- **`.loreignore` is respected**, but the event that reports it during `repositoryStatus` is
  `FILTER_EXCLUDE` (`tagName: "filterExclude"`, `{reason, path}`), not `PATH_IGNORE` as the plan's
  §2 table says. `PATH_IGNORE` may be used by a different code path (not exercised here) — treat
  `filterExclude` as the one to listen for during status/scan.

## S3 — Reading file content at a revision

Fixtures: `s3-*.json`.

- `fileWrite({path, revision, output})` works for: an exact hash, `branch@LATEST`, `branch@N`, and
  an empty string (resolves to the current revision).
- **There is no "staged" revision keyword.** Both `"STAGED"` and `"staged"` fail with
  `Lore error 88: revision not found`. The plan's own fallback for this case (§6.6: "Fall back to
  the working file if S3 finds no way to read staged content") is therefore **required, not
  optional** — implement the Staged diff as `vscode.diff(lore ~HEAD, file:)` in practice, same as
  Changes, or clearly document that the "Staged" diff view can show stale content if the file was
  edited again after staging (see S2).
- `fileInfo` with **`local: true` passed as a global arg** (not a call arg — it's declared on
  `LoreGlobalArgs`) returns `hash`/`size` (committed revision) and `localHash`/`localSize` (current
  disk), plus `flagModified`/`flagAdded`/`flagDeleted`/`flagConflict`. It does **not** expose a
  separate "staged hash", consistent with the point above.

## S4 — `lore --json` output and `parseLoreEventJSON`

Fixtures: `create.jsonl`, `status.jsonl` (ad hoc, not under `test/fixtures/events/`, see the CLI
transcript in this doc's git history if needed — the important facts are below and are stable).

- One JSON object per line, shape `{"tagName": "...", "data": {...}}`, same tag names as the SDK.
- **`parseLoreEventJSON` is not exported from the package root.** It's at the subpath
  `@lore-vcs/sdk/types/events` (per the package's `exports` map — there's also `@lore-vcs/sdk/types`,
  `@lore-vcs/sdk/types/args`, `@lore-vcs/sdk/types/enums`, `@lore-vcs/sdk/functions`, and
  `@lore-vcs/sdk/native`). Import it as
  `import { parseLoreEventJSON } from '@lore-vcs/sdk/types/events'`.
- `parseLoreEventJSON` **does** convert the CLI's string enum values (e.g. `"action": "add"`) to
  the same numeric enum values the SDK's own FFI events use (`1`), and adds the numeric `tag`
  field. **It does not** convert the CLI's numeric booleans (`"isLocalAhead": 0`) to real
  JS booleans — those stay `0`/`1` on revision-level fields, even though the CLI already emits real
  `true`/`false` for per-file flags (`flagStaged`, `flagDirty`, etc.) in the same JSON. **This is an
  inconsistency `CliBackend`'s event mapping must account for**: coerce `LoreRepositoryStatusRevisionEventData`'s
  boolean-ish numeric fields explicitly; don't assume `parseLoreEventJSON` normalizes them.
- No `LOG`/`END` lines were observed in the plain CLI `--json` transcripts captured here (only the
  domain events plus a final `complete`). Worth re-confirming with `-d`/`--debug` if `CliBackend`
  needs those tags specifically (Phase 6).

## S5 — Concurrency between the extension (SDK) and a CLI process

Fixtures: none (console-only spike; see `scripts/spike/s5-concurrency.ts`).

No "store busy" or lock-contention error was observed in either configuration tested:
- Without `storeKeepAlive`, an SDK `repositoryStatus` call and a concurrent CLI `status` both
  succeeded.
- With `storeKeepAlive: true, storeKeepAliveSeconds: 5` held from the SDK side, a CLI `dirty`,
  `status`, `stage`, and `commit` **all succeeded** while the keep-alive window was active.

Caveat: `execFileSync` is synchronous, so the CLI calls were interleaved with, not literally
overlapping, the SDK's async operations — this doesn't prove there's no race under true
simultaneous access (e.g., two writes landing in the same instant). **Recommendation: keep the
plan's defensive retry-with-backoff for error codes 30/31/32 (§6.14) even though this specific
spike didn't reproduce contention** — it's cheap insurance the spike couldn't fully rule out.

## S6 — Conflicts

Fixtures: `s6-*.json`. Required the real server — see below.

- **`branchMergeStart` requires a configured remote, even to merge two fully local branches in the
  same working tree.** On a purely `offline: true` repository it fails immediately with
  `Lore error 111: No remote configured` (trace: `branch/merge.rs:462 "acquiring remote"`). Redone
  against `lore://argoneon:41337` and it worked. **This is a plan-relevant constraint**: an
  offline-only Lore repository (no remote at all) cannot use branch merge, revert, or (presumably)
  anything else that internally "acquires remote" — worth a line in the README/troubleshooting and
  in any future offline-mode UX.
- **Conflict markers are written to disk**, in standard diff3 form:
  ```
  <<<<<<< ours
  MAIN CHANGE
  ||||||| original
  line2
  =======
  FEATURE CHANGE
  >>>>>>> theirs
  ```
  This is close enough to Git's own `merge=diff3` conflict style that **VS Code's built-in merge
  conflict CodeLens/decorations work against it with no custom provider** — confirmed by inspection
  of the marker format (`<<<<<<<`/`|||||||`/`=======`/`>>>>>>>`, which is exactly what VS Code's
  built-in Git extension's conflict detection regexes match).
- Status flags on the conflicted-then-resolved file matched the plan's §6.2 table exactly:
  `flagConflict: true, flagConflictUnresolved: false, flagConflictTheirs: true, flagStaged: true,
  flagMerged: true` after `branchMergeResolveTheirs`.
- **`fileDiff({paths, diff3: true})` did *not* work on an in-progress conflicted file** — it
  returned only `filterExclude` events for that path (the file appears to be excluded from `fileDiff`
  while unresolved). Fortunately this doesn't block the merge editor idea in §6.10, since the
  on-disk markers already carry all three sides (`original`=base, `ours`=mine, `theirs`=theirs) —
  **read them directly from the working file with a marker parser instead of calling `fileDiff`
  during a conflict.** If a real 3-way *merge editor* (not just markers) is built in Phase 3, this
  needs its own follow-up spike.
- **A commit is required after resolving** — `branchMergeResolveTheirs` alone leaves the resolved
  content staged (`flagStaged: true`); `revisionCommit` after that produces a two-parent revision
  (`parent` + `parentOther` in `revisionCommitRevision`), confirming the merge parent structure the
  plan assumed.
- `branchInfo` on the branch that was merged *into* (`main`) reports `branchPoint: 0000...0000`
  (main has no parent branch, so this is expected) — **not re-tested on the `feature` branch
  itself**, which is where a real `branchPoint` would appear. Follow up before building the merge
  editor's base-input resolution in §6.10 if `fileDiff diff3` remains unusable — the two-parent
  commit hash pair from `revisionCommitRevision`/`revisionHistory` is a viable alternative common-
  ancestor source that doesn't depend on `branchPoint` at all.

## S7 — History metadata

Fixtures: `s7-*.json`.

- `REVISION_HISTORY_ENTRY` is followed by exactly one `METADATA` event per reserved key present:
  `branch`, `timestamp`, `message`, `created-by`, `committed-by` (in that order) for a normal
  commit.
- **Metadata values are a tagged union, not a plain value**: `{ tag, tagName, data }`, where
  `tagName` is `"string"` (message, created-by, committed-by), `"numeric"` (timestamp), or
  `"context"` (branch, a hex id). **`eventMapping.ts` must unwrap `.data` by `tagName`**, not assume
  a plain JS value.
- **`timestamp` is milliseconds since the Unix epoch** (confirmed both from the metadata value and
  from `LoreRevisionHistoryArgs.date`'s doc comment, which says the same).
- Multi-line commit messages round-trip correctly (embedded `\n` preserved).
- **`authLocalUserInfo` failed in both configurations tested**: `Lore error 111: No remote
  configured` on a fully offline repo, and `Lore error 9: Operation not supported: authentication
  requires a configured auth endpoint` against `lore://argoneon:41337` (which has no OIDC/auth
  endpoint configured — it's a genuinely unauthenticated demo-style server). **On a server like
  this, author-name resolution has no working path at all** (`authUserInfo` would need the same
  auth endpoint and presumably fails identically) — §6.11's fallback chain "authUserInfo →
  authLocalUserInfo → raw id" **will bottom out at the raw id** (here, the free-form `identity`
  string passed in `LoreGlobalArgs.identity`, e.g. `"spike-tester"`) on any server without a real
  auth endpoint. Make sure the History view's author display handles a raw identity string
  gracefully as the common case, not just as a rare fallback.

## S8 — Locks

Fixtures: `s8-*.json`. Two identities (`alice`, `bob`) against `lore://argoneon:41337`.

Locks are **even more advisory than the plan assumed**:
- Bob was able to `lockFileAcquire` the **same path Alice already locked** — it succeeds silently
  (`lockFileAcquireBegin.ignored: true`, `status: 0`), it does not queue or fail.
- Bob was able to edit the locked file, commit, and **push successfully** — the lock had zero
  effect on push.
- **Bob was able to `lockFileRelease` Alice's lock with no owner check at all**
  (`lockFileReleaseBegin.notFound: false`, `status: 0`) — there is no "you don't own this lock"
  error in this configuration. This is a bigger gap than "informs, doesn't prevent": **any user can
  silently release any other user's lock**, so the extension's own confirmation dialogs (§6.12) are
  the *only* protection a user has, not a UX nicety layered on top of real enforcement.
- `lockFileStatus`/`lockFileQuery`'s `owner` field on this server prints the **literal string
  `"<unknown>"`**, not `"alice"` or a resolvable id, consistent with S7's finding that this server
  has no working identity resolution. **The Locks view and lock decorations (§6.12) must handle
  `owner === "<unknown>"` as a normal, expected value** (show something like "locked by an unknown
  user"), not just as an edge case.
- `lockedAt` is milliseconds since epoch (same convention as S7's `timestamp`).
- One of the two throwaway repos used for this spike (`vscode-ext-spike-s8-*`) could not be deleted
  afterward — `lore repository delete` returned `Not authorized to access repository` when run
  under the shell's default identity, apparently because the repo remembers the identity
  (`alice`/`bob`) it was created/owned under. It's a harmless empty test repo left on
  `lore://argoneon:41337`; the maintainer can remove it manually if desired.

## S9 — Notifications

Fixtures: `s9-notification-events.json`.

- `notificationSubscribe(globals, {}).asyncIter()` **does stay open past its own `complete`
  event** — `complete`/a `notificationSubscribed` event fire almost immediately, but the same
  async generator keeps yielding further events (branch-pushed, etc.) indefinitely afterward. This
  confirms the plan's assumption that it's a long-lived stream, not a one-shot call.
- **Events do arrive for another instance's push**: pushing from a second cloned working tree (via
  the CLI) produced a `notificationBranchPushed` event in the first (subscribed) instance's stream
  within ~1.5s.
- Whether a push from the *same, subscribed* instance also produces a self-notification was
  **not conclusively tested** — the spike script's own follow-up push failed for unrelated reasons
  (it tried to stage a new file while a previous commit's sync was still needed, producing
  "Unable to sync when there is a staged state" then "Branch has diverged"; a scripting mistake in
  the spike, not a Lore finding). Worth a quick re-check in Phase 5 if the "does my own push show up
  as incoming" question matters for `notifications.showIncoming` (§6.12) — the safe default is to
  assume it does not (filter self-originated pushes some other way, or don't rely on that
  distinction being made for you).
- **Clean shutdown confirmed**: calling `notificationUnsubscribe(globals, {})` causes the *same*
  `asyncIter()` from the original `notificationSubscribe` call to receive a
  `notificationUnsubscribed` event followed by `end`, and the generator then finishes. `deactivate()`
  can rely on this — no separate cleanup call is needed beyond `notificationUnsubscribe`.

## S10 — Remote state

Fixtures: `s10-*.json`.

- The maintainer's server (`lore://argoneon:41337`) has **no auth configured** —
  `repositoryCreate`/`branchPush` succeeded with an arbitrary `identity` string and no login step
  at all (`remoteAuthorized: true` in the status response with no prior `authLogin*` call).
- `repositoryStatus` with `{remote: true}` vs `{local: true}` (both as **global** args) took ~9ms
  and ~11ms respectively in this run — no meaningful difference, but this is a same-LAN server;
  it doesn't rule out `remote: true` making a real network round-trip against a slower/remote
  server. Use `local: true` for the cheap "don't hit the network" case per the plan regardless,
  since it's the more conservative choice and costs nothing here.
- **Revision numbers are contiguous and comparable across local/remote** in the simple case tested:
  after a push, `revisionLocalNumber === revisionRemoteNumber === 1`. The plan's ahead/behind-by-
  subtraction approach (§6.8) is viable for the simple case; multi-branch or divergent-history edge
  cases were not tested here.
- One throwaway repo (`vscode-ext-spike-1758...`, the very first one created, before the
  per-spike naming convention below was adopted) was deleted successfully after use.

## S11 — Branch creation

Fixtures: `s11-*.json`.

- **`branchCreate` switches to the new branch automatically** — confirmed via `branchList`
  (`main.isCurrent` flips to `false`, the new branch's `isCurrent` is `true`) and via a `status`
  call immediately after, whose `branchName` is already the new branch. §6.9's "Phase 0 checks
  whether create also switches... If it doesn't, follow with branchSwitch" — **it does, so no
  follow-up `branchSwitch` call is needed** after `branchCreate`.
- **Branch name validation is essentially nonexistent server-side.** Only an empty string is
  rejected (`Lore error -1: creating branch: Invalid name`). Names containing spaces
  (`"bad name with spaces"`), path-traversal-looking segments (`"has/../traversal"`), and a 300-
  character name were all **accepted**. **The extension should apply its own client-side validation
  before calling `branchCreate`** (§6.9) if clean branch names matter for the UI/URLs/CLI
  round-tripping — don't rely on Lore to reject anything but an empty name.
- `created` timestamps on branches are milliseconds since epoch (consistent with S7/S8).

## S12 — Cancellation

No cancellation/abort API exists for an in-flight call (only the domain-specific "abort a
merge/revert", which is a different concept — it aborts the *merge state*, not a running network
call). Confirmed by grepping the SDK's shipped type declarations and compiled output for
`cancel`/`abort`/`AbortSignal` outside of the known merge/revert/cherry-pick abort functions: no
matches. `lore.shutdown()`'s effect on a pending `waitAsync()`/`collectAsync()` promise was not
experimentally verified (would require killing the process mid-call, which risks corrupting the
throwaway store and wasn't judged worth the risk for a "no cancellation API" answer that's already
clear from the type surface). **Design stands as planned: show non-cancellable progress for long
operations (push, sync, clone).**

## S13 — Which files under `.lore/` change per operation

Fixtures: none (console-only; see `scripts/spike/s13-lore-dir-changes.ts` and
`s13b-config-toml-check.ts`).

**§6.4's plan to "narrow the glob if possible" does not pan out.** The `.lore/immutable/` and
`.lore/mutable/` directories are a content-addressed, sharded key-value store (subdirectories named
by hex hash prefix, e.g. `immutable/index/7f/{index_00,level,pack/1}`). Every single operation
tested — `fileDirty`, `fileStage`, `revisionCommit`, `branchCreate`, `branchSwitch` — touched a
**different, unpredictable set of shard files** (which prefix folders get touched depends on the
content hashes involved), including short-lived `*.pending`/`*.new` marker files that are created
and removed again within the same operation (this raced with the spike's own before/after
`stat()` snapshot, which is itself evidence of how transient they are). Static, top-level files
(`.lore/config.toml`, `.lore/id`, `.lore/instance`) were present but **never observed to change**
across any of the tested operations, so they're not useful "something happened" signals either.

**Plan amendment for §6.4**: keep watching `.lore/**` as originally planned, but drop the idea of
narrowing the glob — there is no stable subset of paths that correlates with "a write happened."
The existing debounce-and-refresh-after-500ms design already tolerates a noisy watcher; that's the
real defense here, not glob narrowing.

## S14 — Background service interplay

**Not tested.** Exercising `LORE_USE_SERVICE=1` requires a running, configured Lore background
service (`lore service start`, `lore service set-use-automatically`), and PLAN.md §11.6 and §6.16
explicitly forbid the extension (and by extension, spikes run in its name) from starting or
configuring that service, since doing so changes the maintainer's persistent, machine-wide Lore
configuration. Starting it "just for a spike" would have exactly that side effect. **Recommendation:
verify this manually, if and when the maintainer already runs the Lore service for their own
reasons** — don't have the extension or its test suite start one.

## Summary of plan amendments

1. **§2 / §6.2**: the ignore-filter event during status/scan is `FILTER_EXCLUDE`
   (`tagName: "filterExclude"`), not `PATH_IGNORE`.
2. **§3.4**: `parseLoreEventJSON` lives at `@lore-vcs/sdk/types/events`, not the package root.
   `CliBackend` must import it from there, and must additionally coerce numeric 0/1 booleans on
   revision-status-shaped events (parseLoreEventJSON does not do this, unlike its numeric-enum
   conversion for fields like `action`).
3. **§4.3 / eventMapping**: `METADATA` event values are `{tag, tagName, data}`, not plain values.
   Unwrap by `tagName` (`"string"` | `"numeric"` | `"context"`, at least).
4. **§6.2**: a staged-then-edited node's `size` (and likely `hash`) reflects the *staged* content
   even under `status({scan:true})`; only `fileInfo`'s `localSize`/`localHash` (with `local: true`
   as a **global** arg) reflect current disk content. This strengthens the case for
   `restageModifiedOnCommit` defaulting to `true`.
5. **§6.3**: confirmed (not a change) that plain filesystem renames scan as delete+add, which is
   exactly why explicit `fileDirtyMove`/`fileStageMove` calls for VS Code-detected renames are
   required, not an optimization.
6. **§6.4**: drop "narrow the glob if possible" — the store's content-addressed shard files make
   this impractical. Keep watching `.lore/**` with the existing debounce.
7. **§6.6**: the "fall back to the working file" path for the Staged diff view is **required**
   (there is no `fileWrite` revision keyword for staged content), not just a fallback for an edge
   case S3 might not find.
8. **§6.10**: `fileDiff({diff3:true})` does not work on an in-progress conflicted file; read the
   on-disk conflict markers directly instead (they use standard `<<<<<<</|||||||/=======/>>>>>>>`
   syntax, compatible with VS Code's built-in merge conflict UI with no custom provider needed).
   Re-derive base/mine/theirs from the markers or from the two-parent commit rather than from
   `fileDiff diff3` or (untested) `branchPoint`.
9. **New constraint**: `branchMergeStart` (and likely revert/cherry-pick) requires a configured
   remote even for a fully local, two-branch merge. A `repositoryCreate({offline:true})` repository
   cannot merge branches. Document this in the README/troubleshooting.
10. **§6.11 / §6.12**: on a server with no auth endpoint configured (a real, expected scenario, not
    just this demo server), author-name and lock-owner resolution both bottom out at a raw
    string — a free-form `identity` for authors, and the **literal string `"<unknown>"`** for lock
    owners. Both need first-class (not fallback-only) handling in the UI.
11. **§6.9**: `branchCreate` already switches to the new branch — no follow-up `branchSwitch` call
    needed. Branch name validation must be done client-side; the server accepts almost anything
    except an empty string.
12. **§6.12**: locks are more advisory than described — any identity can silently steal-acquire or
    release another identity's lock, with no ownership check observed. The extension's own
    confirmation dialogs are the only real protection, not a courtesy on top of enforcement.
