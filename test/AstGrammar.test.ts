import { describe, expect, test } from 'vitest';
import { analyzeFile, isAvailable } from '../src/core/AstAnalyzer.js';
import {
  ensureGrammars,
  inferLanguagesFromStats,
  reloadPlugins,
} from '../src/core/ast/ensureGrammars.js';

describe('AST grammar resources', () => {
  test('detects packaged grammar wasm files and reloads plugins', async () => {
    const languages = inferLanguagesFromStats({ ts: 1, py: 1, swift: 1 });
    const result = await ensureGrammars(languages);

    expect(languages).toEqual(expect.arrayContaining(['typescript', 'python', 'swift']));
    expect(result.failed).toEqual([]);
    expect(result.alreadyAvailable).toEqual(expect.arrayContaining(languages));

    await reloadPlugins();
    expect(isAvailable()).toBe(true);
  });

  test('analyzes a TypeScript class when wasm parser is available', async () => {
    await reloadPlugins();
    const summary = analyzeFile(
      `
        export class UserService {
          findUser(id: string) {
            return id;
          }
        }
      `,
      'typescript'
    );

    expect(summary).not.toBeNull();
    expect(summary?.classes.some((item) => item.name === 'UserService')).toBe(true);
  });
});
