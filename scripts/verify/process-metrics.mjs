import { existsSync, readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const implementationRegistryPaths = [
  ['ACL', resolve(repositoryRoot, 'docs/03-实施/ACL/README.md')],
  ['DFL', resolve(repositoryRoot, 'docs/03-实施/DFL/README.md')],
  ['ERL', resolve(repositoryRoot, 'docs/03-实施/ERL/README.md')],
];
const terminalStatuses = new Set(['Accepted', 'Completed']);
const validationResultPattern = /^(通过|失败后定点回归通过|失败|未通过|不适用)(?:$|[，,；;（(：:\s])/u;
const loopIdPattern = /^(?:ACL-\d{6}|DFL-\d{6}|ERL-\d{6})$/u;
const datePattern = /(\d{4}-\d{2}-\d{2})/u;

function splitMarkdownRow(line) {
  if (!line.startsWith('|') || !line.endsWith('|')) return null;
  return line.slice(1, -1).split('|').map((cell) => cell.trim());
}

function extractLinks(cell) {
  return [...cell.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)].map((match) => match[1]);
}

function parseDate(value) {
  const match = String(value ?? '').match(datePattern);
  if (match === null) return null;
  const [year, month, day] = match[1].split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (month < 1 || month > 12 || day < 1 || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { iso: match[1], timestamp };
}

function metadataValue(content, label) {
  return content.match(new RegExp(`^> ${label}：([^\\n]+)$`, 'mu'))?.[1]?.trim() ?? null;
}

function selectRecordLinks(cells, type, baseDirectory = '') {
  const recordColumn = type === 'ACL' ? 7 : 6;
  const links = extractLinks(cells[recordColumn] ?? '');
  return links
    .filter((link) => /(?:ACL-\d{6}-.+|实施记录|实现记录|验证记录|发布记录|环境记录|评审记录)\.md$|README\.md$/u.test(link))
    .map((link) => baseDirectory === '' ? link : posix.normalize(posix.join(baseDirectory, link)));
}

export function parseLoopRegistry(content, baseDirectory = '') {
  const entries = [];
  for (const line of content.split('\n')) {
    const cells = splitMarkdownRow(line);
    if (cells === null) continue;
    const id = cells[0].replaceAll('`', '');
    if (!loopIdPattern.test(id) || cells.length < 3) continue;
    const type = id.startsWith('ACL-') ? 'ACL' : id.startsWith('DFL-') ? 'DFL' : 'ERL';
    entries.push({
      id,
      type,
      status: type === 'ACL' ? cells[3] : cells[2],
      registryStart: parseDate(type === 'ACL' ? cells[2] : cells[1]),
      recordLinks: selectRecordLinks(cells, type, baseDirectory),
    });
  }
  return entries;
}

export function currentReportDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.ACDL_TIMEZONE || 'UTC' }).format(now);
}

function parseDateOption(value, name) {
  if (value === null || value === undefined) return null;
  const parsed = parseDate(value);
  if (parsed === null || parsed.iso !== value) throw new Error(`${name}必须使用YYYY-MM-DD`);
  return parsed;
}

function dayDifference(start, end) {
  return Math.round((end.timestamp - start.timestamp) / 86_400_000);
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const index = Math.max(0, Math.ceil(values.length * ratio) - 1);
  return values[index];
}

function durationStatistics(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    minimum: sorted[0] ?? null,
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    maximum: sorted.at(-1) ?? null,
  };
}

function inRange(date, since, until) {
  if (date === null) return false;
  return (since === null || date.timestamp >= since.timestamp)
    && (until === null || date.timestamp <= until.timestamp);
}

function executionStart(entry, contents) {
  const usesActualStart = contents.some((content) => metadataValue(content, '实际开始时间') !== null);
  const starts = (usesActualStart
    ? contents.map((content) => parseDate(metadataValue(content, '实际开始时间')))
    : [entry.registryStart, ...contents.map((content) => parseDate(metadataValue(content, '启动时间')))])
    .filter((date) => date !== null)
    .sort((left, right) => left.timestamp - right.timestamp);
  return {
    start: starts[0] ?? null,
    missingReason: usesActualStart ? '缺少实际开始时间' : '缺少启动时间',
  };
}

