import { writeFileSync } from 'node:fs';

import { buildTraceabilityDocument, trackingDocumentPath } from '../lib/traceability.mjs';

if (process.argv.length > 2) throw new Error(`未知参数：${process.argv.slice(2).join('、')}`);

const result = buildTraceabilityDocument();
if (result.changed) writeFileSync(trackingDocumentPath, result.expected);
console.log(`设计要求追踪生成完成：${result.requirementCount}项稳定要求，${result.topicCount}个主题，${result.directCount}项直接验证。`);
