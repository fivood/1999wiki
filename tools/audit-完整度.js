// 完整度审计——按命名规范检查每个已存卡池角色
//
// 规范（详见 raw/立绘/命名规范.md）：
//   - 初始：单文件 {角色}_初始.png
//   - 洞悉：双文件 {角色}_洞悉_立绘.png + {角色}_洞悉_L2D.png
//   - 尤提姆：单文件 {角色}_尤提姆.png（可选，部分角色无）
//   - 初始单品：3 张 初始_{单品}.png
//   - 衣着：每套 = 2 立绘（_立绘 + _L2D） + 3 件 {衣着名}_{单品}.png
//
// 用法：
//   node tools/audit-完整度.js
//   node tools/audit-完整度.js --write   # 同时输出 raw/立绘/完整度报告.md
const fs = require('fs');
const path = require('path');

const LIPING = 'g:\\1999story\\raw\\立绘';
const POOL_LIST = path.join(LIPING, '卡池角色列表.md');
const REPORT = path.join(LIPING, '完整度报告.md');

const poolNames = new Set(
  fs.readFileSync(POOL_LIST, 'utf8').split('\n')
    .map(s => s.trim()).filter(Boolean).map(s => s.replace(/^《|》$/g, ''))
);

const results = [];

for (const org of fs.readdirSync(LIPING)) {
  const orgPath = path.join(LIPING, org);
  if (!fs.statSync(orgPath).isDirectory()) continue;
  for (const c of fs.readdirSync(orgPath)) {
    const charPath = path.join(orgPath, c);
    if (!fs.statSync(charPath).isDirectory() || !poolNames.has(c)) continue;
    const files = fs.readdirSync(charPath).filter(f => /\.png$/i.test(f));
    if (files.length === 0) continue;          // 0 张图的不在本审计范围
    const fset = new Set(files);

    const issues = [];

    // 1) 初始（必有，单文件）
    if (!fset.has(`${c}_初始.png`)) issues.push(`缺 ${c}_初始.png`);

    // 2) 洞悉（必有，双文件）
    const hasDongLi = fset.has(`${c}_洞悉_立绘.png`);
    const hasDongL2D = fset.has(`${c}_洞悉_L2D.png`);
    const hasDongBare = fset.has(`${c}_洞悉.png`);
    if (!hasDongLi && !hasDongBare) issues.push(`缺 ${c}_洞悉_立绘.png`);
    else if (hasDongBare && !hasDongLi) issues.push(`洞悉立绘命名旧式（${c}_洞悉.png 需改为 _立绘.png）`);
    if (!hasDongL2D) issues.push(`缺 ${c}_洞悉_L2D.png`);

    // 3) 尤提姆（可选，单文件）—— 不报缺；仅记录是否有
    const hasYou = fset.has(`${c}_尤提姆.png`);

    // 3b) 签名（必有，单文件）
    if (!fset.has(`${c}_签名.png`)) issues.push(`缺 ${c}_签名.png`);

    // 4) 初始单品（应 3 张）
    const initItems = files.filter(f => /^初始_/.test(f));
    if (initItems.length !== 3) {
      issues.push(`初始单品 ${initItems.length}/3 张${initItems.length ? '：' + initItems.map(f=>f.replace(/^初始_|\.png$/g,'')).join('、') : ''}`);
    }

    // 5) 衣着——动态发现所有衣着名
    const yiNames = new Set();
    for (const f of files) {
      const m = f.match(/^衣着_(.+?)(?:_L2D|_立绘)?\.png$/);
      if (m) yiNames.add(m[1]);
    }
    const yiReports = [];
    for (const name of [...yiNames].sort()) {
      const hasLi = fset.has(`衣着_${name}_立绘.png`);
      const hasL2D = fset.has(`衣着_${name}_L2D.png`);
      const hasBare = fset.has(`衣着_${name}.png`);
      // 对应单品：以 `${name}_` 开头但不是 衣着_/初始_
      const items = files.filter(f => f.startsWith(`${name}_`) && !f.startsWith('衣着_') && !f.startsWith('初始_'));
      const probs = [];
      if (!hasLi && !hasBare) probs.push('缺 _立绘');
      else if (hasBare && !hasLi) probs.push(`命名旧式（衣着_${name}.png 需改 _立绘）`);
      if (!hasL2D) probs.push('缺 _L2D');
      if (items.length !== 3) probs.push(`单品 ${items.length}/3${items.length ? '（' + items.map(f=>f.replace(new RegExp(`^${name}_|\\.png$`,'g'),'')).join('、') + '）' : ''}`);
      yiReports.push({ name, ok: probs.length === 0, items: items.length, probs });
    }

    // 6) 列出未归类的 PNG（不属于 主立绘/初始单品/衣着 三类）
    // 合法字段：签名（必有，上方已检查）、基础（部分角色历史遗留）
    const OPTIONAL = ['签名', '基础'];
    const known = new Set([
      `${c}_初始.png`, `${c}_洞悉.png`, `${c}_洞悉_立绘.png`, `${c}_洞悉_L2D.png`, `${c}_尤提姆.png`,
      ...OPTIONAL.map(s => `${c}_${s}.png`),
    ]);
    const extras = [];
    for (const f of files) {
      if (known.has(f)) continue;
      if (/^初始_/.test(f)) continue;
      if (/^衣着_/.test(f)) continue;
      if ([...yiNames].some(n => f.startsWith(`${n}_`))) continue;
      extras.push(f);
    }
    for (const f of extras) issues.push(`未归类文件：${f}`);

    results.push({ org, c, files: files.length, hasYou, yiReports, issues });
  }
}

