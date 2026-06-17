// EmbedProviderSelector (GMAP-L1) — local-first embed-lane selection with honest
// per-lane diagnostics, and lane switching via VectorService.migrateDimension.
//
// Order is local-first: Ollama (local) -> resident -> keyword baseline. The
// first available lane wins; later lanes are not probed (and say so). The
// keyword baseline is a null provider — VectorService then runs keyword-only
// (hybridSearch returns []/vectorUsed=false), the existing graceful degrade.
// Switching to a real provider goes through migrateDimension (clear -> swap ->
// full rebuild) so dimensions never mix.

import {
  OllamaEmbedProvider,
  type OllamaEmbedProviderConfig,
} from '../../infrastructure/vector/OllamaEmbedProvider.js';
import type { BuildResult, EmbedProvider, ProgressFn, VectorService } from './VectorService.js';

export type EmbedLaneName = 'ollama' | 'resident' | 'keyword' | (string & {});

export interface EmbedLane {
  name: EmbedLaneName;
  /** null = keyword baseline (no vectors). */
  provider: EmbedProvider | null;
  isAvailable(): Promise<boolean>;
}

export interface EmbedLaneDiagnostic {
  name: EmbedLaneName;
  probed: boolean;
  available: boolean;
  selected: boolean;
  hasProvider: boolean;
  reason?: string;
}

export interface EmbedLaneSelection {
  lane: EmbedLaneName;
  provider: EmbedProvider | null;
  diagnostics: EmbedLaneDiagnostic[];
}

export interface ApplyEmbedLaneResult {
  lane: EmbedLaneName;
  switched: boolean;
  rebuild?: BuildResult;
  reason?: string;
  diagnostics: EmbedLaneDiagnostic[];
}

/** The keyword baseline lane: always available, no embed provider. */
export function keywordEmbedLane(): EmbedLane {
  return { isAvailable: async () => true, name: 'keyword', provider: null };
}

/** Build an Ollama lane from config (local lane). */
export function createOllamaEmbedLane(config: OllamaEmbedProviderConfig): EmbedLane {
  const provider = new OllamaEmbedProvider(config);
  return { isAvailable: () => provider.isAvailable(), name: 'ollama', provider };
}

/** Wrap an already-built provider (e.g. the Plugin's resident embed) as a lane. */
export function embedLaneFromProvider(
  name: EmbedLaneName,
  provider: EmbedProvider,
  isAvailable: () => Promise<boolean> = async () => true
): EmbedLane {
  return { isAvailable, name, provider };
}

/**
 * Assemble the local-first lane order. Ollama config and a resident lane are
 * optional (Core does not own the resident provider — the Plugin supplies it in
 * GMAP-L3). The keyword baseline is always appended last.
 */
export function buildLocalFirstEmbedLanes(opts: {
  ollama?: OllamaEmbedProviderConfig;
  resident?: EmbedLane;
}): EmbedLane[] {
  const lanes: EmbedLane[] = [];
  if (opts.ollama) {
    lanes.push(createOllamaEmbedLane(opts.ollama));
  }
  if (opts.resident) {
    lanes.push(opts.resident);
  }
  lanes.push(keywordEmbedLane());
  return lanes;
}

/** Probe lanes in order; pick the first available; report honest diagnostics. */
export async function selectEmbedLane(lanes: readonly EmbedLane[]): Promise<EmbedLaneSelection> {
  const diagnostics: EmbedLaneDiagnostic[] = [];
  let chosen: EmbedLane | undefined;

  for (const lane of lanes) {
    if (chosen) {
      diagnostics.push({
        available: false,
        hasProvider: lane.provider !== null,
        name: lane.name,
        probed: false,
        reason: `not probed (earlier lane "${chosen.name}" selected)`,
        selected: false,
      });
      continue;
    }

    let available = false;
    let reason: string | undefined;
    try {
      available = await lane.isAvailable();
      if (!available) {
        reason = 'lane reported unavailable';
      }
    } catch (error) {
      available = false;
      reason = error instanceof Error ? error.message : String(error);
    }

    if (available) {
      chosen = lane;
    }
    diagnostics.push({
      available,
      hasProvider: lane.provider !== null,
      name: lane.name,
      probed: true,
      reason,
      selected: available,
    });
  }

  return {
    diagnostics,
    lane: chosen?.name ?? 'none',
    provider: chosen?.provider ?? null,
  };
}

/**
 * Apply a selection to a VectorService. A real provider triggers
 * migrateDimension (clear -> swap -> full rebuild); the keyword baseline is a
 * no-op switch (vectors stay disabled). VectorService is referenced
 * structurally so callers pass their live instance.
 */
export async function applyEmbedLane(
  vectorService: Pick<VectorService, 'migrateDimension'>,
  selection: EmbedLaneSelection,
  opts: { onProgress?: ProgressFn } = {}
): Promise<ApplyEmbedLaneResult> {
  if (!selection.provider) {
    return {
      diagnostics: selection.diagnostics,
      lane: selection.lane,
      reason:
        'keyword baseline selected — no embed provider; vectors stay disabled, no dimension migration.',
      switched: false,
    };
  }

  const rebuild = await vectorService.migrateDimension(selection.provider, opts);
  return {
    diagnostics: selection.diagnostics,
    lane: selection.lane,
    rebuild,
    switched: true,
  };
}

/** Convenience: select the local-first lane and apply it in one call. */
export async function selectAndApplyEmbedLane(
  vectorService: Pick<VectorService, 'migrateDimension'>,
  lanes: readonly EmbedLane[],
  opts: { onProgress?: ProgressFn } = {}
): Promise<ApplyEmbedLaneResult> {
  const selection = await selectEmbedLane(lanes);
  return applyEmbedLane(vectorService, selection, opts);
}
