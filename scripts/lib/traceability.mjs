import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractIssueRows, splitMarkdownRow } from './governance/issue-registry.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = resolve(repositoryRoot, 'tests/traceability/design-requirements.json');
const schemaPath = resolve(repositoryRoot, 'tests/traceability/design-requirements.schema.json');
export const trackingDocumentPath = resolve(repositoryRoot, 'docs/02-设计/00-索引与追踪/IDX-002-设计要求与验证追踪.md');
const generatedStart = '<!-- TRACEABILITY-GENERATED:START -->';
const generatedEnd = '<!-- TRACEABILITY-GENERATED:END -->';
const definitionPattern = /^\*\*((?:PRD|DOM|ARCH|SEC)-\d{3})\*\*：/gm;
const currentDesignRoots = [
  'docs/02-设计/01-系统设计',
  'docs/02-设计/02-能力设计',
  'docs/02-设计/03-横切设计',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function extractRequirementDefinitions(content) {
  const starts = [...content.matchAll(definitionPattern)];
  const headings = [...content.matchAll(/^#{1,6}\s.+$/gm)].map(({ index }) => index);
  return starts.map((match, index) => {
    const nextRequirement = starts[index + 1]?.index ?? content.length;
    const nextHeading = headings.find((headingIndex) => headingIndex > match.index) ?? content.length;
    const next = Math.min(nextRequirement, nextHeading);
    const block = content.slice(match.index, next).replace(/\s+$/u, '');
    return { id: match[1], block };
  });
}

export function definitionDigest(block) {
  return `sha256:${createHash('sha256').update(block).digest('hex')}`;
}

function listMarkdownFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(path);
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}

export function collectCurrentDefinitions(root = repositoryRoot) {
  const definitions = new Map();
  for (const relativeRoot of currentDesignRoots) {
    for (const path of listMarkdownFiles(resolve(root, relativeRoot))) {
      for (const { id, block } of extractRequirementDefinitions(readFileSync(path, 'utf8'))) {
        const entries = definitions.get(id) ?? [];
        entries.push({
          path: relative(root, path).replaceAll('\\', '/'),
          definitionDigest: definitionDigest(block),
        });
        definitions.set(id, entries);
      }
    }
  }
  return definitions;
}

function pushDuplicateErrors(values, label, errors) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${label}重复：${value}`);
    seen.add(value);
  }
}

function pushUnknownPropertyErrors(value, allowed, label, errors) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}包含未知字段：${key}`);
}

export function hasTestTraceMarker(content, { coverage, requirementId, topicId }) {
  if (coverage === 'direct') return content.includes(`TRACE-REQ: ${requirementId}`);
  if (coverage === 'supporting') return content.includes(`TRACE-TOPIC: ${topicId}`);
  return false;
}

function referencedAclIds(content) {
  return [...content.matchAll(/`(ACL-\d{6})`/gu)].map((match) => match[1]);
}

function referencedIssueIds(content) {
  return [...content.matchAll(/ISSUE-\d{6}/gu)].map((match) => match[0]);
}

