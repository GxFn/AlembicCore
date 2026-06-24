import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..');
const distDir = path.resolve(packageRoot, 'dist');

if (path.dirname(distDir) !== packageRoot || path.basename(distDir) !== 'dist') {
  throw new Error(`Refusing to clean unexpected build output path: ${distDir}`);
}

rmSync(distDir, { recursive: true, force: true });
