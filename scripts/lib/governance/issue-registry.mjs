export function splitMarkdownRow(line) {
  if (!line.startsWith('|') || !line.endsWith('|')) return null;
  return line.slice(1, -1).split('|').map((cell) => cell.trim());
}

export function extractIssueRows(content) {
  const lines = content.split('\n');
  const issues = [];
  let categoryColumn = -1;
  let externalColumn = -1;
  let processingColumn = -1;
  let severityColumn = -1;
  let sourceColumn = -1;
  let sourceNumberColumn = -1;
  let statusColumn = -1;
  let summaryColumn = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const cells = splitMarkdownRow(lines[index]);
    if (cells?.[0] === '问题编号' && cells.includes('处理ACL')) {
      categoryColumn = cells.indexOf('分类');
      externalColumn = cells.indexOf('外部Issue');
      processingColumn = cells.indexOf('处理ACL');
      severityColumn = cells.indexOf('严重级别');
      sourceColumn = cells.indexOf('来源');
      sourceNumberColumn = cells.indexOf('来源编号');
      statusColumn = cells.indexOf('状态');
      summaryColumn = cells.indexOf('问题摘要');
      continue;
    }
    if (processingColumn < 0) continue;
    if (cells === null) {
      categoryColumn = -1;
      externalColumn = -1;
      processingColumn = -1;
      severityColumn = -1;
      sourceColumn = -1;
      sourceNumberColumn = -1;
      statusColumn = -1;
      summaryColumn = -1;
      continue;
    }
    if (cells.every((cell) => /^:?-+:?$/u.test(cell))) continue;
    if (!/^ISSUE-\d{6}$/u.test(cells[0] ?? '')) {
      processingColumn = -1;
      statusColumn = -1;
      continue;
    }
    if (cells.length <= processingColumn) throw new Error(`${cells[0]}的问题行缺少处理ACL列`);
    if (statusColumn < 0 || cells.length <= statusColumn) throw new Error(`${cells[0]}的问题行缺少状态列`);
    issues.push({
      category: categoryColumn >= 0 ? cells[categoryColumn] : null,
      cells,
      external: externalColumn >= 0 ? cells[externalColumn] : null,
      externalColumn,
      id: cells[0], index, processing: cells[processingColumn], processingColumn,
      severity: severityColumn >= 0 ? cells[severityColumn] : null,
      source: sourceColumn >= 0 ? cells[sourceColumn] : null,
      sourceNumber: sourceNumberColumn >= 0 ? cells[sourceNumberColumn] : null,
      status: cells[statusColumn], statusColumn,
      summary: summaryColumn >= 0 ? cells[summaryColumn] : null,
    });
  }
  return issues;
}

export function replaceIssueCell(content, { column, issueId, value }) {
  const lines = content.split('\n');
  const header = lines.map(splitMarkdownRow).find((cells) => cells?.[0] === '问题编号');
  const columnIndex = header?.indexOf(column) ?? -1;
  if (columnIndex < 0) throw new Error(`ISSUE台账缺少${column}列`);
  const matches = extractIssueRows(content).filter((issue) => issue.id === issueId);
  if (matches.length !== 1) throw new Error(`${issueId}必须在ISSUE台账中恰好定义一次`);
  const issue = matches[0];
  const cells = splitMarkdownRow(lines[issue.index]);
  cells[columnIndex] = value;
  lines[issue.index] = `|${cells.join('|')}|`;
  return lines.join('\n');
}

export function addIssueAclLink(content, { aclId, issueId, recordName }) {
  const matches = extractIssueRows(content).filter((issue) => issue.id === issueId);
  if (matches.length !== 1) throw new Error(`${issueId}必须在ISSUE台账中恰好定义一次`);
  const issue = matches[0];
  const existingAclIds = issue.processing.match(/ACL-\d{6}/gu) ?? [];
  if (existingAclIds.includes(aclId)) throw new Error(`${issueId}已经关联${aclId}`);
  const link = `[\`${aclId}\`](../ACL/${recordName})`;
  const lines = content.split('\n');
  const cells = splitMarkdownRow(lines[issue.index]);
  cells[issue.processingColumn] = issue.processing === '—' ? link : `${issue.processing}、${link}`;
  lines[issue.index] = `|${cells.join('|')}|`;
  return lines.join('\n');
}
