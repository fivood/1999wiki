#!/usr/bin/env node
/**
 * 增量抓取《重返未来：1999》官网图集壁纸（https://re.bluepoch.com/home/detail.html#wallpaper）。
 *
 * 数据来源：官网接口 POST /activity/official/websites/picture/query。
 * 接口返回的文件名是 UTF-8 中文（如「竖版」），直接用 new URL 会百分号编码成正确的 CDN 路径。
 *
 * 提速要点：
 *   1. 并发下载（默认 12，可用 --concurrency=N 调整）；
 *   2. 本地清单 wallpapers/.manifest.json 记录已下 id，重跑只处理新增/丢失的图；
 *   3. 首次运行会自动「认领」目录里已存在的同名文件，不会重复下载。
 *
 * 用法：
 *   node scripts/fetch-wallpapers.mjs                 # 只下新的
 *   node scripts/fetch-wallpapers.mjs --concurrency=24
 *   node scripts/fetch-wallpapers.mjs --all           # 强制全量重下
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'wallpapers');
const MANIFEST = join(DEST, '.manifest.json');
const API = 'https://re.bluepoch.com/activity/official/websites/picture/query';
const PAGE_SIZE = 1000;
const RETRIES = 3;

const args = process.argv.slice(2);
const FORCE = args.includes('--all') || args.includes('--force');
const CONCURRENCY = (() => {
  const flag = args.find((a) => a.startsWith('--concurrency='));
  const n = Number(flag ? flag.split('=')[1] : process.env.CONCURRENCY || 12);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 64) : 12;
})();

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  referer: 'https://re.bluepoch.com/home/detail.html',
};

/** 从接口返回的 pictureUrl 得到真实可访问的 CDN URL（自动按 UTF-8 编码中文路径） */
function cdnUrl(raw) {
  return new URL(raw).href;
}

/** 接口文件名 → 安全文件名 */
function fileName(item) {
  const host = new URL(item.pictureUrl).host;
  const base = item.pictureUrl.slice(item.pictureUrl.indexOf(host) + host.length).split('/').pop();
  const clean = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return clean || `wallpaper_${item.id}.jpg`;
}

async function fetchAll() {
  const all = [];
  for (let current = 1; ; current++) {
    let json;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(API, { method: 'POST', headers: HEADERS, body: JSON.stringify({ current, pageSize: PAGE_SIZE }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = await res.json();
        break;
      } catch (err) {
        if (attempt >= RETRIES) throw err;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    const page = json?.data?.pageData ?? [];
    const total = json?.data?.total ?? all.length + page.length;
    all.push(...page);
    if (page.length < PAGE_SIZE || all.length >= total) break;
  }
  return all;
}

function loadManifest() {
  if (!existsSync(MANIFEST)) return { items: {} };
  try {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    if (!m.items) m.items = {};
    return m;
  } catch {
    return { items: {} };
  }
}

function saveManifest(manifest) {
  manifest.updatedAt = new Date().toISOString();
  manifest.count = Object.keys(manifest.items).length;
  const tmp = MANIFEST + '.tmp';
  writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  renameSync(tmp, MANIFEST);
}

async function download(item, file) {
  const url = cdnUrl(item.pictureUrl);
  const target = join(DEST, file);
  const tmp = target + '.part';
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(tmp, buf);
      renameSync(tmp, target);
      return buf.length;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr;
}

async function main() {
  mkdirSync(DEST, { recursive: true });
  const manifest = loadManifest();

  const items = await fetchAll();
  console.log(`[wallpapers] 接口返回 ${items.length} 张，本地清单 ${Object.keys(manifest.items).length} 张`);

  // 首次运行：认领目录中已有的同名文件，避免重复下载
  let adopted = 0;
  if (!FORCE) {
    for (const it of items) {
      if (manifest.items[it.id]) continue;
      const file = fileName(it);
      if (existsSync(join(DEST, file))) {
        manifest.items[it.id] = { file, url: it.pictureUrl, size: statSync(join(DEST, file)).size, adopted: true };
        adopted++;
      }
    }
    if (adopted) console.log(`[wallpapers] 认领已存在文件 ${adopted} 张`);
  }

  const todo = FORCE
    ? items
    : items.filter((it) => {
        const m = manifest.items[it.id];
        return !m || !existsSync(join(DEST, m.file));
      });

  if (todo.length === 0) {
    saveManifest(manifest);
    console.log('[wallpapers] 已是最新，无需下载');
    return;
  }
  console.log(`[wallpapers] 需要下载 ${todo.length} 张（并发 ${CONCURRENCY}）`);

  const queue = todo.slice();
  let done = 0;
  let failed = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const file = fileName(item);
      try {
        const size = await download(item, file);
        manifest.items[item.id] = { file, url: item.pictureUrl, size };
      } catch (err) {
        failed++;
        console.error(`[wallpapers] 失败 id=${item.id} ${file}: ${err.message}`);
      }
      done++;
      if (done % 25 === 0 || done === todo.length) {
        saveManifest(manifest);
        console.log(`[wallpapers] ${done}/${todo.length} 失败 ${failed}`);
      }
    }
  });
  await Promise.all(runners);

  saveManifest(manifest);
  console.log(`[wallpapers] 完成：新增 ${todo.length - failed} 张，失败 ${failed} 张，清单共 ${manifest.count} 张`);
}

await main();
