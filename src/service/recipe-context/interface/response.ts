// RecipeContext envelope construction. De-duplicates refs and sorts the
// deterministic diagnostics so identical reads produce byte-identical envelopes.

import {
  RECIPE_CONTEXT_CONTRACT_VERSION,
  type RecipeContextEnvelope,
  type RecipeContextQueryError,
  type RecipeContextRef,
  type RecipeContextRequestKind,
  type RecipeContextResult,
  type RecipeContextUnavailableData,
} from '../../../domain/recipe-context/index.js';
import { selectRecipeContextRefs } from './refs.js';

export interface RecipeContextEnvelopeInput {
  data: RecipeContextResult;
  errors?: RecipeContextQueryError[];
  queryKind: RecipeContextRequestKind;
  refs?: RecipeContextRef[];
}

export function createRecipeContextEnvelope(
  input: RecipeContextEnvelopeInput
): RecipeContextEnvelope<RecipeContextResult> {
  const refs = selectRecipeContextRefs(input.refs);
  const errors = sortQueryErrors(input.errors ?? []);
  const envelope: RecipeContextEnvelope<RecipeContextResult> = {
    contractVersion: RECIPE_CONTEXT_CONTRACT_VERSION,
    data: input.data,
    queryKind: input.queryKind,
    refs,
  };

  if (errors.length > 0) {
    envelope.errors = errors;
  }

  return envelope;
}

export function createUnavailableRecipeContextData(
  kind: string,
  reason: string
): RecipeContextUnavailableData {
  return {
    available: false,
    kind,
    nextRefs: [],
    reason,
  };
}

function sortQueryErrors(errors: readonly RecipeContextQueryError[]): RecipeContextQueryError[] {
  return [...errors].sort((left, right) => {
    const codeOrder = left.code.localeCompare(right.code);
    if (codeOrder !== 0) {
      return codeOrder;
    }
    return left.message.localeCompare(right.message);
  });
}
