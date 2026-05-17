import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const CORE_ROOT = process.cwd();
const SRC_ROOT = path.join(CORE_ROOT, 'src');

const BANNED_SOURCE_DIRECTORIES = [
  'src/service/delivery',
  'src/repository/delivery',
  'src/tools',
  'src/agent',
  'src/codex',
  'src/external/mcp',
  'src/channels',
  'src/plugins',
];

const BANNED_EXPORT_SEGMENTS = [
  '/delivery',
  '/tools',
  '/agent',
  '/codex',
  '/mcp',
  '/channels',
  '/plugins',
];

const BANNED_IMPLEMENTATION_FILES = [
  'KnowledgeCompressor.ts',
  'TokenBudget.ts',
  'TopicClassifier.ts',
  'RulesGenerator.ts',
  'AgentInstructionsGenerator.ts',
  'FileProtection.ts',
  'SkillsSyncer.ts',
  'CursorDeliveryPipeline.ts',
  'DeliveryRepoAdapter.ts',
  'CodexMcpServer.ts',
];

const BANNED_IMPORT_PATTERNS = [
  /from\s+['"][^'"]*(?:service\/delivery|repository\/delivery|lib\/tools|#tools|#agent|#codex)[^'"]*['"]/,
  /import\([^)]*['"][^'"]*(?:service\/delivery|repository\/delivery|lib\/tools|#tools|#agent|#codex)[^'"]*['"][^)]*\)/,
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

describe('Core delivery boundary', () => {
  test('does not add delivery, tool, agent, Codex, MCP, or plugin source directories', () => {
    // 阶段 11 明确交付渠道留外层；Core 只保留可复用内核和兼容数据字段。
    const existingForbiddenDirs = BANNED_SOURCE_DIRECTORIES.filter((dir) =>
      existsSync(path.join(CORE_ROOT, dir))
    );

    expect(existingForbiddenDirs).toEqual([]);
  });

  test('does not export delivery, tool, agent, Codex, MCP, or plugin entrypoints', () => {
    const packageJson = JSON.parse(readFileSync(path.join(CORE_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const exportedKeys = Object.keys(packageJson.exports);
    const forbiddenExports = exportedKeys.filter((key) =>
      BANNED_EXPORT_SEGMENTS.some((segment) => key.includes(segment))
    );

    expect(forbiddenExports).toEqual([]);
  });

  test('does not contain copied delivery implementation files', () => {
    const files = listFiles(SRC_ROOT);
    const copiedDeliveryFiles = files
      .filter((file) => BANNED_IMPLEMENTATION_FILES.includes(path.basename(file)))
      .map(relativeToCore);

    expect(copiedDeliveryFiles).toEqual([]);
  });

  test('does not import outer delivery, internal agent, Codex, or tool-system modules', () => {
    const sourceFiles = listFiles(SRC_ROOT).filter((file) => file.endsWith('.ts'));
    const offendingImports: string[] = [];

    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf8');
      if (BANNED_IMPORT_PATTERNS.some((pattern) => pattern.test(content))) {
        offendingImports.push(relativeToCore(file));
      }
    }

    expect(offendingImports).toEqual([]);
  });
});
