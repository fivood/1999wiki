// 审计立绘文件夹的"洞悉/初始/尤提姆"命名规范
// 新规范：{角色}_{节点}_L2D.png + {角色}_{节点}_立绘.png（两张）
// 旧问题：只有 {角色}_{节点}.png（无后缀，缺 L2D）
//
// 用法：
//   node tools/audit-洞悉.js          # 只打印
//   node tools/audit-洞悉.js --write  # 同时输出 raw/立绘/补L2D清单.md
//   node tools/audit-洞悉.js --rename # 执行批量改名（仅改名，不补 L2D）
const fs = require('fs');
const path = require('path');

const LIPING = 'g:\\1999story\\raw\\立绘';
const CHECKLIST = path.join(LIPING, '补L2D清单.md');
// 仅 洞悉 节点需要 _L2D + _立绘 双版；初始/尤提姆 都是单文件
const NODES = ['洞悉'];
const SINGLE_NODES = ['初始', '尤提姆']; // 单文件节点：旧式 {角色}_{节点}.png 即正确

const issues = [];

for (const org of fs.readdirSync(LIPING)) {
  const orgPath = path.join(LIPING, org);
  if (!fs.statSync(orgPath).isDirectory()) continue;
  for (const c of fs.readdirSync(orgPath)) {
    const charPath = path.join(orgPath, c);
    if (!fs.statSync(charPath).isDirectory()) continue;
    const files = new Set(fs.readdirSync(charPath));
    for (const node of NODES) {
      const bare = `${c}_${node}.png`;
      const l2d = `${c}_${node}_L2D.png`;
      const li = `${c}_${node}_立绘.png`;
      const hasBare = files.has(bare);
      const hasL2D = files.has(l2d);
      const hasLi = files.has(li);

      if (!hasBare && !hasL2D && !hasLi) continue; // 完全没存
      if (hasL2D && hasLi) continue;               // 新规范完整

      if (hasBare && !hasL2D && !hasLi) {
        issues.push({ type: 'rename+missingL2D', org, c, node,
          from: bare, toLi: li, addL2D: l2d });
      } else if (hasBare && hasL2D && !hasLi) {
        issues.push({ type: 'rename', org, c, node,
          from: bare, toLi: li, addL2D: null });
      } else if (hasBare && hasLi && !hasL2D) {
        issues.push({ type: 'cleanup+missingL2D', org, c, node,
          from: bare, toLi: null, addL2D: l2d });
      } else if (hasL2D && !hasLi && !hasBare) {
        issues.push({ type: 'missingLi', org, c, node, from: null, toLi: li, addL2D: null });
      } else if (hasLi && !hasL2D && !hasBare) {
        issues.push({ type: 'missingL2D', org, c, node, from: null, toLi: null, addL2D: l2d });
      }
    }
  }
}

console.log(`=== 共 ${issues.length} 处问题 ===\n`);
const byType = {};
for (const it of issues) (byType[it.type] = byType[it.type] || []).push(it);
for (const [t, arr] of Object.entries(byType)) {
  console.log(`【${t}】(${arr.length})`);
  for (const it of arr) {
    let action = '';
    if (it.from && it.toLi) action += `rename "${it.from}" → "${path.basename(it.toLi)}"`;
    if (it.addL2D) action += (action ? ' ; ' : '') + `补存 "${path.basename(it.addL2D)}"`;
    console.log(`  ${it.org}/${it.c} · ${it.node}  → ${action}`);
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
        // cleanup+missingL2D 情形：删除冗余的 bare
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
  // 按角色聚合
  const byChar = {};
  for (const it of issues) {
    const key = `${it.org}/${it.c}`;
    (byChar[key] = byChar[key] || []).push(it);
  }
  let md = `# 立绘文件命名规范化·补 L2D 清单\n\n`;
  md += `> 生成于 ${today}，由 \`tools/audit-洞悉.js\` 自动产出。\n`;
  md += `> 复跑：\`node tools/audit-洞悉.js --write\`\n\n`;
  md += `## 命名规范\n\n`;
  md += `- **初始**：单文件 \`{角色}_初始.png\`（无 L2D 版本）\n`;
  md += `- **洞悉**：双文件 \`{角色}_洞悉_立绘.png\` + \`{角色}_洞悉_L2D.png\`\n`;
  md += `- **尤提姆**：单文件 \`{角色}_尤提姆.png\`（无 L2D 版本）\n\n`;
  md += `本清单仅追踪洞悉节点缺失的 L2D 版本（初始/尤提姆 不分 L2D）。\n\n`;
  md += `---\n\n## 待办（${issues.length} 处，涉及 ${Object.keys(byChar).length} 个角色）\n`;
  for (const [key, list] of Object.entries(byChar)) {
    md += `\n### ${key}\n\n`;
    for (const it of list) {
      if (it.from && it.toLi && it.addL2D) {
        md += `- [ ] **${it.node}**：改名 \`${path.basename(it.from)}\` → \`${path.basename(it.toLi)}\`；补存 \`${path.basename(it.addL2D)}\`\n`;
      } else if (it.from && it.toLi) {
        md += `- [ ] **${it.node}**：改名 \`${path.basename(it.from)}\` → \`${path.basename(it.toLi)}\`（L2D 已存）\n`;
      } else if (it.from && it.addL2D) {
        md += `- [ ] **${it.node}**：删除冗余 \`${path.basename(it.from)}\`；补存 \`${path.basename(it.addL2D)}\`\n`;
      } else if (it.addL2D) {
        md += `- [ ] **${it.node}**：补存 \`${path.basename(it.addL2D)}\`\n`;
      } else if (it.toLi) {
        md += `- [ ] **${it.node}**：补存 \`${path.basename(it.toLi)}\`\n`;
      }
    }
  }
  fs.writeFileSync(CHECKLIST, md, 'utf-8');
  console.log(`\n✅ 已写入 ${CHECKLIST}`);
}
