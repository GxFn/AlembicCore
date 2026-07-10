/**
 * fileFlow 抗病态输入防线 + 模块目录枚举排除(2026-07-10 真实事故回归)。
 *
 * 事故:SPM checkout(packages/X/.build/checkouts/Alamofire/docs/.../jquery.min.js,
 * 单行 80KB+ 压缩 JS)流入 fileFlow 行级正则,parseCommonJsRequire 的无界懒惰组
 * 灾难性回溯,钉死宿主 MCP 单线程事件循环 1h+。本文件锁三层防线 + 枚举排除:
 *   ①压缩/生成物整文件跳过(unavailableReason 降级通道);
 *   ②超长行不进行级正则(合法语句不受影响);
 *   ③正则组界长(近门限的对抗行也须快速完成);
 *   ④moduleLayers 目录枚举跳过点目录/Pods/DerivedData(污染入口封堵)。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectContext } from '../src/project-context.js';
import type {
  FileFlowContext,
  ModuleContext,
  RepoContext,
} from '../src/service/project-context/index.js';

describe('fileFlow 病态输入防线(ReDoS 回归)', () => {
  it('防线①:单行压缩 JS(jquery.min 形态)整体跳过并给出 unavailableReason,不挂死', async () => {
    // 复刻事故形态:一行数万字符、大量 var/=、无换行——旧正则在此回溯 O(n²) 永不返回。
    const minified = `!function(e,t){"use strict";${'var a=("object"==typeof module&&e.x)?t(e,!0):function(n){if(!n.d)throw new Error("x");return t(n)};'.repeat(600)}}(window);`;
    expect(minified.includes('\n')).toBe(false);
    expect(minified.length).toBeGreaterThan(50_000);

    await withFixture({ 'src/vendor-bundle.js': minified }, async (projectRoot) => {
      const startedAt = Date.now();
      const envelope = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'src/vendor-bundle.js' },
        scope: { projectRoot, repoId: 'core' },
      });
      const elapsedMs = Date.now() - startedAt;
      // 旧实现在此处永不返回;防线①下应毫秒级完成(阈值放宽到 2s 抗 CI 抖动)。
      expect(elapsedMs).toBeLessThan(2_000);
      const data = envelope.data as FileFlowContext;
      expect(data.imports).toEqual([]);
      expect(JSON.stringify(envelope)).toContain('minified/generated');
    });
  });

  it('防线②:混入超长垃圾行的正常文件——合法 require 照常解析,垃圾行被跳过', async () => {
    const junkLine = `const table=[${'"cell",'.repeat(400)}"end"];`; // ~3000 字符,低于整文件病态阈值
    expect(junkLine.length).toBeGreaterThan(2_000);
    const source = [
      "const helper = require('./helper');",
      junkLine,
      'module.exports = { helper };',
      // 拉低平均行长,确保不触发防线①的整文件判定(只考防线②)。
      ...Array.from({ length: 40 }, (_, index) => `// filler line ${index}`),
    ].join('\n');

    await withFixture(
      { 'src/helper.js': 'module.exports = {};', 'src/mixed.js': source },
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/mixed.js' },
          scope: { projectRoot, repoId: 'core' },
        });
        const data = envelope.data as FileFlowContext;
        const specifiers = data.imports.map((relation) => relation.to?.label ?? '');
        expect(specifiers).toContain('src/helper.js');
      }
    );
  });

  it('防线①收窄:含 8KB data-URI 行的合法源码不被整文件误杀——该行跳过,imports 保留', async () => {
    // 复审发现的过激边界:单行 5000 就整文件跳过会误杀"合法代码里嵌长 base64/data-URI"
    // 的真实形态。收窄到 20000 后:8KB 行只被防线②跳过,文件本身照常抽取 imports。
    const dataUriLine = `const ICON = 'data:image/png;base64,${'A'.repeat(8_000)}';`;
    expect(dataUriLine.length).toBeGreaterThan(5_000);
    expect(dataUriLine.length).toBeLessThan(20_000);
    const source = [
      "const helper = require('./helper');",
      dataUriLine,
      'module.exports = { helper, ICON };',
      // 压低平均行长(防线①的 avg 判据不应触发)。
      ...Array.from({ length: 60 }, (_, index) => `// filler ${index}`),
    ].join('\n');

    await withFixture(
      { 'src/helper.js': 'module.exports = {};', 'src/icon.js': source },
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'file-flow',
          payload: { filePath: 'src/icon.js' },
          scope: { projectRoot, repoId: 'core' },
        });
        const data = envelope.data as FileFlowContext;
        // 整文件未被跳过:合法 require 照常解析。
        const specifiers = data.imports.map((relation) => relation.to?.label ?? '');
        expect(specifiers).toContain('src/helper.js');
        expect(JSON.stringify(envelope)).not.toContain('minified/generated');
      }
    );
  });

  it('防线③:门限内的对抗行(大量 var/= 无 require 尾)也必须快速完成', async () => {
    // 1900 字符 < 行长门限 2000 → 进正则;界长组 {1,240} 把回溯限制在常数级。
    const adversarial = `var ${'a='.repeat(940)}b;`;
    expect(adversarial.length).toBeLessThan(2_000);
    const source = [adversarial, ...Array.from({ length: 30 }, () => '// pad')].join('\n');

    await withFixture({ 'src/adversarial.js': source }, async (projectRoot) => {
      const startedAt = Date.now();
      await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'src/adversarial.js' },
        scope: { projectRoot, repoId: 'core' },
      });
      expect(Date.now() - startedAt).toBeLessThan(2_000);
    });
  });
});

describe('Swift 模块关系能力(2026-07-10 三断点修复回归)', () => {
  const SWIFT_SOURCE = [
    'import AOXFoundationKit',
    'import UIKit',
    '',
    'final class FeedViewModel {',
    '    private let repository: FeedRepository',
    '    func load() {',
    '        repository.fetch()',
    '    }',
    '}',
    '',
  ].join('\n');

  it('fileFlow 对 .swift 可用:AST 直出 imports(此前 resolveParserLanguage 白名单挡掉 swift)', async () => {
    await withFixture({ 'Sources/Feed/FeedViewModel.swift': SWIFT_SOURCE }, async (projectRoot) => {
      const envelope = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'Sources/Feed/FeedViewModel.swift' },
        scope: { projectRoot, repoId: 'core' },
      });
      const data = envelope.data as FileFlowContext;
      // 语言不再 unavailable。
      expect(JSON.stringify(envelope)).not.toContain('parser is unavailable');
      // AST 直出的模块级 imports(Swift import 是模块名,解析为 unresolved 外部依赖属正常)。
      const labels = data.imports.map((relation) => relation.to?.label ?? '');
      expect(labels).toContain('AOXFoundationKit');
      expect(labels).toContain('UIKit');
      // 行号定位真实(import AOXFoundationKit 在第 1 行)。
      const aox = data.imports.find((relation) => relation.to?.label === 'AOXFoundationKit');
      expect(aox?.range).toMatchObject({ startLine: 1, endLine: 1 });
    });
  });

  it('module 种子对 Swift 目录解析出 ownedFiles(此前 isSupportedModuleFile 只认 JS/TS)', async () => {
    await withFixture(
      {
        'Packages/AOXFeedKit/Sources/AOXFeedKit/FeedViewModel.swift': SWIFT_SOURCE,
        'Packages/AOXFeedKit/Sources/AOXFeedKit/FeedRepository.swift':
          'import Foundation\n\nstruct FeedRepository {\n    func fetch() {}\n}\n',
      },
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'module',
          payload: { modulePath: 'Packages/AOXFeedKit' },
          scope: { projectRoot, repoId: 'core' },
        });
        const data = envelope.data as ModuleContext;
        const ownedPaths = data.ownedFiles.map((file) => file.filePath);
        // 修复前:Swift 文件被白名单挡掉 → ownedFiles 空 → 误导性报错
        // "module payload.ownedFiles or payload.modulePath is required"。
        expect(ownedPaths).toContain('Packages/AOXFeedKit/Sources/AOXFeedKit/FeedViewModel.swift');
        expect(ownedPaths).toContain('Packages/AOXFeedKit/Sources/AOXFeedKit/FeedRepository.swift');
      }
    );
  });
});

describe('repo 声明式依赖图(2026-07-10 接线:Discoverer getDependencyGraph→repo 事实)', () => {
  it('easybox 项目:boxspec dependency 产出 depends_on 边,层级/宿主节点带出', async () => {
    await withFixture(
      {
        Boxfile: [
          "host_app 'DemoApp', '1.0.0'",
          '',
          "layer 'Business' do",
          "  box 'FeedModule', :path => 'LocalModule/FeedModule'",
          'end',
          '',
          "layer 'Foundation' do",
          "  box 'NetKit', :path => 'LocalModule/NetKit'",
          'end',
        ].join('\n'),
        'LocalModule/FeedModule/Classes/FeedService.m': '@implementation FeedService\n@end\n',
        'LocalModule/FeedModule/FeedModule.boxspec': [
          'Box::Spec.new do |s|',
          "  s.name = 'FeedModule'",
          "  s.version = '1.0.0'",
          "  s.source_files = 'Classes/**/*.{h,m}'",
          "  s.dependency 'NetKit'",
          'end',
        ].join('\n'),
        'LocalModule/NetKit/Classes/NetClient.m': '@implementation NetClient\n@end\n',
        'LocalModule/NetKit/NetKit.boxspec': [
          'Box::Spec.new do |s|',
          "  s.name = 'NetKit'",
          "  s.version = '1.2.0'",
          "  s.source_files = 'Classes/**/*.{h,m}'",
          'end',
        ].join('\n'),
      },
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'repo',
          payload: {},
          scope: { projectRoot, repoId: 'easybox-demo' },
        });
        const data = envelope.data as RepoContext;
        // 修复前:RepoContext 无 dependencyGraph,主体图 API edges 恒 []。
        expect(data.dependencyGraph?.source).toBe('customConfig');
        const edges = data.dependencyGraph?.edges ?? [];
        expect(edges).toContainEqual({ from: 'FeedModule', to: 'NetKit', type: 'depends_on' });
        expect(edges.some((edge) => edge.type === 'contains' && edge.from === 'DemoApp')).toBe(
          true
        );
        const nodeIds = (data.dependencyGraph?.nodes ?? []).map((node) => node.id);
        expect(nodeIds).toContain('FeedModule');
        expect(nodeIds).toContain('NetKit');
      }
    );
  });
});

