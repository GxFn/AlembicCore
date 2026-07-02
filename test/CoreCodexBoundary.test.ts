import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const CORE_ROOT = process.cwd();
const SRC_ROOT = path.join(CORE_ROOT, 'src');

const BANNED_CODEX_DIRECTORIES = [
  'src/codex',
  'src/service/codex',
  'src/infrastructure/codex',
  'src/external/mcp',
  'src/mcp',
  'src/plugin',
  'src/plugins',
  'src/channels',
  'src/marketplace',
];

const BANNED_CODEX_EXPORT_PREFIXES = [
  './codex',
  './mcp',
  './external/mcp',
  './plugin',
  './plugins',
  './channels',
  './marketplace',
  './preflight',
  './tool-policy',
];

const BANNED_CODEX_IMPLEMENTATION_FILES = [
  'AiConfigState.ts',
  'CodexMcpServer.ts',
  'CodexProjectRootResolver.ts',
  'CodexRuntimeContext.ts',
  'CodexStatusService.ts',
  'CodexToolPolicy.ts',
  'KnowledgeState.ts',
  'McpCapabilityProjection.ts',
  'McpServer.ts',
  'McpToolAdapter.ts',
  'PluginRegistry.ts',
  'Preflight.ts',
  'ProjectRootResolver.ts',
  'RuntimeContext.ts',
  'ToolPolicy.ts',
  'zodToMcpSchema.ts',
];

const BANNED_CODEX_DEPENDENCIES = ['@modelcontextprotocol/sdk', '@codex', 'codex', 'alembic-codex'];

const CODEX_IMPORT_PATTERNS = [
  /from\s+['"][^'"]*(?:#codex|\/codex\/|lib\/codex|external\/mcp|@modelcontextprotocol|alembic-codex)[^'"]*['"]/,
  /import\([^)]*['"][^'"]*(?:#codex|\/codex\/|lib\/codex|external\/mcp|@modelcontextprotocol|alembic-codex)[^'"]*['"][^)]*\)/,
];

const CODEX_RUNTIME_IDENTIFIERS = [
  'CodexMcpServer',
  'CodexRuntimeContext',
  'CodexProjectRootResolver',
  'CodexStatusService',
  'CodexToolPolicy',
  'McpCapabilityProjection',
  'McpToolAdapter',
  'PluginRegistry',
  'Preflight',
  'ToolPolicy',
  'zodToMcpSchema',
];

const HOST_AGENT_WORKFLOW_DIRS = [
  'src/workflows/surfaces/coverage',
  'src/workflows/surfaces/host-agent',
  'src/workflows/surfaces/planning/knowledge',
  'src/workflows/cold-start',
  'src/workflows/knowledge-rescan',
  'src/workflows/project-index',
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

describe('Core Codex boundary', () => {
  test('does not add Codex, MCP, plugin, channel, or marketplace source directories', () => {
    // 阶段 13：Codex runtime/preflight/tool exposure 留在 AlembicPlugin。
    const existingForbiddenDirs = BANNED_CODEX_DIRECTORIES.filter((dir) =>
      existsSync(path.join(CORE_ROOT, dir))
    );

    expect(existingForbiddenDirs).toEqual([]);
  });

  test('does not export Codex, MCP, plugin, channel, or marketplace entrypoints', () => {
    const packageJson = JSON.parse(readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const exportedKeys = Object.keys(packageJson.exports);
    const forbiddenExports = exportedKeys.filter((key) =>
      BANNED_CODEX_EXPORT_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}/`))
    );

    expect(forbiddenExports).toEqual([]);
  });

  test('does not depend on Codex or MCP runtime packages', () => {
    const packageJson = JSON.parse(readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
    };
    const dependencyNames = new Set([
      ...Object.keys(packageJson.dependencies || {}),
      ...Object.keys(packageJson.devDependencies || {}),
      ...Object.keys(packageJson.optionalDependencies || {}),
    ]);
    const forbiddenDependencies = BANNED_CODEX_DEPENDENCIES.filter((name) =>
      dependencyNames.has(name)
    );

    expect(forbiddenDependencies).toEqual([]);
  });

  test('does not contain copied Codex runtime or MCP implementation files', () => {
    const copiedCodexFiles = listFiles(SRC_ROOT)
      .filter((file) => BANNED_CODEX_IMPLEMENTATION_FILES.includes(path.basename(file)))
      .map(relativeToCore);

    expect(copiedCodexFiles).toEqual([]);
  });

  test('does not import Codex runtime or MCP adapter modules', () => {
    const offendingImports: string[] = [];

    for (const file of listFiles(SRC_ROOT).filter((sourceFile) => sourceFile.endsWith('.ts'))) {
      const content = readFileSync(file, 'utf8');
      if (CODEX_IMPORT_PATTERNS.some((pattern) => pattern.test(content))) {
        offendingImports.push(relativeToCore(file));
      }
    }

    expect(offendingImports).toEqual([]);
  });

  test('host-agent workflows do not reference Codex runtime, preflight, or MCP adapter classes', () => {
    const offenders: string[] = [];

    for (const dir of HOST_AGENT_WORKFLOW_DIRS) {
      for (const file of sourceFilesUnder(dir)) {
        const content = readFileSync(file, 'utf8');
        const matched = CODEX_RUNTIME_IDENTIFIERS.filter((identifier) =>
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
