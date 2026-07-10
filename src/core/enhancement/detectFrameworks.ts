/**
 * @module enhancement/detectFrameworks
 * @description 项目框架检测 — EnhancementRegistry.resolve(primaryLang, detectedFrameworks)
 * 的 detectedFrameworks 生产来源(2026-07-10 链路验通审计补齐)。
 *
 * 背景:14 个增强包全部带 conditions.frameworks,但全仓此前没有任何 detectedFrameworks
 * 生产者——Plugin guard 路径 frameworkAgnostic 恒空集、主体 HTTP 路径无条件全集,
 * 两端都偏离包条件设计。本模块从真实依赖清单(package.json/pyproject/requirements/
 * go.mod/Cargo.toml/gradle/pom)推导框架集合,输出词表与各包 conditions 严格对齐。
 *
 * 设计约束:只读、逐清单容错(单文件失败不影响其余生态)、大小封顶、结果确定性
 * (排序去重)。检测不到就返回空集——调用方(guard 精确 resolve)自然得到零包,
 * 这正是 Swift 等无对应增强包生态的正确答案。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** 单清单读取上限:依赖清单超过此值几乎必为异常产物,跳过防止大文件拖慢 guard 构建。 */
const MAX_MANIFEST_BYTES = 262_144;

export interface DetectedProjectFrameworks {
  /** 检测到的语言集合(与 EnhancementPack.conditions.languages 词表对齐)。 */
  languages: string[];
  /** 检测到的框架集合(与 EnhancementPack.conditions.frameworks 词表对齐)。 */
  frameworks: string[];
  /** 参与判定的清单文件(repo 相对路径),供诊断日志与测试断言。 */
  manifests: string[];
}

/** package.json 依赖名 → 框架 id(react/vue/node-server 等包的 conditions 词表)。 */
const NODE_DEPENDENCY_FRAMEWORKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^react(-dom)?$/, 'react'],
  [/^next$/, 'nextjs'],
  [/^vue$/, 'vue'],
  [/^nuxt$/, 'nuxt'],
  [/^@nestjs\/core$/, 'nestjs'],
  [/^(express|koa|fastify|@hapi\/hapi)$/, 'node-server'],
];

/** Python 依赖名 → 框架 id(django/fastapi/ml/langchain 包词表)。 */
const PYTHON_DEPENDENCY_FRAMEWORKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^django$/i, 'django'],
  [/^fastapi$/i, 'fastapi'],
  [/^langchain(-.+)?$/i, 'langchain'],
  [/^(torch|tensorflow|scikit-learn|sklearn|keras|xgboost|lightgbm)$/i, 'ml'],
];

/** go.mod module path → 框架 id(go-web/go-grpc 包词表)。 */
const GO_MODULE_FRAMEWORKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^google\.golang\.org\/grpc$/, 'grpc'],
  [/^github\.com\/gin-gonic\/gin$/, 'gin'],
  [/^github\.com\/labstack\/echo(\/v\d+)?$/, 'echo'],
  [/^github\.com\/gofiber\/fiber(\/v\d+)?$/, 'fiber'],
  [/^github\.com\/go-chi\/chi(\/v\d+)?$/, 'chi'],
  [/^github\.com\/gorilla\/mux$/, 'gorilla'],
  [/^github\.com\/(beego\/beego(\/v\d+)?|astaxie\/beego)$/, 'beego'],
];

/** Cargo.toml 依赖名 → 框架 id(rust-web/rust-tokio 包词表)。 */
const RUST_DEPENDENCY_FRAMEWORKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^actix-web$/, 'actix-web'],
  [/^axum$/, 'axum'],
  [/^rocket$/, 'rocket'],
  [/^warp$/, 'warp'],
  [/^tokio$/, 'tokio'],
  [/^async-std$/, 'async-std'],
];

/**
 * 从项目根的依赖清单推导 { languages, frameworks }。
 * 任何清单缺失/不可读/超限都静默跳过(guard 构建不能因清单形态被阻断),
 * 全部失败时返回三空数组——调用方按"无匹配包"处理。
 */
export async function detectProjectFrameworks(
  projectRoot: string
): Promise<DetectedProjectFrameworks> {
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const manifests: string[] = [];

  await detectNodeEcosystem(projectRoot, languages, frameworks, manifests);
  await detectPythonEcosystem(projectRoot, languages, frameworks, manifests);
  await detectGoEcosystem(projectRoot, languages, frameworks, manifests);
  await detectRustEcosystem(projectRoot, languages, frameworks, manifests);
  await detectJvmEcosystem(projectRoot, languages, frameworks, manifests);
  await detectAppleEcosystem(projectRoot, languages, manifests);

  return {
    frameworks: [...frameworks].sort(),
    languages: [...languages].sort(),
    manifests: manifests.sort(),
  };
}

async function detectNodeEcosystem(
  projectRoot: string,
  languages: Set<string>,
  frameworks: Set<string>,
  manifests: string[]
): Promise<void> {
  const raw = await readManifest(projectRoot, 'package.json');
  if (raw === null) {
    return;
  }
  manifests.push('package.json');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return; // 损坏的 package.json:语言/框架均不猜测。
  }
  const dependencyNames = collectRecordKeys(parsed.dependencies).concat(
    collectRecordKeys(parsed.devDependencies)
  );
  languages.add('javascript');
  if (
    dependencyNames.includes('typescript') ||
    (await manifestExists(projectRoot, 'tsconfig.json'))
  ) {
    languages.add('typescript');
  }
  matchDependencyFrameworks(dependencyNames, NODE_DEPENDENCY_FRAMEWORKS, frameworks);
}

