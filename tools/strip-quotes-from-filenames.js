// 一次性批量改名：剥掉 raw/立绘/ 下所有图片文件名中的中文/ASCII引号字符
// 用法：
//   node tools/strip-quotes-from-filenames.js          # 只列出将要改名的
//   node tools/strip-quotes-from-filenames.js --apply  # 真正执行改名
const fs = require('fs');
const path = require('path');

const LIPING = 'g:\\1999story\\raw\\立绘';
const QUOTE_RE = /["'“”‘’„‟「」『』]/g;

const renames = [];
const collisions = [];

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(png|jpg|jpeg|webp)$/i.test(f)) continue;
    const stripped = f.replace(QUOTE_RE, '');
    if (stripped === f) continue;
    const dest = path.join(dir, stripped);
    if (fs.existsSync(dest)) {
      collisions.push({ from: p, to: dest });
    } else {
      renames.push({ from: p, to: dest });
    }
  }
}

walk(LIPING);

console.log(`待改名: ${renames.length}  冲突: ${collisions.length}\n`);
for (const r of renames.slice(0, 20)) {
  console.log(`  ${path.basename(r.from)}  →  ${path.basename(r.to)}`);
}
if (renames.length > 20) console.log(`  ... +${renames.length - 20} 项`);

if (collisions.length > 0) {
  console.log(`\n⚠️ 冲突（目标已存在，跳过）：`);
  for (const c of collisions) console.log(`  ${c.from} → ${c.to}`);
}

if (process.argv.includes('--apply')) {
  let ok = 0, err = 0;
  for (const r of renames) {
    try { fs.renameSync(r.from, r.to); ok++; }
    catch (e) { console.error(`❌ ${r.from}: ${e.message}`); err++; }
  }
  console.log(`\n✅ 改名 ${ok} / 失败 ${err}`);
}
