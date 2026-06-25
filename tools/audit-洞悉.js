// 立绘文件命名规范审计
//
// 规范（详见 raw/立绘/命名规范.md）：
//   - 初始 / 尤提姆 = 单文件 {角色}_{节点}.png
//   - 洞悉           = 双文件 {角色}_洞悉_立绘.png + {角色}_洞悉_L2D.png
//   - 衣着           = 双文件 衣着_{衣着名}_立绘.png + 衣着_{衣着名}_L2D.png
//
// 旧式问题：
//   - {角色}_洞悉.png   （缺 _立绘 后缀，L2D 也可能缺）
//   - 衣着_{衣着名}.png （缺 _立绘 后缀，L2D 已并存）
//
// 用法：
//   node tools/audit-洞悉.js          # 打印报告
//   node tools/audit-洞悉.js --write  # 同时输出 raw/立绘/补L2D清单.md
//   node tools/audit-洞悉.js --rename # 执行批量改名（仅改名，不补 L2D）
const fs = require('fs');
const path = require('path');

const LIPING = 'g:\\1999story\\raw\\立绘';
const CHECKLIST = path.join(LIPING, '补L2D清单.md');

// 检查一对 (bare / L2D / 立绘)，返回 issue 或 null
function checkDual({ org, c, label, bare, l2d, li, hasBare, hasL2D, hasLi }) {
  if (!hasBare && !hasL2D && !hasLi) return null; // 完全没存
  if (hasL2D && hasLi) return null;               // 新规范完整

  if (hasBare && !hasL2D && !hasLi) {
    return { type: 'rename+missingL2D', org, c, label, from: bare, toLi: li, addL2D: l2d };
  }
  if (hasBare && hasL2D && !hasLi) {
    return { type: 'rename', org, c, label, from: bare, toLi: li, addL2D: null };
  }
  if (hasBare && hasLi && !hasL2D) {
    return { type: 'cleanup+missingL2D', org, c, label, from: bare, toLi: null, addL2D: l2d };
  }
  if (hasL2D && !hasLi && !hasBare) {
    return { type: 'missingLi', org, c, label, from: null, toLi: li, addL2D: null };
  }
  if (hasLi && !hasL2D && !hasBare) {
    return { type: 'missingL2D', org, c, label, from: null, toLi: null, addL2D: l2d };
  }
  return null;
}

const issues = [];

for (const org of fs.readdirSync(LIPING)) {
  const orgPath = path.join(LIPING, org);
  if (!fs.statSync(orgPath).isDirectory()) continue;
  for (const c of fs.readdirSync(orgPath)) {
    const charPath = path.join(orgPath, c);
    if (!fs.statSync(charPath).isDirectory()) continue;
    const files = new Set(fs.readdirSync(charPath));

    // 1) 洞悉
    {
      const bare = `${c}_洞悉.png`;
      const l2d = `${c}_洞悉_L2D.png`;
      const li = `${c}_洞悉_立绘.png`;
      const issue = checkDual({
        org, c, label: '洞悉', bare, l2d, li,
        hasBare: files.has(bare), hasL2D: files.has(l2d), hasLi: files.has(li),
      });
      if (issue) issues.push(issue);
    }

    // 2) 衣着——动态发现所有衣着名
    const yiNames = new Set();
    for (const f of files) {
      const m = f.match(/^衣着_(.+?)(?:_L2D|_立绘)?\.png$/);
      if (m) yiNames.add(m[1]);
    }
    for (const name of yiNames) {
      const bare = `衣着_${name}.png`;
      const l2d = `衣着_${name}_L2D.png`;
      const li = `衣着_${name}_立绘.png`;
      const issue = checkDual({
        org, c, label: `衣着·${name}`, bare, l2d, li,
        hasBare: files.has(bare), hasL2D: files.has(l2d), hasLi: files.has(li),
      });
      if (issue) issues.push(issue);
    }
  }
}

