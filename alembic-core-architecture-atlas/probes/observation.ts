import fs from 'node:fs';
import path from 'node:path';

// 只在受控runner给出的ignored目录写观察；测试本身必须先断言，再保存实际读回值。
export function observeCase(
  scenario: string,
  caseId: string,
  observationId: string,
  data: Record<string, unknown>,
) {
  const location = process.env.ATLAS_OBSERVATION_DIR;
  if (!location) return;
  const target = path.resolve(location);
  const allowed = path.resolve(import.meta.dirname, '../.build/runs') + path.sep;
  if (
    !target.startsWith(allowed) ||
    !/^V\d\d$/.test(scenario) ||
    !/^[A-Z0-9-]+$/.test(caseId) ||
    !/^[a-z0-9-]+$/.test(observationId)
  )
    throw Error('Atlas observation outside fixed scope');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, `${caseId}-${observationId}.json`),
    JSON.stringify({ ...data, scenario, caseId, observationId }, null, 2) + '\n',
    { flag: 'wx' },
  );
}
