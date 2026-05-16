/**
 * GuardCheckEngine scope filtering
 *
 * 验证 universal 维度规则在 file/target/project scope 下都不会被误过滤。
 */
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { GuardCheckEngine } from '../../src/service/guard/GuardCheckEngine.js';

type GuardEngineDb = ConstructorParameters<typeof GuardCheckEngine>[0];

function createMinimalDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      language TEXT,
      scope TEXT,
      constraints TEXT,
      lifecycle TEXT DEFAULT 'active',
      kind TEXT DEFAULT 'rule',
      knowledgeType TEXT,
      stats TEXT DEFAULT '{}',
      updatedAt INTEGER DEFAULT 0
    );
  `);
  return db;
}

function asGuardDb(db: Database.Database): GuardEngineDb {
  return db as unknown as GuardEngineDb;
}

function insertGuardRule(
  db: Database.Database,
  rule: {
    id: string;
    title: string;
    language: string;
    scope: string;
    pattern: string;
    severity: string;
    message: string;
  }
) {
  db.prepare(`
    INSERT INTO knowledge_entries (id, title, description, language, scope, constraints, lifecycle, kind, knowledgeType)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rule.id,
    rule.title,
    rule.message,
    rule.language,
    rule.scope,
    JSON.stringify({
      guards: [
        {
          id: rule.id,
          pattern: rule.pattern,
          severity: rule.severity,
          message: rule.message,
        },
      ],
    }),
    'active',
    'rule',
    'boundary-constraint'
  );
}

describe('GuardCheckEngine scope filtering', () => {
  it('includes universal-dimension rules when scope=project', () => {
    const db = createMinimalDb();
    insertGuardRule(db, {
      id: 'test-universal-force-unwrap',
      title: 'No force unwrap',
      language: 'swift',
      scope: 'universal',
      pattern: '\\w+!\\.',
      severity: 'error',
      message: 'Avoid force unwrap',
    });

    const engine = new GuardCheckEngine(asGuardDb(db));
    const resultWithScope = engine.auditFile('test.swift', 'let x = foo!.bar', {
      scope: 'project',
    });
    const resultNoScope = engine.auditFile('test.swift', 'let x = foo!.bar');

    expect(resultNoScope.violations.length).toBeGreaterThan(0);
    expect(resultWithScope.violations.length).toBeGreaterThan(0);
    expect(resultWithScope.violations.length).toBe(resultNoScope.violations.length);

    db.close();
  });

  it('includes universal-dimension rules when scope=file', () => {
    const db = createMinimalDb();
    insertGuardRule(db, {
      id: 'test-universal-print',
      title: 'No print',
      language: 'swift',
      scope: 'universal',
      pattern: '\\bprint\\s*\\(',
      severity: 'warning',
      message: 'Use Logger instead of print()',
    });

    const engine = new GuardCheckEngine(asGuardDb(db));
    const result = engine.auditFile('test.swift', 'print("hello")', { scope: 'file' });

    expect(result.violations.some((v) => v.ruleId === 'test-universal-print')).toBe(true);

    db.close();
  });

  it('filters project-only dimensions out of file scope', () => {
    const db = createMinimalDb();
    insertGuardRule(db, {
      id: 'test-project-rule',
      title: 'Project-only check',
      language: 'swift',
      scope: 'project',
      pattern: '\\bTODO\\b',
      severity: 'info',
      message: 'TODO found',
    });

    const engine = new GuardCheckEngine(asGuardDb(db));
    const resultFile = engine.auditFile('test.swift', '// TODO: fix this', { scope: 'file' });
    const resultProject = engine.auditFile('test.swift', '// TODO: fix this', {
      scope: 'project',
    });

    expect(resultFile.violations.some((v) => v.ruleId === 'test-project-rule')).toBe(false);
    expect(resultProject.violations.some((v) => v.ruleId === 'test-project-rule')).toBe(true);

    db.close();
  });
});
