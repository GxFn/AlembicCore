import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('codemod 移动导入方后保持相对依赖目标，同时更新外部引用', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'alembic-codemod-'));
  try {
    for (const dir of ['scripts', 'src/old', 'src/new/nested']) {
      mkdirSync(path.join(root, dir), { recursive: true });
    }
    copyFileSync(
      new URL('../scripts/codemod-rename.mjs', import.meta.url),
      path.join(root, 'scripts/codemod-rename.mjs')
    );
    const original = "import { helper } from '../helper.js';\nexport { helper };\n";
    writeFileSync(path.join(root, 'src/old/client.ts'), original);
    writeFileSync(path.join(root, 'src/helper.ts'), 'export const helper = 1;\n');
    writeFileSync(path.join(root, 'src/main.ts'), "export { helper } from './old/client.js';\n");
    writeFileSync(
      path.join(root, 'renames.json'),
      JSON.stringify([{ from: 'src/old/client.ts', to: 'src/new/nested/client.ts' }])
    );
    const options = { cwd: root, stdio: 'pipe' as const };
    execFileSync('git', ['init', '-q'], options);
    execFileSync('git', ['add', '.'], options);
    const args = ['scripts/codemod-rename.mjs', '--map', 'renames.json'];

    execFileSync(process.execPath, args, options);
    expect(readFileSync(path.join(root, 'src/old/client.ts'), 'utf8')).toBe(original);
    execFileSync(process.execPath, [...args, '--apply'], options);
    expect(readFileSync(path.join(root, 'src/new/nested/client.ts'), 'utf8')).toBe(
      "import { helper } from '../../helper.js';\nexport { helper };\n"
    );
    expect(readFileSync(path.join(root, 'src/main.ts'), 'utf8')).toBe(
      "export { helper } from './new/nested/client.js';\n"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