// 排序：先按问题数倒序，无问题的放最后
results.sort((a, b) => {
  const aN = a.issues.length + a.yiReports.filter(y => !y.ok).length;
  const bN = b.issues.length + b.yiReports.filter(y => !y.ok).length;
  return bN - aN;
});

const okChars = results.filter(r => r.issues.length === 0 && r.yiReports.every(y => y.ok));
const badChars = results.filter(r => r.issues.length > 0 || r.yiReports.some(y => !y.ok));

function format(r) {
  let out = `\n### ${r.org}/${r.c}  (${r.files} 张)\n\n`;
  if (r.issues.length > 0) {
    out += `**基础**：\n`;
    for (const i of r.issues) out += `- ⚠️ ${i}\n`;
  } else {
    out += `**基础**：✅ 完整\n`;
  }
  if (r.yiReports.length === 0) {
    out += `\n**衣着**：（无）\n`;
  } else {
    out += `\n**衣着**（${r.yiReports.length} 套）：\n`;
    for (const y of r.yiReports) {
      if (y.ok) out += `- ✅ ${y.name}\n`;
      else out += `- ⚠️ ${y.name}：${y.probs.join('；')}\n`;
    }
  }
  if (!r.hasYou) out += `\n（无尤提姆）\n`;
  return out;
}

console.log(`卡池已存图片角色：${results.length}\n  ✅ 完整：${okChars.length}\n  ⚠️ 有缺漏：${badChars.length}\n`);
console.log('===== 有缺漏的角色 =====');
for (const r of badChars) console.log(format(r));
console.log('\n===== 已完整的角色 =====');
for (const r of okChars) console.log(`✅ ${r.org}/${r.c} (${r.files} 张${r.hasYou ? '，含尤提姆' : '，无尤提姆'})`);

if (process.argv.includes('--write')) {
  const today = new Date().toISOString().split('T')[0];
  let md = `# 卡池角色立绘·完整度报告\n\n`;
  md += `> 生成于 ${today}，由 \`tools/audit-完整度.js\` 自动产出。\n`;
  md += `> 复跑：\`node tools/audit-完整度.js --write\`\n\n`;
  md += `命名规范详见 [命名规范.md](命名规范.md)。\n\n`;
  md += `**汇总**：卡池已存图片角色 ${results.length}，完整 ${okChars.length}，有缺漏 ${badChars.length}\n\n`;
  md += `---\n\n## ⚠️ 有缺漏（${badChars.length}）\n`;
  for (const r of badChars) md += format(r);
  md += `\n---\n\n## ✅ 已完整（${okChars.length}）\n\n`;
  for (const r of okChars) md += `- ${r.org}/${r.c}（${r.files} 张${r.hasYou ? '，含尤提姆' : '，无尤提姆'}${r.yiReports.length ? '，' + r.yiReports.length + ' 套衣着' : ''}）\n`;
  fs.writeFileSync(REPORT, md, 'utf-8');
  console.log(`\n✅ 已写入 ${REPORT}`);
}
