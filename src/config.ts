import * as vscode from 'vscode';
import type { BackendSetting } from './lore/backendFactory.js';

export type AutoRepositoryDetection = boolean | 'subFolders' | 'openEditors';
export type ScanOnOpen = 'auto' | 'always' | 'never';
export type CountBadge = 'all' | 'tracked' | 'off';
export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

function get<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('loreScm').get<T>(key, fallback);
}

export const config = {
  get enabled(): boolean {
    return get('enabled', true);
  },
  get backend(): BackendSetting {
    return get<BackendSetting>('backend', 'auto');
  },
  get libraryPath(): string | undefined {
    return get<string | null>('libraryPath', null) ?? undefined;
  },
  get autoRepositoryDetection(): AutoRepositoryDetection {
    return get<AutoRepositoryDetection>('autoRepositoryDetection', true);
  },
  get repositoryScanMaxDepth(): number {
    return get('repositoryScanMaxDepth', 1);
  },
  get repositoryScanIgnoredFolders(): string[] {
    return get('repositoryScanIgnoredFolders', ['node_modules', '.git']);
  },
  get scanOnOpen(): ScanOnOpen {
    return get<ScanOnOpen>('scanOnOpen', 'auto');
  },
  get scanSlowThresholdMs(): number {
    return get('scanSlowThresholdMs', 10000);
  },
  get autorefresh(): boolean {
    return get('autorefresh', true);
  },
  get statusLimit(): number {
    return get('statusLimit', 10000);
  },
  get countBadge(): CountBadge {
    return get<CountBadge>('countBadge', 'all');
  },
  get openDiffOnClick(): boolean {
    return get('openDiffOnClick', true);
  },
  get quickDiffMaxSize(): number {
    return get('quickDiffMaxSize', 5242880);
  },
  get logLevel(): LogLevel {
    return get<LogLevel>('logLevel', 'info');
  },
};
