import pathGuard from '../../../shared/PathGuard.js';

interface ProjectAnalysisPreparationLogger {
  info(...args: unknown[]): void;
}

interface ProjectAnalysisPreparationContext {
  logger: ProjectAnalysisPreparationLogger;
}

interface ProjectAnalysisPreparationOptions {
  clearOldData?: boolean;
  dataRoot?: string;
}

export interface ProjectAnalysisRunPreparationInput {
  projectRoot: string;
  ctx: ProjectAnalysisPreparationContext;
  options: ProjectAnalysisPreparationOptions;
}

export interface ProjectAnalysisRunPreparationResult {
  warnings: string[];
}

export async function prepareProjectAnalysisRun({
  projectRoot,
  ctx,
  options,
}: ProjectAnalysisRunPreparationInput): Promise<ProjectAnalysisRunPreparationResult> {
  const warnings: string[] = [];

  await ensureProjectAnalysisPathGuard(projectRoot);

  if (options.clearOldData) {
    const clearResult = await clearPreviousProjectAnalysisState({ projectRoot, ctx, options });
    warnings.push(...clearResult.warnings);
  }

  return { warnings };
}

async function ensureProjectAnalysisPathGuard(projectRoot: string): Promise<void> {
  if (pathGuard.configured) {
    return;
  }

  pathGuard.configure({ projectRoot });
}

async function clearPreviousProjectAnalysisState({
  projectRoot,
  ctx,
  options,
}: ProjectAnalysisRunPreparationInput): Promise<ProjectAnalysisRunPreparationResult> {
  const warnings: string[] = [];
  try {
    const clearRoot = options.dataRoot || projectRoot;
    ctx.logger.info(
      `[Bootstrap] Core project analysis clearOldData requested for ${clearRoot}; outer workflow checkpoint cleanup remains host-owned`
    );
  } catch (err: unknown) {
    warnings.push(
      `clearOldData failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return { warnings };
}
