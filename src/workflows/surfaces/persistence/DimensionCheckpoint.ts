import fs from 'node:fs/promises';
import path from 'node:path';
import Logger from '../../../infrastructure/logging/Logger.js';
import pathGuard from '../../../shared/PathGuard.js';
import type { DimensionCheckpointResult } from '../../../types/workflows.js';

const logger = Logger.getInstance();
const CHECKPOINT_TTL_MS = 3600_000;

export interface DimensionCheckpoint extends DimensionCheckpointResult {
  dimId?: string;
  completedAt?: number;
  candidateCount?: number;
  rejectedCount?: number;
  analysisChars?: number;
  referencedFiles?: number;
  durationMs?: number;
  toolCallCount?: number;
  tokenUsage?: { input: number; output: number };
  analysisText?: string;
  referencedFilesList?: string[];
  digest?: unknown;
}

/**
 * 保存维度级 checkpoint。
 *
 * Core 只负责 checkpoint 文件本身；internal-agent 的恢复、事件广播、
 * DimensionContext digest 回填留在外层仓库。
 */
export async function saveDimensionCheckpoint(
  dataRoot: string,
  sessionId: string,
  dimId: string,
  result: Record<string, unknown>,
  digest: unknown = null
): Promise<void> {
  try {
    const checkpointDir = path.join(dataRoot, '.asd', 'bootstrap-checkpoint');
    await fs.mkdir(checkpointDir, { recursive: true });
    await fs.writeFile(
      path.join(checkpointDir, `${dimId}.json`),
      JSON.stringify({ dimId, sessionId, ...result, digest, completedAt: Date.now() }),
      'utf8'
    );
  } catch (err: unknown) {
    logger.warn(
      `[WorkflowCheckpoint] checkpoint save failed for "${dimId}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function loadDimensionCheckpoints(
  dataRoot: string,
  ttlMs = CHECKPOINT_TTL_MS
): Promise<Map<string, DimensionCheckpoint>> {
  const checkpoints = new Map<string, DimensionCheckpoint>();
  const checkpointDir = path.join(dataRoot, '.asd', 'bootstrap-checkpoint');
  const files = await fs.readdir(checkpointDir).catch(() => []);
  const now = Date.now();
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    try {
      const content = await fs.readFile(path.join(checkpointDir, file), 'utf8');
      const data = JSON.parse(content) as DimensionCheckpoint;
      if (data.dimId && data.completedAt && now - data.completedAt < ttlMs) {
        checkpoints.set(data.dimId, data);
      }
    } catch {
      // 跳过损坏 checkpoint，避免单个文件阻断整个恢复流程。
    }
  }
  return checkpoints;
}

export async function clearDimensionCheckpoints(dataRoot: string): Promise<void> {
  try {
    const checkpointDir = path.join(dataRoot, '.asd', 'bootstrap-checkpoint');
    pathGuard.assertSafe(checkpointDir);
    await fs.rm(checkpointDir, { recursive: true, force: true });
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'PathGuardError') {
      throw err;
    }
  }
}

export const loadCheckpoints = loadDimensionCheckpoints;
export const clearCheckpoints = clearDimensionCheckpoints;
