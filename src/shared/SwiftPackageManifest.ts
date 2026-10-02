/**
 * Package.swift 的静态解析（没有 Swift 编译器，按文本结构取声明）。
 *
 * 纯函数：给清单正文，返回包名、target、product、依赖与平台。SPM 发现器用它列目标；
 * 认证层用它取"这个包声明了哪些模块名"作为依赖归属的证据。规则只有这一份。
 * 放在 shared：ProjectContext 的代码（repo 之外）不直接引用发现层，两边都从这里取。
 */

export interface SwiftPackageManifest {
  name: string;
  version: string;
  targets: { name: string; type: string; path: string | null; dependencies: string[] }[];
  dependencies: (
    | { url: string; version: string | null; type: string }
    | { path: string; type: string }
  )[];
  products: { name: string; type: string }[];
  platforms: { name: string; version: string }[];
}

export function parseSwiftPackageManifest(content: string): SwiftPackageManifest {
  return {
    name: extractName(content),
    version: extractVersion(content),
    targets: extractTargets(content),
    dependencies: extractDependencies(content),
    products: extractProducts(content),
    platforms: extractPlatforms(content),
  };
}

function extractName(content: string) {
  const m = content.match(/name\s*:\s*"([^"]+)"/);
  return m ? m[1] : 'unknown';
}

function extractVersion(content: string) {
  const m = content.match(/version\s*:\s*"([^"]+)"/);
  return m ? m[1] : '0.0.0';
}

function extractTargets(content: string) {
  const targets: { name: string; type: string; path: string | null; dependencies: string[] }[] = [];
  const re = /\.(?:target|testTarget|executableTarget)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    const type = match[0].includes('testTarget')
      ? 'testTarget'
      : match[0].includes('executableTarget')
        ? 'executableTarget'
        : 'target';

    const startPos = match.index + match[0].length;
    let depth = 1;
    let endPos = startPos;

    while (depth > 0 && endPos < content.length) {
      if (content[endPos] === '(') {
        depth++;
      } else if (content[endPos] === ')') {
        depth--;
      }
      endPos++;
    }

    if (depth === 0) {
      const block = content.substring(startPos, endPos - 1);
      const nameMatch = block.match(/name\s*:\s*"([^"]+)"/);
      if (!nameMatch) {
        continue;
      }

      const pathMatch = block.match(/path\s*:\s*"([^"]+)"/);
      const depsMatch = block.match(/dependencies\s*:\s*\[([^\]]*)\]/s);
      const dependencies: { name: string; index: number }[] = [];
      if (depsMatch) {
        const depRe = /\.(?:product|target)\s*\(\s*name\s*:\s*"([^"]+)"/g;
        let dm: RegExpExecArray | null;
        while ((dm = depRe.exec(depsMatch[1])) !== null) {
          dependencies.push({ name: dm[1], index: dm.index });
        }
        const literalStarts = new Set<number>();
        let nesting = 0;
        let quoted = false;
        let escaped = false;
        for (let index = 0; index < depsMatch[1].length; index++) {
          const character = depsMatch[1][index];
          if (quoted) {
            if (escaped) {
              escaped = false;
            } else if (character === '\\') {
              escaped = true;
            } else if (character === '"') {
              quoted = false;
            }
          } else if (character === '"') {
            quoted = true;
            if (nesting === 0) {
              literalStarts.add(index);
            }
          } else if (character === '(' || character === '[') {
            nesting++;
          } else if (character === ')' || character === ']') {
            nesting--;
          }
        }
        // SPM普通字符串依赖与.product/.target混排时仍保持清单顺序，
        // 不把调用内部的package参数字符串误作另一个依赖。
        const literalRe = /(?:^|,)\s*"([^"]+)"(?=\s*(?:,|$))/g;
        while ((dm = literalRe.exec(depsMatch[1])) !== null) {
          // computedDependency("a", "b", "c")中的参数也不是静态依赖声明。
          if (literalStarts.has(dm.index + dm[0].indexOf('"'))) {
            dependencies.push({ name: dm[1], index: dm.index });
          }
        }
      }

      targets.push({
        name: nameMatch[1],
        type,
        path: pathMatch ? pathMatch[1] : null,
        dependencies: dependencies.sort((a, b) => a.index - b.index).map((dep) => dep.name),
      });
    }
  }

  return targets;
}

function extractDependencies(content: string) {
  const deps: (
    | { url: string; version: string | null; type: string }
    | { path: string; type: string }
  )[] = [];

  const urlRe = /\.package\s*\(\s*url\s*:\s*"([^"]+)"[^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(content)) !== null) {
    const block = m[0];
    const fromMatch = block.match(/from\s*:\s*"([^"]+)"/);
    const exactMatch = block.match(/exact\s*:\s*"([^"]+)"/);
    deps.push({
      url: m[1],
      version: fromMatch ? fromMatch[1] : exactMatch ? exactMatch[1] : null,
      type: 'package',
    });
  }

  const pathRe = /\.package\s*\(\s*path\s*:\s*"([^"]+)"\s*\)/g;
  while ((m = pathRe.exec(content)) !== null) {
    deps.push({
      path: m[1],
      type: 'local',
    });
  }

  return deps;
}

function extractProducts(content: string) {
  const products: { name: string; type: string }[] = [];
  const re = /\.(library|executable)\s*\(\s*name\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    products.push({ name: m[2], type: m[1] });
  }
  return products;
}

function extractPlatforms(content: string) {
  const platforms: { name: string; version: string }[] = [];
  const re = /\.(iOS|macOS|tvOS|watchOS|visionOS)\s*\(\s*\.v(\d+(?:_\d+)?)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    platforms.push({ name: m[1], version: m[2].replace(/_/g, '.') });
  }
  return platforms;
}
