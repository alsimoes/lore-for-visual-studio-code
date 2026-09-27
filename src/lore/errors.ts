export type LoreErrorCategory =
  | 'input'
  | 'auth'
  | 'connectivity'
  | 'repositoryState'
  | 'alreadyExists'
  | 'notFound'
  | 'configuration'
  | 'resourceLimits'
  | 'libraryLifecycle'
  | 'internal'
  | 'unknown';

/**
 * Named error codes from Lore's error range table (docs/developing/code-standards/errors.md in
 * the Lore repo, verified against lore-base/src/error.rs at commit a0286e9). Re-verify against
 * the SDK version pinned in package.json before relying on a code not listed here.
 */
export const LORE_ERROR_NAMES: Record<number, string> = {
  16: 'NotAuthenticated',
  17: 'NotAuthorized',
  18: 'TokenNotFound',
  19: 'WriteRequired',
  28: 'Disconnected',
  29: 'NotConnected',
  30: 'Maintenance',
  31: 'SlowDown',
  32: 'ServiceUnavailable',
  40: 'NothingStaged',
  41: 'BranchAdvanced',
  42: 'Divergent',
  43: 'Conflict',
  44: 'LocalModifications',
  45: 'LockNotOwned',
  47: 'DeleteProtected',
  48: 'DeleteCurrent',
  49: 'DeleteDefault',
  57: 'BranchAlreadyExists',
  89: 'RepositoryNotFound',
  110: 'MissingIdentity',
  111: 'NoRemote',
  193: 'ShutDown',
};

function classify(code: number): LoreErrorCategory {
  if (code === -1) return 'internal';
  if (code >= 3 && code <= 15) return 'input';
  if (code >= 16 && code <= 27) return 'auth';
  if (code >= 28 && code <= 39) return 'connectivity';
  if (code >= 40 && code <= 55) return 'repositoryState';
  if (code >= 56 && code <= 63) return 'alreadyExists';
  if (code >= 79 && code <= 99) return 'notFound';
  if (code >= 110 && code <= 117) return 'configuration';
  if (code >= 118 && code <= 125) return 'resourceLimits';
  if (code >= 193 && code <= 200) return 'libraryLifecycle';
  return 'unknown';
}

export class LoreOperationError extends Error {
  readonly code: number;
  readonly errorName: string | undefined;
  readonly operation: string;
  readonly correlationId: string;
  readonly category: LoreErrorCategory;

  constructor(params: { code: number; message: string; operation: string; correlationId: string }) {
    super(params.message);
    this.name = 'LoreOperationError';
    this.code = params.code;
    this.errorName = LORE_ERROR_NAMES[params.code];
    this.operation = params.operation;
    this.correlationId = params.correlationId;
    this.category = classify(params.code);
  }
}

/** Converts whatever a backend call threw into a LoreOperationError. */
export function toLoreOperationError(
  err: unknown,
  operation: string,
  correlationId: string,
): LoreOperationError {
  if (err instanceof LoreOperationError) {
    return err;
  }
  if (err && typeof err === 'object' && 'returnCode' in err) {
    const loreError = err as { returnCode: number; errorDetail?: { message?: string }; message?: string };
    return new LoreOperationError({
      code: loreError.returnCode,
      message: loreError.errorDetail?.message ?? loreError.message ?? 'Unknown Lore error',
      operation,
      correlationId,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new LoreOperationError({ code: -1, message, operation, correlationId });
}