async function detectPythonEcosystem(
  projectRoot: string,
  languages: Set<string>,
  frameworks: Set<string>,
  manifests: string[]
): Promise<void> {
  const dependencyNames: string[] = [];
  const pyproject = await readManifest(projectRoot, 'pyproject.toml');
  if (pyproject !== null) {
    manifests.push('pyproject.toml');
    // 提取带引号的依赖声明("django>=4"/'fastapi')与 [tool.poetry.dependencies] 键行。
    for (const match of pyproject.matchAll(/["']([A-Za-z0-9_.-]+)\s*[>=<~!;[ "']/g)) {
      dependencyNames.push(match[1]);
    }
    for (const match of pyproject.matchAll(/^([A-Za-z0-9_.-]+)\s*=\s*["'{^]/gm)) {
      dependencyNames.push(match[1]);
    }
  }
  for (const fileName of ['requirements.txt', 'requirements-dev.txt']) {
    const requirements = await readManifest(projectRoot, fileName);
    if (requirements === null) {
      continue;
    }
    manifests.push(fileName);
    for (const line of requirements.split('\n')) {
      const name = line.trim().match(/^([A-Za-z0-9_.-]+)/)?.[1];
      if (name) {
        dependencyNames.push(name);
      }
    }
  }
  if (dependencyNames.length === 0) {
    return;
  }
  languages.add('python');
  matchDependencyFrameworks(dependencyNames, PYTHON_DEPENDENCY_FRAMEWORKS, frameworks);
}

async function detectGoEcosystem(
  projectRoot: string,
  languages: Set<string>,
  frameworks: Set<string>,
  manifests: string[]
): Promise<void> {
  const goMod = await readManifest(projectRoot, 'go.mod');
  if (goMod === null) {
    return;
  }
  manifests.push('go.mod');
  languages.add('go');
  const modulePaths: string[] = [];
  for (const match of goMod.matchAll(/^\s*([a-z0-9.\-/]+\.[a-z]{2,}\/[A-Za-z0-9._\-/]+)\s+v/gm)) {
    modulePaths.push(match[1]);
  }
  matchDependencyFrameworks(modulePaths, GO_MODULE_FRAMEWORKS, frameworks);
}

async function detectRustEcosystem(
  projectRoot: string,
  languages: Set<string>,
  frameworks: Set<string>,
  manifests: string[]
): Promise<void> {
  const cargo = await readManifest(projectRoot, 'Cargo.toml');
  if (cargo === null) {
    return;
  }
  manifests.push('Cargo.toml');
  languages.add('rust');
  const dependencyNames: string[] = [];
  // [dependencies]/[dev-dependencies] 段内的 `name = ...` 行;段外行不算依赖。
  let inDependencySection = false;
  for (const line of cargo.split('\n')) {
    const section = line.trim().match(/^\[([^\]]+)\]/)?.[1];
    if (section !== undefined) {
      inDependencySection = /(^|\.)dependencies$/.test(section) || section === 'dev-dependencies';
      continue;
    }
    if (!inDependencySection) {
      continue;
    }
    const name = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/)?.[1];
    if (name) {
      dependencyNames.push(name);
    }
  }
  matchDependencyFrameworks(dependencyNames, RUST_DEPENDENCY_FRAMEWORKS, frameworks);
}

async function detectJvmEcosystem(
  projectRoot: string,
  languages: Set<string>,
  frameworks: Set<string>,
  manifests: string[]
): Promise<void> {
  const gradleSources: string[] = [];
  for (const fileName of [
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
    'pom.xml',
  ]) {
    const content = await readManifest(projectRoot, fileName);
    if (content === null) {
      continue;
    }
    manifests.push(fileName);
    gradleSources.push(content);
    if (fileName.endsWith('.kts')) {
      languages.add('kotlin');
    }
  }
  if (gradleSources.length === 0) {
    return;
  }
  languages.add('java');
  const combined = gradleSources.join('\n');
  if (/spring-boot|springframework/.test(combined)) {
    frameworks.add('spring');
  }
  if (
    /com\.android\.(application|library)/.test(combined) ||
    (await manifestExists(projectRoot, 'app/src/main/AndroidManifest.xml'))
  ) {
    frameworks.add('android');
    languages.add('kotlin');
  }
}

/**
 * 决策③前置(2026-07-11):Apple 生态语言检测。iOS 项目无 package.json 式框架清单,
 * 此前 detectProjectFrameworks 对 SPM/Xcode 项目三空集 → swift-ios 包(仅语言条件)
 * 永不激活。Package.swift/Podfile/Cartfile 任一存在 → swift+objectivec;
 * frameworks 留空(包不设框架条件,语言命中即激活)。
 */
async function detectAppleEcosystem(
  projectRoot: string,
  languages: Set<string>,
  manifests: string[]
): Promise<void> {
  for (const fileName of ['Package.swift', 'Podfile', 'Cartfile']) {
    if (await manifestExists(projectRoot, fileName)) {
      manifests.push(fileName);
      languages.add('swift');
      languages.add('objectivec');
      return;
    }
  }
}

function matchDependencyFrameworks(
  names: readonly string[],
  table: ReadonlyArray<readonly [RegExp, string]>,
  frameworks: Set<string>
): void {
  for (const name of names) {
    for (const [pattern, frameworkId] of table) {
      if (pattern.test(name)) {
        frameworks.add(frameworkId);
      }
    }
  }
}

function collectRecordKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>);
}

async function readManifest(projectRoot: string, relPath: string): Promise<string | null> {
  try {
    const absolute = path.join(projectRoot, relPath);
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
      return null;
    }
    return await fs.readFile(absolute, 'utf8');
  } catch {
    return null;
  }
}

async function manifestExists(projectRoot: string, relPath: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(projectRoot, relPath))).isFile();
  } catch {
    return false;
  }
}
