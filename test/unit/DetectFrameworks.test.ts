/**
 * detectProjectFrameworks + resolveEnhancementGuardRulesForProject
 * (2026-07-10 链路验通审计:detectedFrameworks 此前全仓零生产来源,导致
 * Plugin guard 恒空集/主体恒全集——本文件锁"清单→框架→包→规则"的精确链)。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectProjectFrameworks } from '../../src/core/enhancement/detectFrameworks.js';
import { resolveEnhancementGuardRulesForProject } from '../../src/guard.js';

describe('detectProjectFrameworks(依赖清单→框架集合)', () => {
  it('React+TS 项目:package.json deps → react/nextjs + typescript/javascript', async () => {
    await withFixture(
      {
        'package.json': JSON.stringify({
          dependencies: { next: '^14.0.0', react: '^18.2.0', 'react-dom': '^18.2.0' },
          devDependencies: { typescript: '^5.4.0' },
        }),
      },
      async (root) => {
        const detection = await detectProjectFrameworks(root);
        expect(detection.languages).toEqual(['javascript', 'typescript']);
        expect(detection.frameworks).toEqual(['nextjs', 'react']);
        expect(detection.manifests).toEqual(['package.json']);
      }
    );
  });

  it('Go gRPC 项目:go.mod require → grpc/gin', async () => {
    await withFixture(
      {
        'go.mod': [
          'module example.com/svc',
          '',
          'go 1.22',
          '',
          'require (',
          '\tgithub.com/gin-gonic/gin v1.9.1',
          '\tgoogle.golang.org/grpc v1.62.0',
          ')',
        ].join('\n'),
      },
      async (root) => {
        const detection = await detectProjectFrameworks(root);
        expect(detection.languages).toEqual(['go']);
        expect(detection.frameworks).toEqual(['gin', 'grpc']);
      }
    );
  });

  it('Python 项目:requirements.txt → django;pyproject → fastapi/ml', async () => {
    await withFixture(
      {
        'pyproject.toml': [
          '[project]',
          'dependencies = [',
          '  "fastapi>=0.110",',
          '  "torch>=2.0",',
          ']',
        ].join('\n'),
        'requirements.txt': 'Django==5.0\npsycopg2-binary==2.9\n',
      },
      async (root) => {
        const detection = await detectProjectFrameworks(root);
        expect(detection.languages).toEqual(['python']);
        expect(detection.frameworks).toEqual(['django', 'fastapi', 'ml']);
      }
    );
  });

  it('Rust 项目:Cargo.toml [dependencies] 段内才算依赖 → axum/tokio', async () => {
    await withFixture(
      {
        'Cargo.toml': [
          '[package]',
          'name = "svc"', // [package] 段内的 name 行不得被误判为依赖
          '',
          '[dependencies]',
          'axum = "0.7"',
          'tokio = { version = "1", features = ["full"] }',
        ].join('\n'),
      },
      async (root) => {
        const detection = await detectProjectFrameworks(root);
        expect(detection.frameworks).toEqual(['axum', 'tokio']);
      }
    );
  });

  it('纯 Swift/SPM 项目(BiliDili 形态):Apple 生态检出 swift/objectivec,frameworks 留空', async () => {
    // 决策③前置:此前三空集使 swift-ios 包永不激活;Package.swift → 语言检出。
    await withFixture(
      { 'Package.swift': '// swift-tools-version:5.9\nimport PackageDescription\n' },
      async (root) => {
        const detection = await detectProjectFrameworks(root);
        expect(detection.languages).toEqual(['objectivec', 'swift']);
        expect(detection.frameworks).toEqual([]);
        expect(detection.manifests).toEqual(['Package.swift']);
      }
    );
  });

  it('损坏的 package.json:静默跳过,不抛错不猜测', async () => {
    await withFixture({ 'package.json': '{ not json' }, async (root) => {
      const detection = await detectProjectFrameworks(root);
      expect(detection.frameworks).toEqual([]);
      expect(detection.languages).toEqual([]);
    });
  });
});

describe('resolveEnhancementGuardRulesForProject(项目级精确 resolve)', () => {
  it('React 项目得到 react 包规则(此前 Plugin frameworkAgnostic 路径恒空集)', async () => {
    await withFixture(
      {
        'package.json': JSON.stringify({
          dependencies: { react: '^18.2.0' },
          devDependencies: { typescript: '^5.4.0' },
        }),
      },
      async (root) => {
        const result = await resolveEnhancementGuardRulesForProject(root);
        expect(result.packIds).toContain('react');
        expect(result.rules.length).toBeGreaterThan(0);
        // 规则形态与 GuardCheckEngine.injectExternalRules 的消费契约一致。
        for (const rule of result.rules) {
          expect(typeof rule.ruleId).toBe('string');
          expect(rule.pattern).toBeInstanceOf(RegExp);
        }
      }
    );
  });

  it('纯 Swift 项目命中 swift-ios 包(决策③),且不再拿到 react/django 等 54 条全集', async () => {
    await withFixture({ 'Package.swift': '// swift-tools-version:5.9\n' }, async (root) => {
      const result = await resolveEnhancementGuardRulesForProject(root);
      expect(result.packIds).toEqual(['swift-ios']);
      // 与内置 swift 规则查重收敛后,包只带内置没有的形态(IUO 属性/Timer 循环引用)。
      expect(result.rules.map((rule) => rule.ruleId).sort()).toEqual([
        'swift-ios-iuo-property',
        'swift-ios-timer-target-retain',
      ]);
      expect(result.rules.every((rule) => rule.languages.includes('swift'))).toBe(true);
    });
  });
});

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'detect-frameworks-'));
  try {
    for (const [filePath, content] of Object.entries(files)) {
      const absolutePath = path.join(projectRoot, filePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
    }
    await callback(projectRoot);
  } finally {
    await fs.rm(projectRoot, { force: true, recursive: true });
  }
}
