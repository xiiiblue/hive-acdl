import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { definitionDigest } from './lib/traceability.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function createDemo(root = project) {
  root = realpathSync(root);
  const scratch = resolve(root, '.tmp');
  if (existsSync(scratch) && (lstatSync(scratch).isSymbolicLink() || !lstatSync(scratch).isDirectory())) throw new Error('拒绝非目录或符号链接的.tmp');
  mkdirSync(scratch, { recursive: true });
  const target = mkdtempSync(resolve(scratch, 'acdl-demo-'));
  if (!realpathSync(target).startsWith(realpathSync(scratch) + sep)) throw new Error('示例目录越界');
  for (const name of readdirSync(root)) {
    if (['.git', '.tmp', 'node_modules'].includes(name)) continue;
    const source = resolve(root, name);
    cpSync(source, resolve(target, name), { recursive: true, filter: path => {
      if (lstatSync(path).isSymbolicLink()) throw new Error('示例拒绝复制符号链接');
      return true;
    } });
  }
  const put = (path, content) => { mkdirSync(dirname(resolve(target, path)), { recursive: true }); writeFileSync(resolve(target, path), content); };
  const design = 'docs/02-设计/01-系统设计/SYS-001-合成导出示例.md';
  const requirement = '**SEC-001**：合成导出函数只返回当前示例用户拥有的记录。';
  put('docs/01-需求/REQ-000001-合成导出示例.md', '# REQ-000001：合成导出示例\n\n> 文档状态：Review\n>\n> 责任角色：Director\n\n目标：演示按示例用户筛选记录，并用测试验证不包含其他示例用户记录。\n\n范围仅为纯函数教学，不包含账号认证、数据库、接口或正式业务验收。\n');
  put('docs/01-需求/README.md', '# 需求登记表\n\n|需求编号|状态|摘要|\n|---|---|---|\n|`REQ-000001`|Review|[合成导出示例](REQ-000001-合成导出示例.md)|\n');
  put(design, '# SYS-001：合成导出示例\n\n> 文档状态：Review\n>\n> 责任角色：Director\n\n来源：[REQ-000001](../../01-需求/REQ-000001-合成导出示例.md)。\n\n'+requirement+'\n\n## 实现范围\n\n实现是内存纯函数，调用者传入示例用户与合成数据，不提供生产身份认证。\n');
  put('docs/02-设计/01-系统设计/README.md', '# 系统设计\n\n[SYS-001：合成导出示例](SYS-001-合成导出示例.md)\n');
  put('src/export-demo.mjs', 'export function visibleRecords(user, records) {\n  return records.filter(record => record.owner === user);\n}\n');
  put('tests/export-demo.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleRecords } from '../src/export-demo.mjs';
// TRACE-REQ: SEC-001
// TRACE-TOPIC: demo-export
 test('合成导出只包含当前示例用户记录', () => {
  const records = [{id:1,owner:'demo-user-a'},{id:2,owner:'demo-user-b'},{id:3,owner:'demo-user-a'}];
  assert.deepEqual(visibleRecords('demo-user-a',records).map(record=>record.id),[1,3]);
  assert.deepEqual(visibleRecords('demo-user-c',records),[]);
});
`);
  const manifest = { $schema: './design-requirements.schema.json', schemaVersion: 2,
    topics: [{ id: 'demo-export', title: '合成导出', supportingVerification: [{ method: 'test', references: ['tests/export-demo.test.mjs'] }] }],
    requirements: [{ id: 'SEC-001', source: design, definitionDigest: definitionDigest(requirement),
      origin: 'REQ-000001', topics: ['demo-export'], directVerification: [{ method: 'test', references: ['tests/export-demo.test.mjs'] }], issues: [] }] };
  put('tests/traceability/design-requirements.json', JSON.stringify(manifest, null, 2)+'\n');
  const commands = [
    ['--test', 'tests/export-demo.test.mjs'],
    ['scripts/generate/render-traceability.mjs'],
    ['scripts/verify/check-project.mjs'],
    ['scripts/verify/check-traceability.mjs'],
  ];
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  for (const args of commands) execFileSync(process.execPath, args, { cwd: target, stdio: 'pipe', env: environment });
  return { directory: target, synthetic: true, requirements: 1, commands: commands.map(args => ['node', ...args].join(' ')) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) throw new Error('demo不接受目录或业务参数');
  console.log(JSON.stringify(createDemo(), null, 2));
}
