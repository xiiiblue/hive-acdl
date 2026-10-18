import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function projectFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (['.git', '.tmp', 'node_modules'].includes(entry.name)) return [];
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`拒绝符号链接：${relative(root, path)}`);
    return entry.isDirectory() ? projectFiles(path) : [path];
  });
}
export function scanText(text) {
  const rules = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
    ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ['assigned-secret', /(?:password|token|secret|api[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_\/+.-]{16,}["']/i],
    ['credential-url', /https?:\/\/[^\s/@:]+:[^\s/@]+@/],
    ['private-network', /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/],
    ['personal-path', /\/Users\/[A-Za-z0-9_.-]+\//],
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}
function withoutCode(text) { return text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '').replace(/`[^`\n]+`/g, ''); }
function anchors(text) {
  const found = new Set(); const counts = new Map();
  for (const match of withoutCode(text).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = match[1].replace(/<[^>]+>/g, '').toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(base) || 0; counts.set(base, count + 1); found.add(base + (count ? `-${count}` : ''));
  }
  for (const match of text.matchAll(/\{#([^}]+)\}/g)) found.add(match[1]);
  return found;
}
export function checkProject(root = defaultRoot, { secretsOnly = false } = {}) {
  root = realpathSync(root); const errors = []; const files = projectFiles(root);
  for (const path of files) {
    const local = relative(root, path);
    if (/(^|\/)\.env(?:\.|$)|\.(?:pem|key)$/.test(local)) errors.push(`${local}: sensitive filename`);
    const text = readFileSync(path, 'utf8');
    for (const label of scanText(text)) errors.push(`${local}: ${label}`);
    if (secretsOnly || !path.endsWith('.md')) continue;
    for (const match of withoutCode(text).matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const url = match[1].replace(/^<|>$/g, '');
      if (/^(?:https?:|mailto:)/.test(url)) continue;
      let target, fragment;
      try { [target, fragment] = url.split('#').map(decodeURIComponent); } catch { errors.push(`${local}: bad URL encoding`); continue; }
      const absolute = target ? resolve(dirname(path), target) : path;
      if (relative(root, absolute).startsWith('..') || !files.includes(absolute)) { errors.push(`${local}: missing/outside link ${url}`); continue; }
      if (fragment && absolute.endsWith('.md') && !anchors(readFileSync(absolute, 'utf8')).has(fragment)) errors.push(`${local}: missing anchor ${url}`);
    }
  }
  return errors;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = checkProject(defaultRoot, { secretsOnly: process.argv.includes('--secrets-only') });
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('本地链接/锚点与敏感模式检查通过（未联网探测）');
}
