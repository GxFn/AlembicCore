import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const CORE_ROOT = process.cwd();
export const SRC_ROOT = path.join(CORE_ROOT, 'src');

// 三道边界分别保留各自的禁止列表/断言，共享实际文件遍历，避免扫描规则逐渐分叉。
export function listFiles(dir: string, result: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(fullPath, result);
    } else {
      result.push(fullPath);
    }
  }
  return result;
}

export function relativeToCore(fullPath: string): string {
  return path.relative(CORE_ROOT, fullPath).replaceAll(path.sep, '/');
}

export function sourceFilesUnder(relativeDir: string): string[] {
  const dir = path.join(CORE_ROOT, relativeDir);
  return existsSync(dir) ? listFiles(dir).filter((file) => file.endsWith('.ts')) : [];
}
