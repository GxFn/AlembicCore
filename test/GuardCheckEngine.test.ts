/**
 * Integration: GuardCheckEngine
 *
 * 使用 Core 内 in-memory SQLite 验证 Guard 的规则加载、审计、跨文件检查和信号输出。
 */
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { detectLanguage, GuardCheckEngine } from '../src/service/guard/GuardCheckEngine.js';

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
