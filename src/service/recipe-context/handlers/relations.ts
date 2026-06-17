// relations handler: breadth-first relation-chain expansion from a root recipe,
// hop- and fanout-bounded, cycle-safe per path. Conflict / deprecated /
// alternative edges are flagged neutral-or-caution. Sinks the Plugin
// RecipeRelationChainProvider read logic into Core, sourcing edges from the
// recipe's own relation buckets via the read port.

import type {
  RecipeContextRef,
  RecipeRecord,
  RecipeRelationChainView,
  RecipeRelationContext,
  RecipeRelationStep,
} from '../../../domain/recipe-context/index.js';
import type { RecipeContextHandler } from '../interface/contracts.js';
import { invalidPayloadDiagnostic, notFoundDiagnostic } from '../interface/diagnostics.js';
import { normalizeRecipeRef, relationRef } from '../interface/refs.js';
import { createUnavailableRecipeContextData } from '../interface/response.js';
import type { RecipeContextDeps } from '../ports.js';
import { clampInteger, readNumber, readString, readStringArray } from './payload.js';
import { failureResult, relationScoreImpact } from './shared.js';

interface FrontierNode {
  record: RecipeRecord;
  hops: string[];
  steps: RecipeRelationStep[];
}

export function makeRelationsHandler(deps: RecipeContextDeps): RecipeContextHandler {
  return async (request) => {
    const rawRef = readString(request.payload, 'ref');
    if (!rawRef) {
      return failureResult(
        'relations',
        invalidPayloadDiagnostic('relations requires payload.ref (a recipe id or ref).')
      );
    }

    const rootId = normalizeRecipeRef(rawRef);
    const maxHops = clampInteger(readNumber(request.payload, 'maxHops'), 1, 5, 2);
    const fanout = clampInteger(readNumber(request.payload, 'fanout'), 1, 20, 5);
    const relationTypes = readStringArray(request.payload, 'relationTypes');
    const relationFilter = relationTypes ? new Set(relationTypes) : null;

    const root = await deps.read.getRecipe(rootId);
    if (!root) {
      return {
        data: createUnavailableRecipeContextData('relations', `Recipe ${rootId} not found.`),
        errors: [notFoundDiagnostic(rootId)],
        refs: [],
      };
    }

    const refs: RecipeContextRef[] = [root.ref];
    const chains: RecipeRelationChainView[] = [];
    const expanded = new Set<string>([rootId]);
    const frontier: FrontierNode[] = [{ hops: [rootId], record: root, steps: [] }];

    while (frontier.length > 0) {
      const node = frontier.shift();
      if (!node || node.steps.length >= maxHops) {
        continue;
      }

      const edges = node.record.relations
        .filter((edge) => !relationFilter || relationFilter.has(edge.type))
        .slice(0, fanout);

      for (const edge of edges) {
        const targetId = normalizeRecipeRef(edge.target);
        if (!targetId || node.hops.includes(targetId)) {
          continue; // skip empty targets and cycles within this path
        }

        const ref = relationRef(node.record.id, targetId, edge.type);
        refs.push(ref);

        const step: RecipeRelationStep = {
          fromRecipeId: node.record.id,
          relationType: edge.type,
          scoreImpact: relationScoreImpact(edge.type),
          toRecipeId: targetId,
        };
        const hops = [...node.hops, targetId];
        const steps = [...node.steps, step];
        chains.push({ hops, steps });

        if (steps.length < maxHops && !expanded.has(targetId)) {
          expanded.add(targetId);
          const targetRecord = await deps.read.getRecipe(targetId);
          if (targetRecord) {
            frontier.push({ hops, record: targetRecord, steps });
          }
        }
      }
    }

    const data: RecipeRelationContext = {
      chains,
      nextRefs: refs.filter((ref) => ref.kind === 'relation'),
      rootRecipeId: rootId,
    };

    return { data, errors: [], refs };
  };
}
