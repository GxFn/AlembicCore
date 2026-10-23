import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBookIndex,
  validateBook,
  searchBook,
  affectedBookEntries,
} from '../src/book-model.ts';
const source = { path: 'src/write.ts', symbol: 'write', excerpt: 'await persist(entry);' };
const testEvidence = { relation: 'none', reason: '无此分支断言' };
const input = {
  documents: [
    {
      topicId: '10',
      title: '知识',
      sourcePaths: ['src/write.ts'],
      testPaths: ['test/write.test.ts'],
      configPaths: [],
      consumerRefs: [],
      moduleDetails: [
        {
          id: 'M10-01',
          aliases: ['旧模块名'],
          name: '写入',
          entry: source,
          input: '实体',
          output: 'ID',
          calls: 'persist',
          sideEffects: '文件',
          limits: '非原子',
          graphRefs: ['write'],
          failureRefs: ['F10-db'],
          apiRefs: ['./knowledge'],
        },
      ],
      failureModes: [
        {
          id: 'F10-db',
          trigger: 'DB失败',
          remainingState: '文件存在',
          automaticAction: '抛错',
          explicitRecovery: '显式sync',
          stopCondition: '不得盲目重建',
          source,
          test: testEvidence,
          moduleRefs: ['M10-01'],
          graphRefs: ['write'],
          apiRefs: ['./knowledge'],
        },
      ],
      diagrams: [
        {
          id: 'write',
          title: '写入',
          nodes: [],
          edges: [{ id: 'write-1', source, test: testEvidence }],
        },
      ],
    },
  ],
  api: { entries: [{ name: './knowledge', policy: 'stable-public' }] },
  journeys: [
    {
      id: 'J01',
      title: '知识提交',
      question: '何时完成',
      scope: 'Core',
      entryApis: ['./knowledge'],
      steps: [
        {
          id: 'J01-S1',
          title: '提交',
          relation: 'call',
          moduleRefs: ['M10-01'],
          edgeRefs: ['write/write-1'],
          failureRefs: ['F10-db'],
          input: '实体',
          output: 'ID',
          state: '文件',
          action: '显式提交',
          source,
        },
      ],
      example: { kind: 'illustrative', input: '示例', expected: '字段', limits: '未执行' },
      objectRefs: ['O01'],
      runRefs: ['V01'],
      body: '说明',
    },
  ],
  objects: [
    {
      id: 'O01',
      title: '文件真相',
      producer: 'write',
      consumer: 'sync',
      persistence: '文件',
      identity: 'ID',
      invalidation: '更新',
      states: [{ name: '写入', meaning: '文件已有' }],
      moduleRefs: ['M10-01'],
      failureRefs: ['F10-db'],
      source,
    },
  ],
  runs: [
    {
      id: 'V01',
      title: '恢复样本',
      status: 'not-run',
      journeyRefs: ['J01'],
      failureRefs: ['F10-db'],
      sourcePaths: ['src/write.ts'],
      testFiles: ['test/write.test.ts'],
    },
  ],
};
test('真实搜索投影精确到稳定模块/失败锚点，改标题不改变链接', () => {
  const book = buildBookIndex(input);
  assert.deepEqual(validateBook(input), []);
  assert.equal(searchBook(book, 'F10-db')[0].route, '#10~f-F10-db');
  assert.equal(searchBook(book, 'M10-01')[0].route, '#10~m-M10-01');
  const changed = structuredClone(input);
  changed.documents[0].moduleDetails[0].name = '新名称';
  const module = buildBookIndex(changed).modules[0];
  assert.equal(module.route, book.modules[0].route);
  assert.deepEqual(module.aliases, ['旧模块名']);
  assert.equal(module.journeys[0].route, '#journeys~J01-S1');
});
test('孤立引用、错入口、重复模块及伪造步骤关系不能进入图谱', () => {
  for (const mutate of [
    (x) => (x.journeys[0].steps[0].edgeRefs = ['write/missing']),
    (x) => (x.journeys[0].steps[0].moduleRefs = ['M00-x']),
    (x) => (x.objects[0].failureRefs = ['missing']),
    (x) => (x.journeys[0].entryApis = ['./retired']),
    (x) => x.documents[0].moduleDetails.push(x.documents[0].moduleDetails[0]),
    (x) => (x.journeys[0].steps[0].relation = 'automatic-rescue'),
  ]) {
    const copy = structuredClone(input);
    mutate(copy);
    assert.ok(validateBook(copy).length);
  }
});
test('变更复核沿显式引用定位场景和运行证据，不虚构额外调用', () => {
  const book = buildBookIndex(input);
  const impact = affectedBookEntries(book, 'src/write.ts');
  assert.deepEqual(
    impact.modules.map((x) => x.id),
    ['M10-01'],
  );
  assert.deepEqual(
    impact.failures.map((x) => x.id),
    ['F10-db'],
  );
  assert.deepEqual(
    impact.journeys.map((x) => x.id),
    ['J01'],
  );
  assert.deepEqual(
    impact.runs.map((x) => x.id),
    ['V01'],
  );
  assert.deepEqual(affectedBookEntries(book, 'src/unknown.ts').journeys, []);
});
test('未运行和none保持原义，空查询不返回虚假匹配', () => {
  const book = buildBookIndex(input);
  assert.equal(book.runs[0].status, 'not-run');
  assert.equal(book.failures[0].test.relation, 'none');
  assert.deepEqual(searchBook(book, '  '), []);
});
