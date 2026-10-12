#!/usr/bin/env node
/**
 * 增量抓取《重返未来：1999》官网的视频、音乐、图集（https://re.bluepoch.com/home/）。
 *
 * 数据来源（均为 POST JSON 接口，无需登录）：
 *   视频 video/query   → videoUrl（mp4）
 *   音乐 music/query   → musicUrl（多为 wav）
 *   图集 picture/query → pictureUrl（jpg/png）
 *
 * 输出：site/media/{video,music,picture}/，每类一份 .manifest.json，记录已下 id，重跑只补新增。
 *
 * 用法：
 *   node scripts/fetch-media.mjs                        # 三类都抓，只下新增
 *   node scripts/fetch-media.mjs --type=video,music     # 只抓指定类型
 *   node scripts/fetch-media.mjs --dry-run              # 只列出数量，不下载
 *   node scripts/fetch-media.mjs --concurrency=4        # 调整并发（默认 6）
 *   node scripts/fetch-media.mjs --all                  # 忽略清单，强制重下
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 强制直连：清除代理环境变量，所有请求不经过代理（含系统代理 127.0.0.1:7897）
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[k];
}
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';
delete process.env.NODE_USE_ENV_PROXY;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST_ROOT = join(ROOT, 'media');
const API_BASE = 'https://re.bluepoch.com/activity/official/websites';
const PAGE_SIZE = 999;
const RETRIES = 3;

/** 类型配置：接口路径、资源字段、保存子目录 */
const KINDS = {
  video: { api: 'video/query', urlField: 'videoUrl', dir: 'video' },
  music: { api: 'music/query', urlField: 'musicUrl', dir: 'music' },
  picture: { api: 'picture/query', urlField: 'pictureUrl', dir: 'picture' },
};

const args = process.argv.slice(2);
const FORCE = args.includes('--all') || args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const TYPES = (() => {
  const flag = args.find((a) => a.startsWith('--type='));
  if (!flag) return Object.keys(KINDS);
  const list = flag.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((k) => !KINDS[k]);
  if (bad.length) {
    console.error(`未知类型: ${bad.join(', ')}（可选: ${Object.keys(KINDS).join(', ')}）`);
    process.exit(1);
  }
  return list;
})();
const CONCURRENCY = (() => {
  const flag = args.find((a) => a.startsWith('--concurrency='));
  const n = Number(flag ? flag.split('=')[1] : process.env.CONCURRENCY || 6);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 32) : 6;
})();

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  referer: 'https://re.bluepoch.com/home/',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await sleep(500 * attempt);
    }
  }
  throw new Error(`${label}: ${lastErr.message}`);
}

/** 分页拉取某类型的全部条目（只保留 status=1 的上线条目） */
async function fetchAll(kind) {
  const all = [];
  for (let current = 1; ; current++) {
    const json = await withRetry(async () => {
      const res = await fetch(`${API_BASE}/${KINDS[kind].api}`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ id: '', collectionId: '', current, pageSize: PAGE_SIZE }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, `${kind} 列表第 ${current} 页`);
    const page = json?.data?.pageData ?? [];
    const total = json?.data?.total ?? all.length + page.length;
    all.push(...page);
    if (page.length < PAGE_SIZE || all.length >= total) break;
  }
  return all.filter((it) => it[KINDS[kind].urlField] && it.status !== 0);
}

/** 从资源 URL 得到安全的本地文件名（保留原始文件名，解码中文） */
function fileName(url, id) {
  const last = new URL(url).pathname.split('/').pop() || `${id}`;
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // 保持原样
  }
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return clean || `${id}`;
}

function loadManifest(file) {
  if (!existsSync(file)) return { items: {} };
  try {
    const m = JSON.parse(readFileSync(file, 'utf8'));
    if (!m.items) m.items = {};
    return m;
  } catch {
    return { items: {} };
  }
}

function saveManifest(file, manifest) {
  manifest.updatedAt = new Date().toISOString();
  manifest.count = Object.keys(manifest.items).length;
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  renameSync(tmp, file);
}

/** 流式下载到 .part，成功后改名，避免留下半截文件 */
async function download(url, target) {
  return withRetry(async () => {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = target + '.part';
    writeFileSync(tmp, buf);
    renameSync(tmp, target);
    return buf.length;
  }, `下载 ${url}`);
}

async function syncKind(kind) {
  const cfg = KINDS[kind];
  const dir = join(DEST_ROOT, cfg.dir);
  const manifestFile = join(dir, '.manifest.json');
  mkdirSync(dir, { recursive: true });
  const manifest = loadManifest(manifestFile);

  const items = await fetchAll(kind);
  console.log(`[${kind}] 接口返回 ${items.length} 条，本地清单 ${Object.keys(manifest.items).length} 条`);
  if (DRY_RUN) return;

  // 认领目录中已存在的同名文件，避免重复下载
  if (!FORCE) {
    let adopted = 0;
    for (const it of items) {
      if (manifest.items[it.id]) continue;
      const url = it[cfg.urlField];
      const file = fileName(url, it.id);
      if (existsSync(join(dir, file))) {
        manifest.items[it.id] = { file, url, size: statSync(join(dir, file)).size, adopted: true };
        adopted++;
      }
    }
    if (adopted) console.log(`[${kind}] 认领已存在文件 ${adopted} 个`);
  }

  const todo = items.filter((it) => {
    if (FORCE) return true;
    const m = manifest.items[it.id];
    return !m || !existsSync(join(dir, m.file));
  });

  if (todo.length === 0) {
    saveManifest(manifestFile, manifest);
    console.log(`[${kind}] 已是最新，无需下载`);
    return;
  }
  console.log(`[${kind}] 需要下载 ${todo.length} 个（并发 ${CONCURRENCY}）`);

  const queue = todo.slice();
  let done = 0;
  let failed = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const url = item[cfg.urlField];
      const file = fileName(url, item.id);
      try {
        const size = await download(url, join(dir, file));
        manifest.items[item.id] = { file, url, size };
      } catch (err) {
        failed++;
        console.error(`[${kind}] 失败 id=${item.id} ${file}: ${err.message}`);
      }
      done++;
      if (done % 10 === 0 || done === todo.length) {
        saveManifest(manifestFile, manifest);
        console.log(`[${kind}] ${done}/${todo.length} 失败 ${failed}`);
      }
    }
  });
  await Promise.all(runners);

  saveManifest(manifestFile, manifest);
  console.log(`[${kind}] 完成：新增 ${todo.length - failed} 个，失败 ${failed} 个，清单共 ${manifest.count} 个`);
}

async function main() {
  for (const kind of TYPES) {
    try {
      await syncKind(kind);
    } catch (err) {
      console.error(`[${kind}] 出错，跳过: ${err.message}`);
    }
  }
}

await main();
