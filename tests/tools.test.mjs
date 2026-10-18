import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(project, '.tmp'), { recursive: true });
function fixture(t) {
  const root = mkdtempSync(resolve(project, '.tmp/fixture-'));
  for (const name of readdirSync(project)) {
    if (!['.git', '.tmp', 'node_modules'].includes(name)) cpSync(resolve(project, name), resolve(root, name), { recursive: true });
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(root, path, content) { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), content); }
async function mod(root, path) { return import(pathToFileURL(resolve(root, path)).href); }
function run(root, path, args = []) { return execFileSync(process.execPath, [resolve(root, path), ...args], { cwd: root, encoding: 'utf8' }); }

test('分支命名接受工作边界，拒绝无编号/无职责的分支', async t => {
  const root = fixture(t); const { validateBranchName, detectBranchName } = await mod(root, 'scripts/verify/check-branch-name.mjs');
  for (const x of ['main', 'acl/000001-example', 'fix/example', 'release/v1.2']) assert.equal(validateBranchName(x).branchName, x);
  for (const x of ['agent-name', 'acl/example', 'fix/Bad Name']) assert.throws(() => validateBranchName(x));
  assert.equal(detectBranchName({ environment: { GITHUB_HEAD_REF: 'docs/example' } }), 'docs/example');
});
test('Loop纯函数不读来源仓库，模板固定传入提交并拒绝越级状态', async t => {
  const root = fixture(t); const m = await mod(root, 'scripts/lib/loop.mjs');
  assert.equal(m.nextAclNumber('|`ACL-000003`|'), 4);
  assert.equal(m.nextAclNumber(''), 1);
  m.assertLoopTransition('Ready', 'In Progress'); m.assertLoopTransition('Review', 'Completed');
  assert.throws(() => m.assertLoopTransition('Ready', 'Completed')); assert.throws(() => m.assertLoopTransition('Completed', 'In Progress'));
  const text = m.aclRecordTemplate({ date: '2026-01-01', id: 'ACL-000001', source: '示例任务', title: '示例', goal: '验证模板', branch: 'main', revision: 'a'.repeat(40) });
  assert.ok(text.includes('main@' + 'a'.repeat(40))); assert.ok(text.includes('首次统一验证：待填写'));
});
test('设计追踪完整正例、生成器、摘要拒绝与人工复核门禁', async t => {
  const root = fixture(t); const m = await mod(root, 'scripts/lib/traceability.mjs');
  const design = 'docs/02-设计/01-系统设计/SYS-001-示例.md'; const block = '**SEC-001**：示例项目只使用合成输入。';
  put(root, design, '# 示例\n\n' + block + '\n');
  put(root, 'tests/example.mjs', '// TRACE-REQ: SEC-001\n// TRACE-TOPIC: isolation\n');
  const manifest = { $schema: './design-requirements.schema.json', schemaVersion: 2,
    topics: [{ id: 'isolation', title: '隔离', supportingVerification: [{ method: 'test', references: ['tests/example.mjs'] }] }],
    requirements: [{ id: 'SEC-001', source: design, definitionDigest: m.definitionDigest(block), origin: 'pre-req-process', topics: ['isolation'], directVerification: [{ method: 'test', references: ['tests/example.mjs'] }], issues: [] }] };
  assert.deepEqual(m.validateTraceability(manifest, { root }), []);
  put(root, 'tests/traceability/design-requirements.json', JSON.stringify(manifest));
  run(root, 'scripts/generate/render-traceability.mjs'); run(root, 'scripts/verify/check-traceability.mjs');
  put(root, design, '# 示例\n\n' + block + '修改\n');
  assert.ok(m.validateTraceability(manifest, { root }).some(x => x.includes('正文已经变化')));
  assert.notEqual(spawnSync(process.execPath, [resolve(root, 'scripts/generate/refresh-traceability-digests.mjs')]).status, 0);
  run(root, 'scripts/generate/refresh-traceability-digests.mjs', ['--reviewed']); run(root, 'scripts/verify/check-traceability.mjs');
  put(root, 'tests/example.mjs', '// missing marker');
  assert.ok(m.validateTraceability(JSON.parse(readFileSync(resolve(root, 'tests/traceability/design-requirements.json'))), { root }).some(x => x.includes('TRACE-REQ')));
});
test('Issue与ACL必须双向链接，通用GitHub owner/repo可用', async t => {
  const root = fixture(t); const { validateIssueAclRelations } = await mod(root, 'scripts/lib/traceability.mjs');
  const issue = '# 问题\n下一项问题使用`ISSUE-000002`\n\n|问题编号|分类|严重级别|来源|来源编号|状态|外部Issue|处理ACL|问题摘要|\n|---|---|---|---|---|---|---|---|---|\n|ISSUE-000001|缺陷|S2|反馈|—|Ready|[#1](https://github.com/example-org/example-project/issues/1)|[`ACL-000001`](../ACL/ACL-000001-example.md)|示例|\n';
  const loops = '|轮次|工作来源|\n|---|---|\n|`ACL-000001`|[`ISSUE-000001`](../ISSUE/README.md)|\n';
  assert.deepEqual(validateIssueAclRelations({ issueRegistry: issue, loopRegistry: loops, aclDocuments: [] }), []);
  assert.ok(validateIssueAclRelations({ issueRegistry: issue.replace('[`ACL-000001`](../ACL/ACL-000001-example.md)', '—'), loopRegistry: loops, aclDocuments: [] }).some(x => x.includes('反向链接')));
});
test('统计保留时间缺口、首次失败结果和无样本分母', async t => {
  const root = fixture(t); const m = await mod(root, 'scripts/verify/process-metrics.mjs');
  const registryContent = '|`ACL-000001`|—|2026-01-01|Completed|—|—|—|[记录](ACL-000001-example.md)|示例|\n';
  const metrics = m.calculateProcessMetrics({ registryContent, reportDate: '2026-01-03', records: new Map([['ACL-000001-example.md', '> 实际开始时间：2026-01-01\n> 结束时间：2026-01-03\n> 首次统一验证：失败后定点回归通过\n']]) });
  assert.equal(metrics.cycle.median, 2); assert.equal(metrics.validation.failedThenRegression, 1); assert.equal(metrics.validation.firstPassRate, 0);
  const empty = m.calculateProcessMetrics({ registryContent: '', reportDate: '2026-01-03' }); assert.equal(empty.validation.firstPassRate, null);
  assert.throws(() => m.calculateProcessMetrics({ registryContent, since: '2026-02-30', reportDate: '2026-01-03' }));
  assert.match(run(root, 'scripts/verify/process-metrics.mjs', ['--format=json']), /loopCount/);
});
test('链接/锚点、敏感模式和路径越界检查有拒绝案例', async t => {
  const root = fixture(t); const { checkProject, scanText } = await mod(root, 'scripts/verify/check-project.mjs');
  put(root, 'templates/ACL.md', '# 模板\n');
  put(root, 'docs/test.md', '# 正确标题\n\n[标题](#正确标题)\n');
  assert.deepEqual(checkProject(root), []);
  put(root, 'docs/test.md', '[失效](missing.md)\n[锚点](#不存在)\n[越界](../../outside.md)\n');
  assert.equal(checkProject(root).filter(x => x.startsWith('docs/test.md:')).length, 3);
  assert.ok(scanText('gh' + 'p_' + 'a'.repeat(36)).includes('github-token'));
  assert.ok(scanText(['192', '168', '1', '2'].join('.')).includes('private-network'));
  assert.ok(scanText('-----BEGIN ' + 'PRIVATE KEY-----').includes('private-key'));
});