export function calculateProcessMetrics({
  registryContent,
  registryContents,
  records = new Map(),
  reportDate = currentReportDate(),
  since = null,
  until = null,
  reviewAgeDays = 7,
}) {
  const parsedSince = parseDateOption(since, '--since');
  const parsedUntil = parseDateOption(until, '--until');
  const parsedReportDate = parseDateOption(reportDate, '统计日期');
  if (parsedSince !== null && parsedUntil !== null && parsedSince.timestamp > parsedUntil.timestamp) {
    throw new Error('--since不能晚于--until');
  }
  if (!Number.isInteger(reviewAgeDays) || reviewAgeDays < 0) {
    throw new Error('--review-age-days必须是非负整数');
  }

  const entries = (registryContents ?? [{ content: registryContent, baseDirectory: '' }])
    .flatMap(({ content, baseDirectory = '' }) => parseLoopRegistry(content, baseDirectory))
    .filter((entry) => inRange(entry.registryStart, parsedSince, parsedUntil));
  const statusCounts = Object.fromEntries(
    [...new Set(entries.map((entry) => entry.status))].sort().map((status) => [status, 0]),
  );
  const typeCounts = Object.fromEntries(
    [...new Set(entries.map((entry) => entry.type))].sort().map((type) => [type, 0]),
  );
  const durations = [];
  const durationExcluded = [];
  const reviewEntries = [];
  const validation = {
    firstPass: 0,
    failedThenRegression: 0,
    failed: 0,
    notApplicable: 0,
    notRecorded: 0,
    invalid: 0,
  };

  for (const entry of entries) {
    statusCounts[entry.status] += 1;
    typeCounts[entry.type] += 1;
    const contents = entry.recordLinks
      .map((link) => records.get(link) ?? null)
      .filter((content) => content !== null);
    const { start, missingReason } = executionStart(entry, contents);
    const ends = contents.map((content) => parseDate(metadataValue(content, '结束时间')))
      .filter((date) => date !== null)
      .sort((left, right) => left.timestamp - right.timestamp);
    const end = ends.at(-1) ?? null;

    if (entry.status === 'Review' && start !== null) {
      reviewEntries.push({
        id: entry.id,
        type: entry.type,
        ageDays: dayDifference(start, parsedReportDate),
        overThreshold: dayDifference(start, parsedReportDate) > reviewAgeDays,
      });
    }

    if (terminalStatuses.has(entry.status)) {
      if (start === null || end === null) {
        durationExcluded.push({ id: entry.id, reason: start === null ? missingReason : '缺少结束时间' });
      } else if (end.timestamp < start.timestamp) {
        durationExcluded.push({ id: entry.id, reason: '结束时间早于实际开始时间' });
      } else {
        durations.push(dayDifference(start, end));
      }
    }

    if (entry.type !== 'ACL') continue;
    const result = contents.map((content) => metadataValue(content, '首次统一验证'))
      .find((value) => value !== null) ?? null;
    const normalizedResult = result?.match(validationResultPattern)?.[1] ?? null;
    if (result === null || result === '待填写') {
      validation.notRecorded += 1;
    } else if (normalizedResult === null) {
      validation.invalid += 1;
    } else if (normalizedResult === '通过') {
      validation.firstPass += 1;
    } else if (normalizedResult === '失败后定点回归通过') {
      validation.failedThenRegression += 1;
    } else if (normalizedResult === '未通过' || normalizedResult === '失败') {
      validation.failed += 1;
    } else {
      validation.notApplicable += 1;
    }
  }

  const validationRecorded = validation.firstPass
    + validation.failedThenRegression
    + validation.failed;
  return {
    range: {
      since: parsedSince?.iso ?? '全部',
      until: parsedUntil?.iso ?? '全部',
      reportDate: parsedReportDate.iso,
    },
    loopCount: entries.length,
    statusCounts,
    typeCounts,
    review: {
      ageThresholdDays: reviewAgeDays,
      total: reviewEntries.length,
      overThreshold: reviewEntries.filter((entry) => entry.overThreshold).length,
      entries: reviewEntries,
    },
    cycle: {
      ...durationStatistics(durations),
      excluded: durationExcluded,
    },
    validation: {
      ...validation,
      recorded: validationRecorded,
      firstPassRate: validationRecorded === 0 ? null : validation.firstPass / validationRecorded,
    },
  };
}

