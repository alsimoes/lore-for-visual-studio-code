import * as vscode from 'vscode';
import type { RepositoryManager } from '../repository/repositoryManager.js';
import type { Repository } from '../repository/repository.js';
import type { LoreResource } from '../scm/resource.js';

export function resolveRepository(arg: unknown, repos: RepositoryManager): Repository | undefined {
  if (arg && typeof arg === 'object' && 'rootUri' in arg) {
    const rootUri = (arg as vscode.SourceControl).rootUri;
    if (rootUri) {
      return repos.getRepositoryForUri(rootUri);
    }
  }
  return undefined;
}

/**
 * VS Code passes SCM resource-state commands either a single resource plus an array of every
 * selected resource (multi-select on `scm/resourceState/context`), or the resource group itself
 * (`scm/resourceGroup/context`, e.g. "Stage All Changes"). Normalizes both into a flat list.
 */
export function resourcesFromArgs(first: unknown, rest: unknown): LoreResource[] {
  if (first && typeof first === 'object' && 'resourceStates' in first) {
    return (first as vscode.SourceControlResourceGroup).resourceStates as LoreResource[];
  }
  if (Array.isArray(rest) && rest.length > 0) {
    return rest as LoreResource[];
  }
  if (first) {
    return [first as LoreResource];
  }
  return [];
}

export interface ResolvedResources {
  repo: Repository;
  resources: LoreResource[];
}

export function resolveResources(first: unknown, rest: unknown, repos: RepositoryManager): ResolvedResources | undefined {
  const resources = resourcesFromArgs(first, rest);
  if (resources.length === 0) {
    return undefined;
  }
  const repo = repos.getRepositoryForUri(resources[0].resourceUri);
  if (!repo) {
    return undefined;
  }
  return { repo, resources };
}
