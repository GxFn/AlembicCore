import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepContentMarkdown, validateDeepContent } from '../src/deep-content.ts';
const source = { path: 'src/a.ts', symbol: 'commit', excerpt: 'await write();' };
const content = {
  moduleDetails: [
    {
      name: '提交',
      entry: source,
      input: '准备实体',
      output: '读回实体',
      calls: '文件→数据库',
      sideEffects: '有耐久文件',
      limits: '衍生效果不原子',
    },
  ],
  failureModes: [
    {
      id: 'f1',
      trigger: 'DB失败',
      remainingState: '文件已经写入',
      automaticAction: '抛出DivergenceError',
      explicitRecovery: '调用者排故后显式sync',
      stopCondition: '不得自动声明回滚',
      source,
      test: { relation: 'none', reason: '缺少对应断言' },
    },
  ],
};
test('同一结构生成函数说明、落盘状态和恢复边界，none不变成通过', () => {
  const md = deepContentMarkdown(content);
  for (const value of [
    '准备实体',
    '读回实体',
    '文件已经写入',
    '显式sync',
    '不得自动声明回滚',
    '缺少对应断言',
    'src/a.ts#commit',
  ])
    assert.ok(md.includes(value));
  assert.deepEqual(validateDeepContent(content), []);
});
test('缺恢复责任、重复失败ID、缺来源或none理由均拒绝', () => {
  for (const mutate of [
    (d) => delete d.failureModes[0].explicitRecovery,
    (d) => d.failureModes.push(d.failureModes[0]),
    (d) => delete d.moduleDetails[0].entry,
    (d) => delete d.failureModes[0].test.reason,
  ]) {
    const d = structuredClone(content);
    mutate(d);
    assert.ok(validateDeepContent(d).length);
  }
});
test('原始代码的反引号不能跳出生成代码围栏', () => {
  const d = structuredClone(content);
  d.failureModes[0].source.excerpt = 'const sample = "```";';
  assert.ok(deepContentMarkdown(d).includes('````ts'));
});