function formatCountMap(values) {
  const entries = Object.entries(values);
  return entries.length === 0 ? '无' : entries.map(([key, value]) => `${key} ${value}项`).join('，');
}

function formatRate(value) {
  return value === null ? '不可计算' : `${(value * 100).toFixed(1)}%`;
}

export function formatProcessMetrics(metrics) {
  const lines = [
    '研发流程效能统计',
    `统计范围（按Loop登记日期）：${metrics.range.since}至${metrics.range.until}；统计日期：${metrics.range.reportDate}`,
    '',
    '一、Loop状态积压',
    `纳入Loop：${metrics.loopCount}项`,
    `状态分布：${formatCountMap(metrics.statusCounts)}`,
    `类型分布：${formatCountMap(metrics.typeCounts)}`,
    `Review：${metrics.review.total}项，其中实际开始超过${metrics.review.ageThresholdDays}天：${metrics.review.overThreshold}项`,
    '',
    '二、已完成Loop周期',
    `可计算：${metrics.cycle.count}项；中位数：${metrics.cycle.median === null ? '不可计算' : `${metrics.cycle.median}天`}；P75：${metrics.cycle.p75 === null ? '不可计算' : `${metrics.cycle.p75}天`}`,
    `范围：${metrics.cycle.minimum === null ? '不可计算' : `${metrics.cycle.minimum}至${metrics.cycle.maximum}天`}`,
    `因缺少完整时间字段未纳入：${metrics.cycle.excluded.length}项`,
    '',
    '三、ACL首次统一验证',
    `首次通过：${metrics.validation.firstPass}项；失败后定点回归通过：${metrics.validation.failedThenRegression}项；未通过：${metrics.validation.failed}项`,
    `不适用：${metrics.validation.notApplicable}项；未记录：${metrics.validation.notRecorded}项；字段值无效：${metrics.validation.invalid}项`,
    `首次验证通过率：${formatRate(metrics.validation.firstPassRate)}`,
  ];
  if (metrics.cycle.excluded.length > 0) {
    lines.push('', '数据缺口：');
    for (const item of metrics.cycle.excluded) lines.push(`- ${item.id}：${item.reason}`);
  }
  return `${lines.join('\n')}\n`;
}

export function parseOptions(argumentsList) {
  const options = { format: 'text', reviewAgeDays: 7, since: undefined, until: undefined };
  for (const argument of argumentsList) {
    if (!argument.startsWith('--')) throw new Error(`未知参数：${argument}`);
    const separator = argument.indexOf('=');
    if (separator < 0) throw new Error(`参数需要使用--name=value：${argument}`);
    const name = argument.slice(2, separator);
    const value = argument.slice(separator + 1);
    if (name === 'since' || name === 'until') options[name] = value;
    else if (name === 'review-age-days') options.reviewAgeDays = Number(value);
    else if (name === 'format' && (value === 'text' || value === 'json')) options.format = value;
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

function main() {
  const options = parseOptions(process.argv.slice(2).filter((argument) => argument !== '--'));
  const registryContents = implementationRegistryPaths.map(([baseDirectory, path]) => ({
    baseDirectory,
    content: readFileSync(path, 'utf8'),
  }));
  const entries = registryContents.flatMap(({ baseDirectory, content }) => parseLoopRegistry(content, baseDirectory));
  const records = new Map();
  for (const entry of entries) {
    for (const link of entry.recordLinks) {
      if (records.has(link)) continue;
      const path = resolve(resolve(repositoryRoot, 'docs/03-实施'), link);
      if (existsSync(path)) records.set(link, readFileSync(path, 'utf8'));
    }
  }
  const metrics = calculateProcessMetrics({
    registryContents,
    records,
    since: options.since,
    until: options.until,
    reviewAgeDays: options.reviewAgeDays,
  });
  console.log(options.format === 'json' ? JSON.stringify(metrics, null, 2) : formatProcessMetrics(metrics));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
