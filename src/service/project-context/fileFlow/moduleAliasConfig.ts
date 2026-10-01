import path from 'node:path';
import {
  inheritedModuleConfigPath,
  MODULE_CONFIG_FILE_NAMES,
  type ModuleAliasConfig,
  parseModuleConfig,
  resolveModuleAliasConfig,
} from '../../../core/linking/moduleAliases.js';
import Logger from '../../../infrastructure/logging/Logger.js';
import type { ProjectSourceReader } from '../../../types/projectSourceReader.js';
import type { FileAnalysisSession } from '../analysis/FileAnalysisSession.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';

/** 继承链的跟随上限；真实项目的配置继承只有两三层。 */
const MAX_EXTENDS_DEPTH = 4;

export interface ModuleAliasConfigInput {
  importerFile: string;
  projectRoot: string;
  reader: ProjectSourceReader;
  signal?: AbortSignal;
  /** 有会话时，同一目录的配置在会话内只读一次；没有会话的单次查询每次都读。 */
  analysis?: FileAnalysisSession;
}

/**
 * 导入方适用的别名配置：从它所在目录向上找最近的 tsconfig.json / jsconfig.json，
 * 并叠加上配置继承的内容。
 *
 * 配置文件经输入读取器读取：live 查询读当前文件，认证捕获把它（以及"这个目录下没有配置"）
 * 记入输入闭包，重放得到同一份配置。项目里没有配置文件时返回 undefined。
 */
export function loadModuleAliasConfig(
  input: ModuleAliasConfigInput
): Promise<ModuleAliasConfig | undefined> {
  return configForDirectory(input, path.posix.dirname(input.importerFile));
}

function configForDirectory(
  input: ModuleAliasConfigInput,
  directory: string
): Promise<ModuleAliasConfig | undefined> {
  const normalized = directory === '.' ? '' : directory;
  const load = async (): Promise<ModuleAliasConfig | undefined> => {
    for (const name of MODULE_CONFIG_FILE_NAMES) {
      const configFile = normalized ? `${normalized}/${name}` : name;
      const config = await readConfig(input, configFile, 0);
      if (config) {
        return config;
      }
    }
    // 本目录没有配置：沿用上级目录的。到项目根为止。
    return normalized === ''
      ? undefined
      : configForDirectory(input, path.posix.dirname(normalized));
  };
  return input.analysis
    ? input.analysis.shared(
        input.reader,
        `module-alias-config:${input.projectRoot}:${normalized}`,
        load
      )
    : load();
}

async function readConfig(
  input: ModuleAliasConfigInput,
  configFile: string,
  depth: number
): Promise<ModuleAliasConfig | undefined> {
  throwIfProjectContextAborted({ signal: input.signal });
  const absolutePath = path.resolve(input.projectRoot, configFile);
  const options = { signal: input.signal };
  try {
    if (!(await input.reader.stat(absolutePath, options)).isFile()) {
      return undefined;
    }
  } catch {
    // 与模块候选的存在性探测同一口径：读取器记录下"不存在"，这里按没有配置处理。
    throwIfProjectContextAborted({ signal: input.signal });
    return undefined;
  }
  const source = parseModuleConfig(
    new TextDecoder().decode(await input.reader.readFile(absolutePath, options))
  );
  if (!source) {
    Logger.warn('ProjectContext ignores a module config it cannot parse', {
      configFile,
      nextAction: 'fix_tsconfig_syntax',
    });
    return undefined;
  }
  let inherited: ModuleAliasConfig | undefined;
  for (const reference of source.extends) {
    const parent = inheritedModuleConfigPath(configFile, reference);
    if (!parent || depth >= MAX_EXTENDS_DEPTH) {
      Logger.debug('ProjectContext does not follow a module config extends reference', {
        configFile,
        reference,
        reason: parent ? 'extends-depth-limit' : 'package-or-outside-project',
      });
      continue;
    }
    // 多个 extends 时后面的覆盖前面的，与 TypeScript 一致。
    const loaded = await readConfig(input, parent, depth + 1);
    inherited = loaded
      ? {
          ...(loaded.baseUrl === undefined
            ? inherited?.baseUrl === undefined
              ? {}
              : { baseUrl: inherited.baseUrl }
            : { baseUrl: loaded.baseUrl }),
          paths: loaded.paths.length > 0 ? loaded.paths : (inherited?.paths ?? []),
        }
      : inherited;
  }
  return resolveModuleAliasConfig(configFile, source, inherited);
}