function sameIds(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

export function validateIssueAclRelations({ aclDocuments, issueRegistry, loopRegistry }) {
  const errors = [];
  const issueDefinitions = new Map();
  const allowedIssueStatuses = new Set([
    'Reported', 'Triage', 'Ready', 'In Progress', 'Verification', 'Closed', 'Not Planned', 'Duplicate',
  ]);
  for (const line of issueRegistry.split('\n')) {
    const cells = splitMarkdownRow(line);
    if (cells?.[0] === '问题编号' && (!cells.includes('状态') || !cells.includes('外部Issue') || !cells.includes('处理ACL'))) {
      errors.push('ISSUE台账必须包含状态、外部Issue和处理ACL列');
    }
  }

  const issueRows = extractIssueRows(issueRegistry);
  const externalIssues = new Map();
  for (const issue of issueRows) {
    const definitions = issueDefinitions.get(issue.id) ?? [];
    definitions.push(issue);
    issueDefinitions.set(issue.id, definitions);
    if (!allowedIssueStatuses.has(issue.status)) errors.push(`${issue.id}使用未知状态：${issue.status}`);
    if (!/^S[0-3]$/u.test(issue.severity ?? '')) errors.push(`${issue.id}使用未知严重级别：${issue.severity}`);
    if (issue.external === null) {
      errors.push(`${issue.id}缺少外部Issue列`);
    } else if (issue.external !== '—') {
      const match = issue.external.match(/^\[#(\d+)\]\(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/(\d+)\)$/u);
      if (match === null || match[1] !== match[2]) {
        errors.push(`${issue.id}的外部Issue列格式无效`);
      } else {
        const definitions = externalIssues.get(issue.external) ?? [];
        definitions.push(issue.id);
        externalIssues.set(issue.external, definitions);
      }
    }
    const aclIds = referencedAclIds(issue.processing);
    pushDuplicateErrors(aclIds, `${issue.id}的处理ACL`, errors);
    if (issue.processing !== '—' && aclIds.length === 0) errors.push(`${issue.id}的处理ACL列格式无效`);
  }
  for (const [issueId, definitions] of issueDefinitions) {
    if (definitions.length !== 1) errors.push(`${issueId}在ISSUE台账中定义${definitions.length}次`);
  }
  for (const [external, issueIds] of externalIssues) {
    if (issueIds.length > 1) errors.push(`${external}被多个本地Issue关联：${issueIds.join('、')}`);
  }
  const issueNumbers = issueRows.map(({ id }) => Number(id.slice(-6)));
  for (const [index, number] of issueNumbers.entries()) {
    if (number !== index + 1) errors.push(`ISSUE台账编号不连续：第${index + 1}项是ISSUE-${String(number).padStart(6, '0')}`);
  }
  const nextHint = issueRegistry.match(/下一项问题使用`ISSUE-(\d{6})`/u)?.[1];
  const expectedNext = String(issueRows.length + 1).padStart(6, '0');
  if (nextHint !== expectedNext) errors.push(`ISSUE台账下一编号提示应为ISSUE-${expectedNext}`);

  const registeredAcls = new Map();
  let aclSourceColumn = null;
  for (const line of loopRegistry.split('\n')) {
    const cells = splitMarkdownRow(line);
    if (cells?.[0] === '轮次') {
      const workSourceColumn = cells.indexOf('工作来源');
      aclSourceColumn = workSourceColumn >= 0 ? workSourceColumn : cells.indexOf('来源');
      if (aclSourceColumn < 0) errors.push('ACL登记表缺少来源列');
      continue;
    }
    const aclId = cells?.[0]?.match(/ACL-\d{6}/u)?.[0];
    if (aclId === undefined) continue;
    const sourceColumn = aclSourceColumn ?? 3;
    if (cells.length <= sourceColumn) {
      errors.push(`${aclId}在ACL登记表中缺少工作来源列`);
      continue;
    }
    registeredAcls.set(aclId, cells[sourceColumn]);
  }

  for (const [aclId, source] of registeredAcls) {
    const issueIds = referencedIssueIds(source);
    pushDuplicateErrors(issueIds, `${aclId}工作来源中的Issue`, errors);
    for (const issueId of issueIds) {
      const definition = issueDefinitions.get(issueId)?.[0];
      if (definition === undefined) {
        errors.push(`${aclId}引用未定义Issue：${issueId}`);
      } else if (!new RegExp(`\\[[^\\]]*${issueId}[^\\]]*\\]\\([^)]+\\)`, 'u').test(source)) {
        errors.push(`${aclId}的Issue工作来源必须使用链接：${issueId}`);
      } else if (!referencedAclIds(definition.processing).includes(aclId)) {
        errors.push(`${aclId}引用${issueId}，但ISSUE台账没有反向链接`);
      }
    }
  }

  for (const [issueId, definitions] of issueDefinitions) {
    if (definitions.length !== 1) continue;
    for (const aclId of referencedAclIds(definitions[0].processing)) {
      const source = registeredAcls.get(aclId);
      if (source === undefined) {
        errors.push(`${issueId}引用未登记ACL：${aclId}`);
      } else if (!referencedIssueIds(source).includes(issueId)) {
        errors.push(`${issueId}引用${aclId}，但ACL工作来源没有反向链接`);
      }
    }
  }

  for (const document of aclDocuments) {
    const aclId = document.path.match(/ACL-\d{6}/u)?.[0];
    if (aclId === undefined || !registeredAcls.has(aclId)) continue;
    const expected = referencedIssueIds(registeredAcls.get(aclId));
    const source = document.content.match(/^> 工作来源：(.+)$/mu)?.[1];
    const actual = referencedIssueIds(source ?? '');
    if ((expected.length > 0 || actual.length > 0) && !sameIds(expected, actual)) {
      errors.push(`${document.path}的工作来源与Loop登记表中的Issue不一致`);
    }
  }
  return errors;
}

export function validateTraceability(manifest, { root = repositoryRoot } = {}) {
  const errors = [];
  pushUnknownPropertyErrors(manifest, new Set(['$schema', 'schemaVersion', 'topics', 'requirements']), '账本', errors);
  if (manifest?.$schema !== './design-requirements.schema.json') {
    errors.push('$schema必须为./design-requirements.schema.json');
  }
  if (manifest?.schemaVersion !== 2) errors.push('schemaVersion必须为2');
  if (!Array.isArray(manifest?.topics)) errors.push('topics必须是数组');
  if (!Array.isArray(manifest?.requirements)) errors.push('requirements必须是数组');
  if (errors.length > 0) return errors;

  const definitions = collectCurrentDefinitions(root);
  for (const [id, entries] of definitions) {
    if (entries.length !== 1) errors.push(`${id}在当前设计中定义${entries.length}次：${entries.map(({ path }) => path).join('、')}`);
  }

  const loopRegistry = readFileSync(resolve(root, 'docs/03-实施/ACL/README.md'), 'utf8');
  const issueRegistry = readFileSync(resolve(root, 'docs/03-实施/ISSUE/README.md'), 'utf8');
  errors.push(...validateIssueAclRelations({
    aclDocuments: listMarkdownFiles(resolve(root, 'docs/03-实施/ACL')).map((path) => ({
      content: readFileSync(path, 'utf8'), path: relative(root, path).replaceAll('\\', '/'),
    })),
    issueRegistry,
    loopRegistry,
  }));
  const requirementRegistry = readFileSync(resolve(root, 'docs/01-需求/README.md'), 'utf8');
  const topicIds = manifest.topics.map((topic) => topic.id);
  pushDuplicateErrors(topicIds, '主题ID', errors);
  for (const [index, topic] of manifest.topics.entries()) {
    const label = `topics[${index}]`;
    pushUnknownPropertyErrors(topic, new Set(['id', 'title', 'supportingVerification']), label, errors);
    if (!/^[a-z0-9-]+$/.test(topic.id ?? '')) errors.push(`${label}.id格式错误`);
    if (typeof topic.title !== 'string' || topic.title.length === 0) errors.push(`${label}.title不能为空`);
    const verifications = Array.isArray(topic.supportingVerification) ? topic.supportingVerification : [];
    if (verifications.length === 0) errors.push(`${topic.id}至少需要一种支持性验证`);
    for (const [verificationIndex, verification] of verifications.entries()) {
      const verificationLabel = `${topic.id}.supportingVerification[${verificationIndex}]`;
      pushUnknownPropertyErrors(verification, new Set(['method', 'references', 'note']), verificationLabel, errors);
      if (!['test', 'inspection', 'analysis', 'demonstration'].includes(verification.method)) {
        errors.push(`${verificationLabel}.method无效`);
      }
      const references = Array.isArray(verification.references) ? verification.references : [];
      if (references.length === 0) errors.push(`${verificationLabel}至少需要一个引用`);
      pushDuplicateErrors(references, `${verificationLabel}.references`, errors);
      for (const reference of references) {
        const absoluteReference = resolve(root, reference);
        if (!existsSync(absoluteReference)) {
          errors.push(`${verificationLabel}引用不存在：${reference}`);
          continue;
        }
        if (/\b(?:stage0|p0)\b/i.test(reference)) errors.push(`${topic.id}不能引用历史测试：${reference}`);
        if (verification.method === 'test'
          && !hasTestTraceMarker(readFileSync(absoluteReference, 'utf8'), { coverage: 'supporting', topicId: topic.id })) {
          errors.push(`${reference}缺少TRACE-TOPIC: ${topic.id}`);
        }
      }
    }
  }

  const ledgerIds = manifest.requirements.map((requirement) => requirement.id);
  pushDuplicateErrors(ledgerIds, '账本稳定设计要求', errors);
  const ledgerSet = new Set(ledgerIds);
  const usedTopics = new Set();
  for (const [index, requirement] of manifest.requirements.entries()) {
    const label = `requirements[${index}]`;
    pushUnknownPropertyErrors(requirement, new Set([
      'id', 'source', 'definitionDigest', 'origin', 'topics', 'directVerification', 'issues',
    ]), label, errors);
    if (!/^(?:PRD|DOM|ARCH|SEC)-\d{3}$/.test(requirement.id ?? '')) errors.push(`${label}.id格式错误`);
    const entries = definitions.get(requirement.id) ?? [];
    if (!currentDesignRoots.some((path) => requirement.source?.startsWith(`${path}/`))) {
      errors.push(`${requirement.id}的source不是当前设计路径：${requirement.source ?? ''}`);
    } else if (entries.length === 1 && entries[0].path !== requirement.source) {
      errors.push(`${requirement.id}的source应为${entries[0].path}`);
    }
    if (entries.length === 1 && entries[0].definitionDigest !== requirement.definitionDigest) {
      errors.push(`${requirement.id}正文已经变化，需要复核产生原因和验证关系并更新definitionDigest`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(requirement.definitionDigest ?? '')) errors.push(`${requirement.id}.definitionDigest格式错误`);
    if (requirement.origin !== 'pre-req-process'
      && !/^REQ-\d{6}$/.test(requirement.origin ?? '')) {
      errors.push(`${requirement.id}.origin无效`);
    } else if (requirement.origin !== 'pre-req-process'
      && !requirementRegistry.includes(`\`${requirement.origin}\``)) {
      errors.push(`${requirement.id}引用未登记REQ：${requirement.origin}`);
    }

    const requirementTopics = Array.isArray(requirement.topics) ? requirement.topics : [];
    if (requirementTopics.length === 0) errors.push(`${requirement.id}至少需要一个主题`);
    pushDuplicateErrors(requirementTopics, `${requirement.id}.topics`, errors);
    for (const topic of requirementTopics) {
      usedTopics.add(topic);
      if (!topicIds.includes(topic)) errors.push(`${requirement.id}引用未知主题：${topic}`);
    }

    const verifications = Array.isArray(requirement.directVerification) ? requirement.directVerification : [];
    for (const [verificationIndex, verification] of verifications.entries()) {
      const verificationLabel = `${requirement.id}.directVerification[${verificationIndex}]`;
      pushUnknownPropertyErrors(verification, new Set(['method', 'references', 'note']), verificationLabel, errors);
      if (!['test', 'inspection', 'analysis', 'demonstration'].includes(verification.method)) {
        errors.push(`${verificationLabel}.method无效`);
      }
      const references = Array.isArray(verification.references) ? verification.references : [];
      if (references.length === 0) errors.push(`${verificationLabel}至少需要一个引用`);
      pushDuplicateErrors(references, `${verificationLabel}.references`, errors);
      for (const reference of references) {
        const absoluteReference = resolve(root, reference);
        if (!existsSync(absoluteReference)) {
          errors.push(`${verificationLabel}引用不存在：${reference}`);
          continue;
        }
        if (/\b(?:stage0|p0)\b/i.test(reference)) errors.push(`${requirement.id}不能引用历史测试：${reference}`);
        if (verification.method !== 'test') continue;
        const testContent = readFileSync(absoluteReference, 'utf8');
        if (!hasTestTraceMarker(testContent, { coverage: 'direct', requirementId: requirement.id })) {
          errors.push(`${reference}缺少TRACE-REQ: ${requirement.id}`);
        }
      }
    }

    const issues = Array.isArray(requirement.issues) ? requirement.issues : [];
    pushDuplicateErrors(issues, `${requirement.id}.issues`, errors);
    for (const issue of issues) if (!issueRegistry.includes(`|${issue}|`)) errors.push(`${requirement.id}引用未登记Issue：${issue}`);
  }
  for (const id of definitions.keys()) if (!ledgerSet.has(id)) errors.push(`当前稳定设计要求没有进入账本：${id}`);
  for (const id of ledgerSet) if (!definitions.has(id)) errors.push(`账本引用未定义稳定设计要求：${id}`);
  for (const topic of topicIds) if (!usedTopics.has(topic)) errors.push(`主题没有稳定设计要求：${topic}`);
  return errors;
}

function relativePathLink(path, label = path.split('/').at(-1)) {
  const target = relative(dirname(trackingDocumentPath), resolve(repositoryRoot, path)).replaceAll('\\', '/');
  const href = /[ ()]/.test(target) ? `<${target}>` : target;
  return `[${label}](${href})`;
}

function formatRequirements(requirements) {
  const prefixes = ['PRD', 'DOM', 'ARCH', 'SEC'];
  return prefixes.map((prefix) => requirements.filter((id) => id.startsWith(`${prefix}-`)).map((id) => `\`${id}\``).join('、'))
    .filter(Boolean).join('；');
}

export function renderGeneratedTraceability(manifest) {
  const lines = [generatedStart, '', '## 2.按问题找到稳定设计要求', '', '|要查的问题|稳定设计要求|当前验证关系|', '|---|---|---|'];
  for (const topic of manifest.topics) {
    const requirements = manifest.requirements.filter((requirement) => requirement.topics.includes(topic.id));
    const direct = requirements.filter((requirement) => requirement.directVerification.length > 0).length;
    const supporting = requirements.length - direct;
    const coverage = [direct > 0 ? `${direct}项直接验证` : '', supporting > 0 ? `${supporting}项支持性验证` : ''].filter(Boolean).join('、');
    lines.push(`|${topic.title}|${formatRequirements(requirements.map(({ id }) => id))}|${coverage}|`);
  }
  lines.push('', '## 3.逐项查找来源和验证', '', '|稳定设计要求|定义来源|产生原因|验证关系|验证入口|当前Issue|', '|---|---|---|---|---|---|');
  const methodLabels = { test: '测试', inspection: '检查', analysis: '分析', demonstration: '实机或记录' };
  const coverageLabels = { direct: '直接', supporting: '支持性' };
  for (const requirement of manifest.requirements) {
    const supportingVerification = requirement.topics.flatMap((topicId) => manifest.topics
      .find(({ id }) => id === topicId).supportingVerification);
    const relations = [...new Set([
      ...requirement.directVerification.map(({ method }) => `${methodLabels[method]}·${coverageLabels.direct}`),
      ...supportingVerification.map(({ method }) => `${methodLabels[method]}·${coverageLabels.supporting}`),
    ])].join('、');
    const references = [...new Set([
      ...requirement.directVerification.flatMap(({ references: refs }) => refs),
      ...supportingVerification.flatMap(({ references: refs }) => refs),
    ])]
      .map((path) => relativePathLink(path)).join('、');
    const origin = requirement.origin === 'pre-req-process' ? '现行REQ流程前基线' : `\`${requirement.origin}\``;
    const issues = (requirement.issues ?? []).map((issue) => relativePathLink('docs/03-实施/ISSUE/README.md', issue)).join('、') || '—';
    lines.push(`|\`${requirement.id}\`|${relativePathLink(requirement.source, '定义正文')}|${origin}|${relations}|${references}|${issues}|`);
  }
  lines.push('', generatedEnd);
  return lines.join('\n');
}

export function replaceGeneratedSection(document, generated) {
  const start = document.indexOf(generatedStart);
  const end = document.indexOf(generatedEnd);
  if (start === -1 || end === -1 || end < start) throw new Error('追踪文档缺少有效生成区标记');
  return `${document.slice(0, start)}${generated}${document.slice(end + generatedEnd.length)}`;
}

export function buildTraceabilityDocument() {
  if (!existsSync(schemaPath)) throw new Error('缺少追踪JSON Schema');
  const manifest = readJson(manifestPath);
  const errors = validateTraceability(manifest);
  if (errors.length > 0) throw new Error(`设计要求追踪检查失败：\n- ${errors.join('\n- ')}`);
  const document = readFileSync(trackingDocumentPath, 'utf8');
  const expected = replaceGeneratedSection(document, renderGeneratedTraceability(manifest));
  const directCount = manifest.requirements.filter((requirement) => requirement.directVerification.length > 0).length;
  return {
    changed: expected !== document,
    directCount,
    document,
    expected,
    requirementCount: manifest.requirements.length,
    topicCount: manifest.topics.length,
  };
}

export function checkTraceability() {
  const result = buildTraceabilityDocument();
  if (result.changed) {
    throw new Error('设计要求追踪Markdown与账本不一致，请运行pnpm trace:render');
  }
  return {
    directCount: result.directCount,
    requirementCount: result.requirementCount,
    topicCount: result.topicCount,
  };
}
