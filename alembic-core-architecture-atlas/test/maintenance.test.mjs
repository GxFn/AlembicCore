import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maintenanceProbe } from '../scripts/maintenance-probe.mjs';
test('临时工作区完成源码变化→关联定位→旧锚点拒绝→追加复核→再验证，历史字节保持', () => {
  const report = maintenanceProbe();
  assert.equal(report.scope, 'isolated-fixture');
  for (const [key, value] of Object.entries(report.observations)) assert.equal(value, true, key);
  assert.equal(report.affectedJourney, 'J-fixture');
});
