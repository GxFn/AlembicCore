import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const CORE_ROOT = process.cwd();
const SRC_ROOT = path.join(CORE_ROOT, 'src');

const BANNED_TOOL_DIRECTORIES = [
  'src/tools',
  'src/tool',
  'src/tool-system',
  'src/service/tools',
  'src/service/tool',
  'src/infrastructure/tools',
  'src/repository/tools',
];

const BANNED_TOOL_EXPORT_PREFIXES = ['./tools', './tool', './tool-system'];

const BANNED_TOOL_IMPLEMENTATION_FILES = [
  'CapabilityCatalog.ts',
  'CapabilityManifest.ts',
  'UnifiedToolCatalog.ts',
  'InternalToolHandler.ts',
  'LightweightRouter.ts',
  'ToolCallContext.ts',
  'ToolContracts.ts',
  'ToolDecision.ts',
  'ToolResultEnvelope.ts',
  'ToolResultPresenter.ts',
  'ToolRoutingServices.ts',
  'ToolContextFactory.ts',
  'V2CapabilityCatalog.ts',
  'V2ToolRouterAdapter.ts',
  'DeltaCache.ts',
  'SearchCache.ts',
  'OutputCompressor.ts',
  'TerminalAdapter.ts',
  'TerminalSession.ts',
  'TerminalSessionManager.ts',
  'TerminalPolicyShared.ts',
  'TerminalPolicyTypes.ts',
  'TerminalRunPolicy.ts',
  'TerminalScriptPolicy.ts',
  'TerminalShellPolicy.ts',
  'MacSystemAdapter.ts',
  'DashboardOperationAdapter.ts',
  'SkillAdapter.ts',
  'WorkflowRegistry.ts',
];

const TOOL_SYSTEM_IMPORT_PATTERNS = [
  /from\s+['"][^'"]*(?:#tools|lib\/tools|\/tools\/|\/tools$)[^'"]*['"]/,
  /import\([^)]*['"][^'"]*(?:#tools|lib\/tools|\/tools\/|\/tools$)[^'"]*['"][^)]*\)/,
];

const TOOL_ROUTER_IDENTIFIERS = [
  'InternalToolHandler',
  'LightweightRouter',
  'ToolCallContext',
  'ToolContracts',
  'ToolDecision',
  'ToolResultEnvelope',
  'ToolRoutingServices',
  'UnifiedToolCatalog',
  'V2ToolRouterAdapter',
  'ToolContextFactory',
  'OutputCompressor',
];

const HOST_AGENT_WORKFLOW_DIRS = [
  'src/workflows/capabilities/host-agent',
  'src/workflows/capabilities/planning/knowledge',
  'src/workflows/cold-start',
  'src/workflows/knowledge-rescan',
];

function listFiles(dir: string, result: string[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(fullPath, result);
    } else {
      result.push(fullPath);
    }
  }
  return result;
}

function relativeToCore(fullPath: string) {
  return path.relative(CORE_ROOT, fullPath).replaceAll(path.sep, '/');
}

function sourceFilesUnder(relativeDir: string) {
  const dir = path.join(CORE_ROOT, relativeDir);
  if (!existsSync(dir)) {
    return [];
  }
  return listFiles(dir).filter((file) => file.endsWith('.ts'));
}

describe('Core tool-system boundary', () => {
  test('does not add Alembic tool-system source directories', () => {
    // 阶段 12：Alembic tool catalog/router/handler 留在外层，Core 只定义闭环协议。
    const existingForbiddenDirs = BANNED_TOOL_DIRECTORIES.filter((dir) =>
      existsSync(path.join(CORE_ROOT, dir))
    );

    expect(existingForbiddenDirs).toEqual([]);
  });

  test('does not export tool-system package entrypoints', () => {
    const packageJson = JSON.parse(readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const exportedKeys = Object.keys(packageJson.exports);
    const forbiddenExports = exportedKeys.filter((key) =>
      BANNED_TOOL_EXPORT_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}/`))
    );

    expect(forbiddenExports).toEqual([]);
  });

  test('does not contain copied tool-system implementation files', () => {
    const copiedToolFiles = listFiles(SRC_ROOT)
      .filter((file) => BANNED_TOOL_IMPLEMENTATION_FILES.includes(path.basename(file)))
      .map(relativeToCore);

    expect(copiedToolFiles).toEqual([]);
  });

  test('does not import Alembic tool-system modules', () => {
    const offendingImports: string[] = [];

    for (const file of listFiles(SRC_ROOT).filter((sourceFile) => sourceFile.endsWith('.ts'))) {
      const content = readFileSync(file, 'utf8');
      if (TOOL_SYSTEM_IMPORT_PATTERNS.some((pattern) => pattern.test(content))) {
        offendingImports.push(relativeToCore(file));
      }
    }

    expect(offendingImports).toEqual([]);
  });

  test('host-agent workflows do not route through Alembic tool router classes', () => {
    const offenders: string[] = [];

    for (const dir of HOST_AGENT_WORKFLOW_DIRS) {
      for (const file of sourceFilesUnder(dir)) {
        const content = readFileSync(file, 'utf8');
        const matched = TOOL_ROUTER_IDENTIFIERS.filter((identifier) =>
          content.includes(identifier)
        );
        if (matched.length > 0) {
          offenders.push(`${relativeToCore(file)}: ${matched.join(', ')}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
