import { describe, expect, it } from 'vitest';
import {
  aliasModuleBases,
  inheritedModuleConfigPath,
  parseModuleConfig,
  resolveModuleAliasConfig,
} from '../src/core/linking/index.js';

/** 配置文件文本 → 项目相对的别名配置。 */
function aliases(
  configFilePath: string,
  text: string,
  inherited?: Parameters<typeof resolveModuleAliasConfig>[2]
) {
  const source = parseModuleConfig(text);
  if (!source) {
    throw new Error('module config did not parse');
  }
  return resolveModuleAliasConfig(configFilePath, source, inherited);
}

describe('module alias configuration', () => {
  it('reads baseUrl and paths from a config with comments and trailing commas', () => {
    const config = aliases(
      'tsconfig.json',
      `{
        // 注释与尾随逗号是 tsconfig 的常态
        "compilerOptions": {
          "baseUrl": "./", /* 相对配置文件所在目录 */
          "paths": {
            "@/*": ["src/*"],
            "@shared": ["packages/shared/src/index.ts",],
            "//net/*, }": ["src/net/*"],
          },
        },
      }`
    );

    expect(config).toEqual({
      baseUrl: '',
      paths: [
        { pattern: '@/*', targets: ['src/*'] },
        { pattern: '@shared', targets: ['packages/shared/src/index.ts'] },
        // 字符串里的 `//` 与 `, }` 不是注释，也不是尾随逗号。
        { pattern: '//net/*, }', targets: ['src/net/*'] },
      ],
    });
  });

  it('maps a specifier through the most specific pattern, then through baseUrl', () => {
    const config = aliases(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: 'src',
          paths: {
            '@/*': ['*', 'generated/*'],
            '@/features/*': ['features/*/index'],
            '@exact': ['lib/exact'],
            '*.css': ['styles/*.module'],
          },
        },
      })
    );

    // 前缀更长的模式优先，不看声明顺序。
    expect(aliasModuleBases(config, '@/features/cart')).toEqual(['src/features/cart/index']);
    // 一个模式的多个目标按顺序都是候选。
    expect(aliasModuleBases(config, '@/hooks/useCounter')).toEqual([
      'src/hooks/useCounter',
      'src/generated/hooks/useCounter',
    ]);
    expect(aliasModuleBases(config, '@exact')).toEqual(['src/lib/exact']);
    expect(aliasModuleBases(config, 'theme.css')).toEqual(['src/styles/theme.module']);
    // 没有模式命中：相对 baseUrl。
    expect(aliasModuleBases(config, 'utils/format')).toEqual(['src/utils/format']);
    // 相对说明符不归别名解析。
    expect(aliasModuleBases(config, './local')).toEqual([]);
  });

  it('resolves paths against the config that declares them when there is no baseUrl', () => {
    const config = aliases(
      'packages/web/tsconfig.json',
      JSON.stringify({
        compilerOptions: { paths: { '~/*': ['./src/*'], up: ['../shared/index'] } },
      })
    );

    expect(aliasModuleBases(config, '~/app')).toEqual(['packages/web/src/app']);
    expect(aliasModuleBases(config, 'up')).toEqual(['packages/shared/index']);
    // 没有 baseUrl 时，未命中任何模式的说明符是包名。
    expect(aliasModuleBases(config, 'react')).toEqual([]);
  });

  it('layers a config over the one it extends', () => {
    const base = aliases(
      'config/tsconfig.base.json',
      JSON.stringify({ compilerOptions: { baseUrl: '..', paths: { '@/*': ['src/*'] } } })
    );
    // 子配置没有声明的项沿用继承来的；baseUrl 相对声明它的那份配置。
    expect(
      aliases('tsconfig.json', JSON.stringify({ extends: './config/tsconfig.base.json' }), base)
    ).toEqual(base);
    // 子配置声明了 paths：整体覆盖，目标相对继承来的 baseUrl。
    const child = aliases(
      'apps/web/tsconfig.json',
      JSON.stringify({ compilerOptions: { paths: { '#/*': ['apps/web/app/*'] } } }),
      base
    );
    expect(aliasModuleBases(child, '#/page')).toEqual(['apps/web/app/page']);
    expect(aliasModuleBases(child, '@/page')).toEqual(['@/page']);

    expect(inheritedModuleConfigPath('apps/web/tsconfig.json', '../../config/tsconfig.base')).toBe(
      'config/tsconfig.base.json'
    );
    // 共享预设是包名，不跟随；逃出项目根的路径也不跟随。
    expect(
      inheritedModuleConfigPath('tsconfig.json', '@tsconfig/node20/tsconfig.json')
    ).toBeUndefined();
    expect(inheritedModuleConfigPath('tsconfig.json', '../outside.json')).toBeUndefined();
  });

  it('never produces a path outside the project and tolerates broken input', () => {
    const config = aliases(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          paths: {
            'out/*': ['../elsewhere/*'],
            'abs/*': ['/etc/*'],
            'two*stars*': ['x'],
            ok: ['a'],
          },
        },
      })
    );

    expect(config.paths).toEqual([{ pattern: 'ok', targets: ['a'] }]);
    expect(parseModuleConfig('{ not json')).toBeUndefined();
    expect(parseModuleConfig('[]')).toBeUndefined();
    expect(parseModuleConfig('{}')).toEqual({ extends: [] });
  });
});
