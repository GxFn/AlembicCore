import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sha, snapshot, freshness } from './contracts.mjs';
import {
  appendReview,
  readReviewRecords,
  selectFileReview,
  assertAppendOnly,
  projectFileReview,
} from './reviews.mjs';
import { analyze, inspectSourceAnchor } from './analysis.mjs';
import { buildBookIndex, affectedBookEntries } from '../src/book-model.ts';
export function maintenanceProbe() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'core-atlas-maintenance-'));
  try {
    const core = path.join(workspace, 'Core'),
      atlas = path.join(core, 'atlas'),
      ledger = path.join(workspace, 'wakeflow-ledger/AlembicCore');
    for (const p of ['src', 'test', 'config', 'atlas/reviews'])
      fs.mkdirSync(path.join(core, p), { recursive: true });
    fs.writeFileSync(
      path.join(core, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' },
      }),
    );
    const sourcePath = 'src/sample.ts',
      testPath = 'test/sample.test.ts',
      consumerPath = 'config/consumer.json';
    fs.writeFileSync(path.join(core, sourcePath), 'export function sample() { return 1; }\n');
    fs.writeFileSync(path.join(core, testPath), 'sample returns one\n');
    fs.writeFileSync(path.join(core, consumerPath), '{}\n');
    fs.writeFileSync(path.join(atlas, 'reviews/records.json'), '[]\n');
    const sourceA = sha(fs.readFileSync(path.join(core, sourcePath))),
      contextA = snapshot(core, [testPath, consumerPath]).digest;
    const origin = { path: sourcePath, symbol: 'sample', excerpt: 'return 1;' };
    const doc = {
      topicId: '01',
      title: 'fixture',
      sourcePaths: [sourcePath],
      testPaths: [testPath],
      configPaths: [consumerPath],
      consumerRefs: [],
      diagrams: [],
      failureModes: [],
      moduleDetails: [
        {
          id: 'M-fixture',
          name: 'sample',
          entry: origin,
          input: '无',
          output: '值',
          calls: '无',
          sideEffects: '无',
          limits: 'fixture',
        },
      ],
    };
    const journey = {
      id: 'J-fixture',
      title: '值读取',
      question: '值如何变化',
      scope: 'fixture',
      entryApis: [],
      steps: [
        {
          id: 'S-fixture',
          title: '读取',
          relation: 'call',
          moduleRefs: ['M-fixture'],
          edgeRefs: [],
          failureRefs: [],
          input: '无',
          output: '值',
          state: '无持久化',
          action: '调用',
          source: origin,
        },
      ],
      example: { kind: 'illustrative', input: '无', expected: '值', limits: 'fixture' },
      objectRefs: [],
      runRefs: [],
      body: 'fixture',
    };
    const book = buildBookIndex({
      documents: [doc],
      journeys: [journey],
      objects: [],
      runs: [],
      api: { entries: [] },
    });
    const record = (id, hash, previous, value) => ({
      id,
      path: sourcePath,
      sourceSha256: hash,
      readLevel: 'full',
      scope: 'whole-file',
      method: '隔离fixture逐字读取单函数并核对返回值',
      conclusion: `完整文件返回${value}；仅验证维护流程`,
      reviewedAt: new Date().toISOString(),
      responsibility: 'fixture返回值',
      flow: `sample→${value}`,
      supersedesId: previous,
    });
    const spec = path.join(atlas, 'reviews/input.json');
    fs.writeFileSync(spec, JSON.stringify(record('R-fixture-A', sourceA, null, 1)));
    appendReview(atlas, 'reviews/input.json');
    const first = JSON.parse(fs.readFileSync(path.join(atlas, 'reviews/records.json'))),
      oldBytes = fs.readFileSync(path.join(ledger, first[0].path));
    const declared = { truthKind: 'current-code', source: sourceA, context: contextA };
    fs.writeFileSync(path.join(core, sourcePath), 'export function sample() { return 2; }\n');
    const sourceB = sha(fs.readFileSync(path.join(core, sourcePath)));
    assert.equal(freshness(declared, { source: sourceB, context: contextA }), 'source-drift');
    const impact = affectedBookEntries(book, sourcePath);
    assert.equal(impact.journeys[0].id, 'J-fixture');
    const parser = analyze(core, [sourcePath]);
    assert.ok(inspectSourceAnchor(parser, origin).length);
    origin.excerpt = 'return 2;';
    assert.deepEqual(inspectSourceAnchor(parser, origin), []);
    assert.equal(selectFileReview(sourcePath, sourceB, readReviewRecords(ledger, first)), null);
    fs.writeFileSync(spec, JSON.stringify(record('R-fixture-B', sourceB, 'R-fixture-A', 2)));
    appendReview(atlas, 'reviews/input.json');
    const second = JSON.parse(fs.readFileSync(path.join(atlas, 'reviews/records.json')));
    assertAppendOnly(first, second);
    const records = readReviewRecords(ledger, second),
      projected = projectFileReview(null, sourceB, sourcePath, 'fixture-original', records);
    assert.equal(projected.reviewStatus, 'reviewed');
    assert.equal(projected.flow, 'sample→2');
    assert.deepEqual(fs.readFileSync(path.join(ledger, first[0].path)), oldBytes);
    assert.equal(appendReview(atlas, 'reviews/input.json').status, 'unchanged');
    // 冲突先拒绝，不能留下会阻止同ID修正的原始文件。
    const conflict = record('R-fixture-conflict', sourceB, null, 2);
    fs.writeFileSync(spec, JSON.stringify(conflict));
    assert.throws(() => appendReview(atlas, 'reviews/input.json'), /ambiguous/);
    const conflictPath = path.join(
      ledger,
      `architecture-atlas/reviews/${conflict.reviewedAt.slice(0, 10)}/files/${conflict.id}.json`,
    );
    assert.equal(fs.existsSync(conflictPath), false);
    fs.writeFileSync(path.join(core, testPath), 'sample returns two\n');
    const contextB = snapshot(core, [testPath, consumerPath]).digest;
    assert.equal(
      freshness({ ...declared, source: sourceB }, { source: sourceB, context: contextB }),
      'context-drift',
    );
    assert.equal(selectFileReview(sourcePath, sourceB, records).id, 'R-fixture-B');
    fs.writeFileSync(path.join(core, consumerPath), '{"import":"new-entry"}\n');
    const contextC = snapshot(core, [testPath, consumerPath]).digest;
    assert.notEqual(contextB, contextC);
    assert.equal(selectFileReview('src/renamed.ts', sourceB, records), null);
    assert.throws(() => assertAppendOnly(second, first), /append/);
    return {
      scope: 'isolated-fixture',
      affectedJourney: impact.journeys[0].id,
      sourceVersions: { before: sourceA, after: sourceB },
      contextVersions: { before: contextA, testChanged: contextB, consumerChanged: contextC },
      observations: {
        sourceChangedDetected: true,
        journeyLocated: true,
        oldAnchorRejected: true,
        newAnchorVerified: true,
        unreviewedBeforeAppend: true,
        matchingReviewApplied: true,
        oldRawBytesPreserved: true,
        noOpAppendStable: true,
        conflictRejectedBeforeWrite: true,
        testContextDriftDetected: true,
        consumerContextDriftDetected: true,
        fileReviewDoesNotPretendContextCurrent: true,
        renameNotInherited: true,
        historyRemovalRejected: true,
      },
      limitations: [
        '真实文件系统fixture验证维护流程，没有制造Core产品源码变更。',
        '下一次实际Core提交仍需人工重读业务语义，fixture通过不代替审阅。',
      ],
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(maintenanceProbe(), null, 2));
