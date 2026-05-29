const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const root = path.normalize('G:/1999story/wiki');
const repoRoot = path.normalize('G:/1999story');

function walkSync(dir) {
  let files = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) files = files.concat(walkSync(full));
    else if (f.endsWith('.md')) files.push(full);
  }
  return files;
}

const allFiles = walkSync(root);

// Normalize to forward-slash relative paths without .md
function normalize(f) {
  return f.replace(root, '').replace(/\\/g, '/').replace(/^\//, '').replace(/\.md$/, '');
}

const existing = new Set(allFiles.map(normalize));
const broken = {};
const inbound = {};

for (const f of allFiles) {
  const src = normalize(f);
  const content = fs.readFileSync(f, 'utf8');
  const linkRe = /\[\[([^\]|#\n]+)/g;
  let m;
  while ((m = linkRe.exec(content)) !== null) {
    const link = m[1].trim();
    if (!existing.has(link)) {
      if (!broken[link]) broken[link] = [];
      broken[link].push(src);
    } else {
      if (!inbound[link]) inbound[link] = new Set();
      inbound[link].add(src);
    }
  }
}

console.log('=== Pages: ' + allFiles.length + ' ===\n');

const brokenKeys = Object.keys(broken).sort();
console.log('=== Broken links: ' + brokenKeys.length + ' ===');
for (const t of brokenKeys) {
  const ss = broken[t];
  console.log('  [[' + t + ']]  <-  ' + ss[0] + (ss.length > 1 ? '  (+' + (ss.length - 1) + ' more)' : ''));
}

console.log('\n=== Orphaned pages (no inbound wikilinks) ===');
let orphans = 0;
for (const p of [...existing].sort()) {
  if (p === 'index') continue;
  if (!inbound[p]) {
    console.log('  ' + p);
    orphans++;
  }
}
console.log('Total orphans: ' + orphans);

// Frontmatter check
console.log('\n=== Frontmatter issues ===');
let fmIssues = 0;
for (const f of allFiles) {
  const src = normalize(f);
  if (src === 'index') continue;
  const content = fs.readFileSync(f, 'utf8');
  if (!content.startsWith('---')) {
    console.log('  Missing frontmatter: ' + src);
    fmIssues++;
  } else {
    const hasType = content.includes('type:');
    const hasTitle = content.includes('title:');
    const hasUpdated = content.includes('updated:');
    if (!hasTitle || !hasUpdated) {
      console.log('  Incomplete frontmatter (missing ' + (!hasTitle ? 'title ' : '') + (!hasUpdated ? 'updated' : '') + '): ' + src);
      fmIssues++;
    }
  }
}
console.log('Total frontmatter issues: ' + fmIssues);

// 找出文件「最后一次实质内容改动」的提交日期。
// 关键：跳过那些只改了 frontmatter `updated:` 行的提交，否则基线/补日期提交会自我污染。
function lastContentCommitDate(file) {
  let hashes;
  try {
    hashes = execSync('git log --format=%H -- "' + file + '"', { cwd: repoRoot, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
  } catch (e) { return null; }
  for (const h of hashes) {
    let out;
    try {
      // %cs 日期会作为首行输出，其后是 diff
      out = execSync('git show --format=%cs --unified=0 ' + h + ' -- "' + file + '"', { cwd: repoRoot, encoding: 'utf8' });
    } catch (e) { continue; }
    const allLines = out.split('\n');
    const date = (allLines[0] || '').trim();
    // 取 diff 中的增删行（排除 +++/--- 文件头）
    const changed = allLines.filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
    const nonUpdatedOnly = changed.filter(l => !/^[+-]\s*updated:/.test(l));
    if (nonUpdatedOnly.length > 0) return date; // 这次提交动了真内容
    // 否则是「仅改 updated」的提交，继续往前回溯
  }
  return null; // 仅有 updated-only 提交，或从未提交
}

const FIX = process.argv.includes('--fix');
console.log('\n=== Stale updated field (最后内容改动晚于 frontmatter updated) ===');
let staleCount = 0, fixedCount = 0;
const updatedRe = /^updated:\s*"?(\d{4}-\d{2}-\d{2})[^\r\n]*/m;
for (const f of allFiles) {
  const src = normalize(f);
  if (src === 'index') continue;
  const content = fs.readFileSync(f, 'utf8');
  const fmMatch = content.match(updatedRe);
  if (!fmMatch) continue; // 缺 updated 字段已在上方报告
  const fmDate = fmMatch[1];
  const gitDate = lastContentCommitDate(f);
  if (!gitDate) continue; // 新文件 / 仅 updated-only 提交
  if (gitDate > fmDate) { // ISO 日期可按字符串比较
    if (FIX) {
      const fixed = content.replace(updatedRe, 'updated: "' + gitDate + '"');
      fs.writeFileSync(f, fixed);
      console.log('  [fixed] ' + src + '  ' + fmDate + ' -> ' + gitDate);
      fixedCount++;
    } else {
      console.log('  ' + src + '  (内容改动 ' + gitDate + ' > updated ' + fmDate + ')');
      staleCount++;
    }
  }
}
console.log(FIX ? ('Total fixed: ' + fixedCount) : ('Total stale: ' + staleCount));
