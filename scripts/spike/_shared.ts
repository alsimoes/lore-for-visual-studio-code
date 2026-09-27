// Shared helpers for Phase 0 spike scripts (PLAN.md §7 Phase 0, task 3).
// Run with: npx tsx scripts/spike/<name>.ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Exploratory spikes call dozens of differently-shaped lore.<fn> functions (some take
// (globals, args), some take nothing, like version()/shutdown()); typing each one isn't worth
// it here, hence `any`.
export type SpikeLore = Record<string, (...args: any[]) => any>;

export async function loadSdk(): Promise<SpikeLore> {
  const sdk = await import('@lore-vcs/sdk');
  return sdk.lore;
}

export function fixturePath(name: string): string {
  const dir = join(process.cwd(), 'test', 'fixtures', 'events');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.json`);
}

export function writeFixture(name: string, events: unknown[]): void {
  writeFileSync(fixturePath(name), JSON.stringify(events, null, 2) + '\n', 'utf8');
  console.log(`  -> wrote ${events.length} events to test/fixtures/events/${name}.json`);
}

/** Runs a fluent lore.<fn>(globals, args) call and collects every event via collectAsync(). */
export async function runCollect(
  lore: SpikeLore,
  fnName: string,
  globals: object,
  args: object,
): Promise<unknown[]> {
  const fn = lore[fnName];
  if (!fn) {
    throw new Error(`lore.${fnName} does not exist on the installed SDK`);
  }
  try {
    return await fn(globals, args).collectAsync();
  } catch (err) {
    // LoreError carries .events (the events observed before failure) - surface those too.
    const events = (err as { events?: unknown[] }).events;
    console.error(`  ! lore.${fnName} threw:`, err);
    if (events) {
      return events;
    }
    throw err;
  }
}

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function newCorrelationId(): string {
  return randomUUID();
}

export function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
