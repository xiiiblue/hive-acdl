// 只读检查当前分支或Pull Request源分支的命名。
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const trackedWorkPattern = /^(?:acl|dfl|erl|issue|req)\/\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const maintenanceBranchPattern = /^(?:fix|docs|refactor|test|build|ci|chore)\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const specialBranchPattern = /^(?:release\/v\d+\.\d+|spike\/[a-z0-9]+(?:-[a-z0-9]+)*|backup\/\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*)$/u;

export function validateBranchName(branchName) {
  if (branchName === '') return { skipped: true, branchName: null };
  if (branchName.length > 80) {
    throw new Error(`分支名超过80个字符：${branchName}`);
  }
  if (branchName === 'main' || trackedWorkPattern.test(branchName)
    || maintenanceBranchPattern.test(branchName) || specialBranchPattern.test(branchName)) {
    return { skipped: false, branchName };
  }
  throw new Error(
    `分支名不符合规范：${branchName}。请使用acl|dfl|erl|issue|req/六位编号-主题，普通维护使用fix|docs|refactor|test|build|ci|chore/主题，特殊分支使用release/v主版本.次版本、spike/主题、backup/YYYYMMDD-主题`,
  );
}

export function detectBranchName({
  environment = process.env,
  spawn = spawnSync,
} = {}) {
  if (environment.GITHUB_HEAD_REF?.trim()) return environment.GITHUB_HEAD_REF.trim();
  if (environment.CI_COMMIT_BRANCH?.trim()) return environment.CI_COMMIT_BRANCH.trim();

  const result = spawn('git', ['branch', '--show-current'], {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`无法读取当前Git分支，退出码为${result.status ?? '未知'}`);
  }
  return result.stdout.trim();
}

function isMainModule() {
  return process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = validateBranchName(detectBranchName());
  console.log(result.skipped
    ? '当前为detached HEAD，跳过分支名检查'
    : `分支名检查通过：${result.branchName}`);
}
