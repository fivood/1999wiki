/**
 * 一次性工具：把仓库根 raw/立绘/<组织>/<角色>/<角色>_初始.png 批量压成 webp，
 * 输出 public/portraits/<安全名>.webp + index.json（词条 id → 图片路径），产物入库。
 * build-universe 只读 index.json（素材不变就不必重跑）。
 * sharp 复用同仓 web/node_modules（不入 site 依赖）。
 *
 * 用法：node scripts/make-portraits.cjs   （素材有更新时重跑）
 */
const { createRequire } = require('node:module');
const { mkdirSync, existsSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const sharp = createRequire(join(root, '..', 'web', 'package.json'))('sharp');
const SRC = join(root, '..', 'raw', '立绘');
const OUT = join(root, 'public', 'portraits');

const safeName = (s) => s.replace(/[^\p{L}\p{N}·\-_]/gu, (ch) => '_' + ch.charCodeAt(0).toString(16) + '_');
const dirs = (p) => readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

(async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const index = {};
  for (const org of dirs(SRC)) {
    for (const name of dirs(join(SRC, org))) {
      const from = ['初始', '基础'].map((v) => join(SRC, org, name, `${name}_${v}.png`)).find(existsSync);
      if (!from) continue;
      const id = `角色/${org}/${name}`;
      const file = safeName(id) + '.webp';
      await sharp(from).resize({ height: 760, withoutEnlargement: true }).webp({ quality: 78 }).toFile(join(OUT, file));
      index[id] = `/portraits/${file}`;
    }
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`[portraits] ${Object.keys(index).length} 张 → public/portraits/`);
})();