console.log(`=== 共 ${issues.length} 处命名/补图问题 ===\n`);
const byType = {};
for (const it of issues) (byType[it.type] = byType[it.type] || []).push(it);
for (const [t, arr] of Object.entries(byType)) {
  console.log(`【${t}】(${arr.length})`);
  for (const it of arr) {
    let action = '';
    if (it.from && it.toLi) action += `rename "${it.from}" → "${path.basename(it.toLi)}"`;
    else if (it.from && !it.toLi) action += `删除冗余 "${it.from}"`;
    if (it.addL2D) action += (action ? ' ; ' : '') + `补存 "${path.basename(it.addL2D)}"`;
    if (it.toLi && !it.from) action += `补存 "${path.basename(it.toLi)}"`;
    console.log(`  ${it.org}/${it.c} · ${it.label}  → ${action}`);
  }
  console.log();
}

if (process.argv.includes('--rename')) {
  let renamed = 0, removed = 0, errors = 0;
  for (const it of issues) {
    if (!it.from) continue;
    const dir = path.join(LIPING, it.org, it.c);
    const fromPath = path.join(dir, it.from);
    try {
      if (it.toLi) {
        const toPath = path.join(dir, path.basename(it.toLi));
        fs.renameSync(fromPath, toPath);
        console.log(`✅ rename ${it.org}/${it.c}/${it.from} → ${path.basename(it.toLi)}`);
        renamed++;
      } else {
        fs.unlinkSync(fromPath);
        console.log(`🗑️  removed ${it.org}/${it.c}/${it.from}（立绘版本已存）`);
        removed++;
      }
    } catch (e) {
      console.error(`❌ ${it.org}/${it.c}/${it.from} : ${e.message}`);
      errors++;
    }
  }
  console.log(`\n汇总：改名 ${renamed} / 删除 ${removed} / 错误 ${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

if (process.argv.includes('--write')) {
  const today = new Date().toISOString().split('T')[0];
  const byChar = {};
  for (const it of issues) {
    const key = `${it.org}/${it.c}`;
    (byChar[key] = byChar[key] || []).push(it);
  }
  let md = `# 立绘文件命名规范化·待办清单\n\n`;
  md += `> 生成于 ${today}，由 \`tools/audit-洞悉.js\` 自动产出。\n`;
  md += `> 复跑：\`node tools/audit-洞悉.js --write\`\n\n`;
  md += `命名规范详见 [命名规范.md](命名规范.md)。\n\n`;
  md += `本清单追踪：\n`;
  md += `- **洞悉** 节点缺失 \`_L2D\` 或 \`_立绘\` 版本\n`;
  md += `- **衣着** 立绘缺失 \`_L2D\` 或 \`_立绘\` 版本\n\n`;
  md += `（初始/尤提姆/单品 都是单文件，不在本清单范围内）\n\n`;
  md += `---\n\n## 待办（${issues.length} 处，涉及 ${Object.keys(byChar).length} 个角色）\n`;
  for (const [key, list] of Object.entries(byChar)) {
    md += `\n### ${key}\n\n`;
    for (const it of list) {
      if (it.from && it.toLi && it.addL2D) {
        md += `- [ ] **${it.label}**：改名 \`${path.basename(it.from)}\` → \`${path.basename(it.toLi)}\`；补存 \`${path.basename(it.addL2D)}\`\n`;
      } else if (it.from && it.toLi) {
        md += `- [ ] **${it.label}**：改名 \`${path.basename(it.from)}\` → \`${path.basename(it.toLi)}\`（L2D 已存）\n`;
      } else if (it.from && it.addL2D) {
        md += `- [ ] **${it.label}**：删除冗余 \`${path.basename(it.from)}\`；补存 \`${path.basename(it.addL2D)}\`\n`;
      } else if (it.addL2D) {
        md += `- [ ] **${it.label}**：补存 \`${path.basename(it.addL2D)}\`\n`;
      } else if (it.toLi) {
        md += `- [ ] **${it.label}**：补存 \`${path.basename(it.toLi)}\`\n`;
      }
    }
  }
  fs.writeFileSync(CHECKLIST, md, 'utf-8');
  console.log(`\n✅ 已写入 ${CHECKLIST}`);
}
