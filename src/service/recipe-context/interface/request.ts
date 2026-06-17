// RecipeContext request canonicalization. Validates the request kind and that
// the payload is a plain object; per-field payload parsing happens defensively
// inside each handler (deterministic invalid-payload diagnostics).

import {
  isRecipeContextRequestKind,
  type RecipeContextQueryError,
  type RecipeContextQueryErrorCode,
  type RecipeContextRequest,
  type RecipeContextRequestKind,
} from '../../../domain/recipe-context/index.js';
import type { CanonicalRecipeContextRequest } from './contracts.js';

export class RecipeContextRequestError extends Error {
  readonly queryError: RecipeContextQueryError;
  readonly queryKind: RecipeContextRequestKind;

  constructor(queryError: RecipeContextQueryError, queryKind: RecipeContextRequestKind = 'detail') {
    super(queryError.message);
    this.name = 'RecipeContextRequestError';
    this.queryError = queryError;
    this.queryKind = queryKind;
  }
}

export function canonicalizeRecipeContextRequest(
  input: RecipeContextRequest
): CanonicalRecipeContextRequest {
  if (!input || typeof input !== 'object') {
    throwRequestError('invalid-request-kind', 'RecipeContext request must be an object.');
  }

  if (!isRecipeContextRequestKind(input.kind)) {
    throwRequestError(
      'invalid-request-kind',
      `Unsupported RecipeContext request kind: ${String(input.kind)}.`
    );
  }

  const payload = input.payload;
  if (
    payload !== undefined &&
    (typeof payload !== 'object' || payload === null || Array.isArray(payload))
  ) {
    throwRequestError('invalid-payload', 'RecipeContext payload must be an object.', input.kind);
  }

  return {
    kind: input.kind,
    payload: (payload as Record<string, unknown> | undefined) ?? {},
  };
}

function throwRequestError(
  code: RecipeContextQueryErrorCode,
  message: string,
  queryKind: RecipeContextRequestKind = 'detail'
): never {
  throw new RecipeContextRequestError(
    { code, message, retryable: false, severity: 'error' },
    queryKind
  );
}
