import * as vscode from 'vscode';

export const LORE_SCM_SCHEME = 'lore-scm';

/** `ref` is a full revision hash, or the literal `~HEAD` for the current revision. */
export interface LoreUriParams {
  root: string;
  ref: string;
}

export function toLoreUri(fsPath: string, params: LoreUriParams): vscode.Uri {
  return vscode.Uri.from({
    scheme: LORE_SCM_SCHEME,
    path: fsPath,
    query: JSON.stringify(params),
  });
}

export function fromLoreUri(uri: vscode.Uri): LoreUriParams & { path: string } {
  const params = JSON.parse(uri.query) as LoreUriParams;
  return { root: params.root, ref: params.ref, path: uri.path };
}
