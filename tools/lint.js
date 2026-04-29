const fs = require('fs');
const path = require('path');
const root = path.normalize('G:/1999story/wiki');

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
