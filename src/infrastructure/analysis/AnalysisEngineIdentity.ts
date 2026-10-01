import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { hashBytes, hashCanonicalJson } from '../../shared/canonicalJson.js';
import { RESOURCES_DIR } from '../../shared/packageRoot.js';

/**
 * 自有分析规则的版本：语法提取、文件事实、链接。凡是会改变分析输出的修改都要提高它，
 * 依赖分析结果的缓存（认证工件、索引代际、宿主的共享构建）据此失效。
 */
const ANALYSIS_VERSION = 'alembic-analysis-v1';

export interface AnalysisEngineIdentity {
  /** 分析引擎的身份；相同的值意味着相同输入得到相同的分析结果。 */
  engineHash: `sha256:${string}`;
  engine: {
    analysisVersion: string;
    /** 全部语法包的内容哈希：语法包更新会改变解析结果。 */
    grammarsHash: `sha256:${string}`;
    languages: string[];
  };
}

// 惰性槽：语法包随安装包发布、进程内不变，身份只算一次（约 18 MB 的哈希）。
let _identity: Promise<AnalysisEngineIdentity> | null = null;

/**
 * 只读身份查询，不启动任何进程。身份由分析规则版本与语法包内容决定，与 Node 版本、
 * 操作系统无关：同一套规则与语法包在任何宿主上给出相同的结果。
 */
export function getAnalysisEngineIdentity(): Promise<AnalysisEngineIdentity> {
  _identity ??= computeIdentity().catch((error: unknown) => {
    // 失败不缓存：语法资源就绪之后的下一次调用应当成功。
    _identity = null;
    throw error;
  });
  return _identity;
}

async function computeIdentity(): Promise<AnalysisEngineIdentity> {
  const directory = path.join(RESOURCES_DIR, 'grammars');
  const names = (await readdir(directory)).filter((name) => name.endsWith('.wasm')).sort();
  const grammars = await Promise.all(
    names.map(async (name) => ({
      name,
      hash: hashBytes(await readFile(path.join(directory, name))),
    }))
  );
  const engine = {
    analysisVersion: ANALYSIS_VERSION,
    grammarsHash: hashCanonicalJson(grammars),
    languages: names.map((name) => name.replace(/^tree-sitter-/, '').replace(/\.wasm$/, '')),
  };
  return { engine, engineHash: hashCanonicalJson(engine) };
}
