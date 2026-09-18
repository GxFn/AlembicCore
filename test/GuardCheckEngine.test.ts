/**
 * Integration: GuardCheckEngine
 *
 * 使用 Core 内 in-memory SQLite 验证 Guard 的规则加载、审计、跨文件检查和信号输出。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import '../src/core/ast/index.js';
import { findCallExpressions } from '../src/core/AstAnalyzer.js';
import { openAlembicDatabase } from '../src/database.js';
import { KnowledgeEntry } from '../src/domain/knowledge/KnowledgeEntry.js';
import { pathGuard } from '../src/io.js';
import { createAlembicRepositories } from '../src/repositories.js';
import { detectLanguage, GuardCheckEngine } from '../src/service/guard/GuardCheckEngine.js';
import { UncertaintyCollector } from '../src/service/guard/UncertaintyCollector.js';

type GuardEngineDb = ConstructorParameters<typeof GuardCheckEngine>[0];
type GuardEngineSignalBus = NonNullable<
  NonNullable<ConstructorParameters<typeof GuardCheckEngine>[1]>['signalBus']
>;

function createGuardDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      language TEXT,
      scope TEXT DEFAULT 'file',
      constraints TEXT DEFAULT '{}',
      lifecycle TEXT DEFAULT 'active',
      kind TEXT DEFAULT 'rule',
      knowledgeType TEXT DEFAULT 'boundary-constraint',
      stats TEXT DEFAULT '{}',
      content TEXT DEFAULT '{}',
      tags TEXT DEFAULT '[]',
      createdAt INTEGER DEFAULT 0,
      updatedAt INTEGER DEFAULT 0
    );
  `);
  return db;
}

function asGuardDb(db: Database.Database): GuardEngineDb {
  return db as unknown as GuardEngineDb;
}

describe('Integration: GuardCheckEngine', () => {
  let db: Database.Database;
  let engine: GuardCheckEngine;

  beforeAll(() => {
    db = createGuardDb();
    engine = new GuardCheckEngine(asGuardDb(db));
  });

  afterAll(() => {
    db.close();
  });

  describe('detectLanguage', () => {
    it.each([
      ['ViewController.swift', 'swift'],
      ['AppDelegate.m', 'objc'],
      ['server.tsx', 'typescript'],
      ['main.py', 'python'],
      ['Main.kt', 'kotlin'],
      ['lib.rs', 'rust'],
      ['README.md', 'markdown'],
      [null, 'unknown'],
    ])('detectLanguage(%s) -> %s', (filePath, expected) => {
      expect(detectLanguage(filePath)).toBe(expected);
    });
  });

  describe('built-in guard rules', () => {
    it('detects ObjC main-thread dispatch_sync deadlock', () => {
      const violations = engine.checkCode(
        `
- (void)doSomething {
    dispatch_sync(dispatch_get_main_queue(), ^{
        [self updateUI];
    });
}`,
        'objc'
      );
      const found = violations.find((violation) => violation.ruleId === 'no-main-thread-sync');

      expect(found?.severity).toBe('error');
      expect(found?.reasoning?.whatViolated).toBe('no-main-thread-sync');
    });

    it('detects Swift unsafe casts and force try', () => {
      const violations = engine.checkCode(
        'let vc = sender as! UIViewController\nlet data = try! Data(contentsOf: url)',
        'swift'
      );

      expect(violations.some((violation) => violation.ruleId === 'swift-force-cast')).toBe(true);
      expect(violations.some((violation) => violation.ruleId === 'swift-force-try')).toBe(true);
    });

    it('detects JavaScript and Python safety rules', () => {
      const jsViolations = engine.checkCode('const result = eval("1+2"); debugger;', 'javascript');
      const pyViolations = engine.checkCode('try:\n    pass\nexcept:\n    pass', 'python');

      expect(jsViolations.some((violation) => violation.ruleId === 'js-no-eval')).toBe(true);
      expect(jsViolations.some((violation) => violation.ruleId === 'js-no-debugger')).toBe(true);
      expect(pyViolations.some((violation) => violation.ruleId === 'py-no-bare-except')).toBe(true);
    });
  });

  describe('auditFile / auditFiles', () => {
    it('returns full single-file audit result', () => {
      const result = engine.auditFile(
        'ViewController.swift',
        'let data = try! Data(contentsOf: url)\nDispatchQueue.main.sync { }'
      );

      expect(result.filePath).toBe('ViewController.swift');
      expect(result.language).toBe('swift');
      expect(result.summary.total).toBeGreaterThanOrEqual(2);
      expect(result.summary.errors).toBeGreaterThanOrEqual(1);
      expect(result.uncertainResults).toBeInstanceOf(Array);
    });

    it('summarizes batch audit and cross-file violations', () => {
      const result = engine.auditFiles([
        { path: 'a.swift', content: 'let x = try! foo()' },
        { path: 'b.js', content: 'eval("code"); var x = 1;' },
        { path: 'NSString+A.h', content: '@interface NSString (Utility)\n@end' },
        { path: 'NSString+B.h', content: '@interface NSString (Utility)\n@end' },
      ]);

      expect(result.summary.filesChecked).toBe(4);
      expect(engine.getUncertaintyCollector()).toBeInstanceOf(UncertaintyCollector);
      expect(result.files.every((file) => Array.isArray(file.uncertainResults))).toBe(true);
      expect(result.summary.totalUncertain).toBeGreaterThanOrEqual(0);
      expect(result.summary.totalViolations).toBeGreaterThanOrEqual(3);
      expect(result.capabilityReport).toBeDefined();
      expect(
        result.crossFileViolations.some(
          (violation) => violation.ruleId === 'objc-cross-file-duplicate-category'
        )
      ).toBe(true);
    });
  });

  describe('database custom rules', () => {
    it('reads Dart call selectors without treating strings, tear-offs or cascade properties as calls', () => {
      const source = [
        'class Bad { void run() {',
        '  log("api.unsafeCall");',
        '  api.unsafeCallExtra();',
        '  api?.unsafeCall();',
        '  api.service.unsafeCall();',
        '  unsafeCall<int>();',
        '  factory("unsafeCall").safe();',
        '  api..unsafeCall()..service.unsafeCall();',
        '  api.run(unsafeCall());',
        '  final reference = api.unsafeCall;',
        '} }',
      ].join('\n');
      expect(findCallExpressions(source, 'dart', 'unsafeCall').map((call) => call.line)).toEqual([
        4, 5, 6, 8, 8, 9,
      ]);
      expect(
        findCallExpressions(source, 'dart', 'api.unsafeCall').map((call) => call.line)
      ).toEqual([4, 8]);
      expect(
        findCallExpressions(source, 'dart', 'api.service.unsafeCall').map((call) => call.line)
      ).toEqual([5, 8]);
      expect(findCallExpressions(source, 'dart', 'service')).toEqual([]);
    });

    it.each([
      { language: 'typescript', file: 'calls.ts', target: 'unsafeCall', lines: [4, 5] },
      { language: 'javascript', file: 'calls.js', target: 'unsafeCall', lines: [4, 5] },
      { language: 'typescript', file: 'calls.ts', target: 'api.unsafeCall', lines: [5] },
      { language: 'java', file: 'Calls.java', target: 'unsafeCall', lines: [4, 5] },
      { language: 'java', file: 'Calls.java', target: 'api.unsafeCall', lines: [5] },
      { language: 'dart', file: 'calls.dart', target: 'unsafeCall', lines: [4, 5] },
      { language: 'dart', file: 'calls.dart', target: 'api.unsafeCall', lines: [5] },
      { language: 'swift', file: 'calls.swift', target: 'unsafeCall', lines: [4, 5] },
      { language: 'objectivec', file: 'calls.m', target: 'unsafeCall', lines: [4, 5] },
      { language: 'objectivec', file: 'calls.m', target: 'unsafeCall:other:', lines: [5] },
      ...[
        { language: 'typescript', file: 'members.ts', target: 'unsafeCall', lines: [2, 3] },
        { language: 'javascript', file: 'members.js', target: 'unsafeCall', lines: [2, 3] },
        { language: 'typescript', file: 'members.ts', target: 'api.unsafeCall', lines: [3] },
        { language: 'typescript', file: 'members.ts', target: 'factory.unsafeCall', lines: [] },
      ].map((fixture) => ({
        ...fixture,
        source:
          'class Bad { run() {\n factory().unsafeCall();\n api["unsafeCall"]();\n factory("unsafeCall").safe();\n api[choose("unsafeCall")]();\n} }',
      })),
      {
        language: 'swift',
        file: 'members.swift',
        target: 'unsafeCall',
        lines: [2],
        source:
          'class Bad { func run() {\n factory().unsafeCall()\n factory("unsafeCall").safe()\n} }',
      },
      {
        language: 'kotlin',
        file: 'members.kt',
        target: 'unsafeCall',
        lines: [2],
        source:
          'class Bad { fun run() {\n factory().unsafeCall()\n factory("unsafeCall").safe()\n} }',
      },
      {
        language: 'go',
        file: 'members.go',
        target: 'unsafeCall',
        lines: [3],
        source:
          'package sample\nfunc run() {\n factory().unsafeCall()\n factory("unsafeCall").safe()\n}',
      },
      {
        language: 'rust',
        file: 'members.rs',
        target: 'unsafeCall',
        lines: [2, 3],
        source:
          'fn run() {\n factory().unsafeCall();\n unsafeCall::<T>();\n factory("unsafeCall").safe();\n}',
      },
    ])('matches actual $language callees/selectors for $target', (testCase) => {
      const localDb = createGuardDb();
      try {
        localDb
          .prepare(
            `INSERT INTO knowledge_entries (id, title, language, constraints)
           VALUES ('callee-rule', 'Calls stay in Safe', ?, ?)`
          )
          .run(
            testCase.language,
            JSON.stringify({
              guards: [
                {
                  type: 'ast',
                  astQuery: {
                    queryType: 'mustCallThrough',
                    params: { targetAPI: testCase.target, wrapperClass: 'Safe' },
                  },
                },
              ],
            })
          );
        const source =
          testCase.source ??
          (testCase.language === 'objectivec'
            ? [
                '@implementation Bad',
                '- (void)run {',
                '  [client log:@"unsafeCall"];',
                '  [client unsafeCall:value];',
                '  [client unsafeCall:value other:second];',
                '}',
                '@end',
              ].join('\n')
            : [
                testCase.language === 'swift'
                  ? 'class Bad { func run() {'
                  : ['java', 'dart'].includes(testCase.language)
                    ? 'class Bad { void run() {'
                    : 'class Bad { run() {',
                `  log("${testCase.target}");`,
                '  unsafeCallExtra();',
                '  unsafeCall();',
                '  api.unsafeCall();',
                testCase.language === 'swift'
                  ? '  let reference = api.unsafeCall'
                  : testCase.language === 'java'
                    ? '  Runnable reference = api::unsafeCall;'
                    : testCase.language === 'dart'
                      ? '  final reference = api.unsafeCall;'
                      : '  const reference = api.unsafeCall;',
                '} }',
              ].join('\n'));
        const result = new GuardCheckEngine(asGuardDb(localDb)).auditFile(testCase.file, source);
        expect(
          result.violations.filter((item) => item.ruleId === 'callee-rule').map((item) => item.line)
        ).toEqual(testCase.lines);
      } finally {
        localDb.close();
      }
    });

    it.each([
      'java',
      'dart',
    ])('allows actual %s calls inside the required wrapper class', (language) => {
      const localDb = createGuardDb();
      try {
        localDb
          .prepare(
            `INSERT INTO knowledge_entries (id, title, language, constraints)
           VALUES ('wrapper-callee', 'Calls stay in Safe', ?, ?)`
          )
          .run(
            language,
            JSON.stringify({
              guards: [
                {
                  type: 'ast',
                  astQuery: {
                    queryType: 'mustCallThrough',
                    params: { targetAPI: 'unsafeCall', wrapperClass: 'Safe' },
                  },
                },
              ],
            })
          );
        const result = new GuardCheckEngine(asGuardDb(localDb)).auditFile(
          `calls.${language}`,
          'class Safe { void run() { unsafeCall(); api.unsafeCall(); } }'
        );
        expect(result.violations.filter((item) => item.ruleId === 'wrapper-callee')).toEqual([]);
        expect(result.uncertainResults).toEqual([]);
      } finally {
        localDb.close();
      }
    });

    it('reads AST guards and fix suggestions persisted by the real knowledge repository', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-guard-persisted-'));
      pathGuard.configure({ projectRoot: root, knowledgeBaseDir: 'Alembic' });
      const runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
      try {
        const repository = createAlembicRepositories(runtime.connection).knowledgeRepository;
        await repository.create(
          new KnowledgeEntry({
            id: 'persisted-ast',
            title: 'Only Safe may call unsafeCall',
            content: { pattern: 'Route unsafeCall through Safe.' },
            language: 'typescript',
            scope: 'file',
            kind: 'rule',
            lifecycle: 'active',
            constraints: {
              guards: [
                {
                  id: 'persisted-ast',
                  type: 'ast',
                  ast_query: {
                    queryType: 'mustCallThrough',
                    params: { targetAPI: 'unsafeCall', wrapperClass: 'Safe' },
                  },
                  severity: 'error',
                  fix_suggestion: 'Move the call into Safe.',
                },
              ],
            },
          })
        );
        const result = new GuardCheckEngine(asGuardDb(runtime.sqlite)).auditFile(
          'bad.ts',
          'class Bad { run() { unsafeCall(); } }'
        );
        expect(result.violations.find((item) => item.ruleId === 'persisted-ast')).toMatchObject({
          severity: 'error',
          fixSuggestion: 'Move the call into Safe.',
        });
      } finally {
        runtime.close();
        pathGuard._reset();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    beforeAll(() => {
      db.prepare(`
        INSERT OR REPLACE INTO knowledge_entries
          (id, title, description, language, kind, knowledgeType, lifecycle, constraints, scope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'custom-rule-1',
        'No TODO comments',
        '禁止提交含 TODO 的代码',
        'swift',
        'rule',
        'boundary-constraint',
        'active',
        JSON.stringify({
          guards: [
            {
              id: 'custom-no-todo',
              name: 'No TODO',
              message: '代码中存在 TODO 注释，请处理后再提交',
              pattern: '//\\s*TODO',
              severity: 'warning',
            },
          ],
        }),
        'file'
      );
      engine.clearCache();
    });

    it('loads database rules alongside built-in rules', () => {
      const rules = engine.getRules('swift');

      expect(rules.find((rule) => rule.id === 'custom-no-todo')?.source).toBe('database');
      expect(rules.find((rule) => rule.id === 'swift-force-cast')).toBeDefined();
      expect(rules.find((rule) => rule.id === 'js-no-eval')).toBeUndefined();
    });

    it('detects violations from database rules', () => {
      const violations = engine.checkCode('// TODO: fix this later\nlet x = 1', 'swift');

      expect(violations.some((violation) => violation.ruleId === 'custom-no-todo')).toBe(true);
    });
  });

  it('emits guard signal once for repeated identical batch summaries', () => {
    const signalBus = { send: vi.fn() } as unknown as GuardEngineSignalBus;
    const signalEngine = new GuardCheckEngine(asGuardDb(createGuardDb()), { signalBus });
    const files = [{ path: 'unsafe.js', content: 'eval("x");' }];

    signalEngine.auditFiles(files);
    signalEngine.auditFiles(files);

    expect(signalBus.send).toHaveBeenCalledTimes(1);
  });
});
