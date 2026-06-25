// 一次性回滚脚本：把上一轮误改的 {角色}_初始_立绘.png / {角色}_尤提姆_立绘.png
// 改回 {角色}_初始.png / {角色}_尤提姆.png（单文件规范）
const fs = require('fs');
const path = require('path');

const LIPING = 'g:\\1999story\\raw\\立绘';
const REVERT_NODES = ['初始', '尤提姆'];

let renamed = 0, skipped = 0, errors = 0;

for (const org of fs.readdirSync(LIPING)) {
  const orgPath = path.join(LIPING, org);
  if (!fs.statSync(orgPath).isDirectory()) continue;
  for (const c of fs.readdirSync(orgPath)) {
    const charPath = path.join(orgPath, c);
    if (!fs.statSync(charPath).isDirectory()) continue;
    const files = new Set(fs.readdirSync(charPath));
    for (const node of REVERT_NODES) {
      const li = `${c}_${node}_立绘.png`;
      const bare = `${c}_${node}.png`;
      if (!files.has(li)) continue;
      if (files.has(bare)) {
        console.warn(`⚠️ skip ${org}/${c}/${li}（${bare} 已存在）`);
        skipped++;
        continue;
      }
      try {
        fs.renameSync(path.join(charPath, li), path.join(charPath, bare));
        console.log(`✅ ${org}/${c}/${li} → ${bare}`);
        renamed++;
      } catch (e) {
        console.error(`❌ ${org}/${c}/${li} : ${e.message}`);
        errors++;
      }
    }
  }
}
console.log(`\n汇总：回滚 ${renamed} / 跳过 ${skipped} / 错误 ${errors}`);