describe('moduleLayers 目录枚举排除(污染入口封堵)', () => {
  it('modulePath 走查跳过 .build/Pods/DerivedData 等工具目录,真实源码保留', async () => {
    await withFixture(
      {
        'packages/kit/.build/checkouts/dep/docs/jquery.min.js': '!function(e){}(window);',
        'packages/kit/DerivedData/gen.js': 'module.exports = 1;',
        'packages/kit/Pods/vendorpod/index.js': 'module.exports = 2;',
        'packages/kit/src/real.ts': "export const real = 'yes';",
      },
      async (projectRoot) => {
        const envelope = await ProjectContext.execute({
          kind: 'module',
          payload: { modulePath: 'packages/kit' },
          scope: { projectRoot, repoId: 'core' },
        });
        const data = envelope.data as ModuleContext;
        const ownedPaths = data.ownedFiles.map((file) => file.filePath);
        expect(ownedPaths).toContain('packages/kit/src/real.ts');
        expect(ownedPaths.some((filePath) => filePath.includes('.build/'))).toBe(false);
        expect(ownedPaths.some((filePath) => filePath.includes('Pods/'))).toBe(false);
        expect(ownedPaths.some((filePath) => filePath.includes('DerivedData/'))).toBe(false);
      }
    );
  });
});

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-flow-guards-'));
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
