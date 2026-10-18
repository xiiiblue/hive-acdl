import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  collectCurrentDefinitions,
  renderGeneratedTraceability,
  replaceGeneratedSection,
  validateTraceability,
} from '../lib/traceability.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function prepareRefreshedManifest(manifest, { root = repositoryRoot } = {}) {
  const definitions = collectCurrentDefinitions(root);
  const ledgerIds = manifest.requirements.map(({ id }) => id);
  const ledgerSet = new Set(ledgerIds);
  const errors = [];

  if (ledgerSet.size !== ledgerIds.length) errors.push('追踪账本包含重复稳定设计要求ID');
  for (const [id, entries] of definitions) {
    if (entries.length !== 1) errors.push(`${id}在当前设计中定义${entries.length}次`);
    if (!ledgerSet.has(id)) errors.push(`当前稳定设计要求没有进入账本：${id}`);
  }
  for (const id of ledgerSet) {
    const entries = definitions.get(id) ?? [];
    if (entries.length === 0) errors.push(`账本引用未定义稳定设计要求：${id}`);
  }
  if (errors.length > 0) throw new Error(`不能刷新设计要求摘要：\n- ${errors.join('\n- ')}`);

  const changedIds = [];
  const requirements = manifest.requirements.map((requirement) => {
    const definition = definitions.get(requirement.id)[0];
    if (definition.path !== requirement.source || definition.definitionDigest !== requirement.definitionDigest) {
      changedIds.push(requirement.id);
    }
    return {
      ...requirement,
      source: definition.path,
      definitionDigest: definition.definitionDigest,
    };
  });

  return {
    changedIds,
    manifest: { ...manifest, requirements },
    requirementCount: requirements.length,
  };
}

export function normalizeTrackingDocument(document) {
  return document;
}

export function refreshTraceability({ root = repositoryRoot } = {}) {
  const manifestPath = resolve(root, 'tests/traceability/design-requirements.json');
  const trackingDocumentPath = resolve(root, 'docs/02-设计/00-索引与追踪/IDX-002-设计要求与验证追踪.md');
  if (!existsSync(manifestPath) || !existsSync(trackingDocumentPath)) {
    throw new Error('缺少设计要求追踪账本或Markdown入口');
  }

  const current = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const refreshed = prepareRefreshedManifest(current, { root });
  const errors = validateTraceability(refreshed.manifest, { root });
  if (errors.length > 0) {
    throw new Error(`摘要刷新后的追踪关系仍不合法：\n- ${errors.join('\n- ')}`);
  }

  const manifestContent = `${JSON.stringify(refreshed.manifest, null, 2)}\n`;
  const document = readFileSync(trackingDocumentPath, 'utf8');
  const normalizedDocument = normalizeTrackingDocument(document);
  const generated = renderGeneratedTraceability(refreshed.manifest);
  const expectedDocument = replaceGeneratedSection(normalizedDocument, generated);

  writeFileSync(manifestPath, manifestContent);
  if (expectedDocument !== document) writeFileSync(trackingDocumentPath, expectedDocument);

  return {
    changedIds: refreshed.changedIds,
    documentChanged: expectedDocument !== document,
    requirementCount: refreshed.requirementCount,
  };
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

export function hasReviewedConfirmation(args) {
  const normalized = args.filter((argument) => argument !== '--');
  return normalized.length === 1 && normalized[0] === '--reviewed';
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  if (!hasReviewedConfirmation(args)) {
    throw new Error('用法：npm run trace:refresh -- --reviewed；仅在已经人工复核设计正文及其验证关系后使用');
  }
  const result = refreshTraceability();
  console.log(`设计要求摘要刷新完成：${result.requirementCount}项稳定要求，更新${result.changedIds.length}项摘要${result.documentChanged ? '，并重建追踪视图' : ''}。`);
}
