/**
 * 内容同步脚本：把 1999wiki 仓库的 wiki/ 目录复制到 src/content/wiki/，
 * 复制时把 Obsidian 内链改写为标准 Markdown 链接（与 Markdown 处理器解耦）：
 *   [[角色/司辰小队/维尔汀]]   → [维尔汀](/archive/角色/司辰小队/维尔汀)
 *   [[世界观/暴雨|“暴雨”]]     → [“暴雨”](/archive/世界观/暴雨)（前缀 = site-base.mjs 的 BASE）
 * 目标不存在时退化为纯文本（避免死链）；围栏代码块内不改写。
 * 同时生成 src/content/ids.json（词条 id 清单）。
 *
 * 内容源优先级：环境变量 WIKI_SRC > 仓库根 wiki/（与 web/ 同仓）
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE } from '../site-base.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.WIKI_SRC || join(root, '..', 'wiki');
const DEST = join(root, 'src', 'content', 'wiki');
const IDS = join(root, 'src', 'content', 'ids.json');

// 旧仓库中本地专属、未入库的文件（CI checkout 不会有，本地同步也要排除以保持一致）
const EXCLUDE = new Set(['世界观/版本-时空对照表.md']);

if (!existsSync(SRC)) {
  console.error(`[sync] 内容源不存在: ${SRC}`);
  console.error('[sync] 请设置 WIKI_SRC 指向 1999wiki 仓库的 wiki/ 目录');
  process.exit(1);
}

/** 递归收集 .md 文件（posix 相对路径） */
function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else if (name.endsWith('.md')) out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

const WIKILINK = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

function rewriteWikilinks(text, idSet) {
  const lines = text.split('\n');
  let fenced = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(WIKILINK, (_, target, alias) => {
        const id = target.trim().replace(/\.md$/, '');
        const label = (alias || id.split('/').pop()).trim();
        if (!idSet.has(id)) return label;
        const href = BASE + '/' + id.split('/').map(encodeURIComponent).join('/');
        return `[${label}](${href})`;
      });
    })
    .join('\n');
}

const files = walk(SRC).filter((f) => !EXCLUDE.has(f));
const ids = files.map((f) => f.replace(/\.md$/, '')).sort();
const idSet = new Set(ids);

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

for (const f of files) {
  const to = join(DEST, f);
  mkdirSync(dirname(to), { recursive: true });
  const text = readFileSync(join(SRC, f), 'utf8');
  writeFileSync(to, rewriteWikilinks(text, idSet), 'utf8');
}

// 主题/ 目前为空，同步后目录可能不存在，占位防 glob 报错
mkdirSync(join(DEST, '主题'), { recursive: true });

writeFileSync(IDS, JSON.stringify(ids, null, 0) + '\n', 'utf8');

console.log(`[sync] ${files.length} 个词条 ← ${SRC}`);
