/**
 * 宇宙数据构建：整个 wiki = 一个宇宙。
 *   分类（角色/剧情概要/世界观…）= 星系；二级目录（组织/活动章节…）= 星团；词条 = 行星；
 *   正文里任意 /分类/… 的内链 = 连线（跨分类也画）。
 *
 * 输出：
 *   src/data/universe.json         —— 布局 + 元数据 + 边（构建时 import）
 *   public/data/entry/<safe>.json  —— 单条正文（面板按需 fetch）
 *
 * 全部从目录结构派生：新增分类/目录/词条会自动入轨，无需改这里。
 * 唯一的手写设定是坐标原点：维尔汀（司辰）。
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src', 'content', 'wiki');
const OUT_PUB = join(root, 'public', 'data', 'entry');
const OUT_IDX = join(root, 'src', 'data', 'universe.json');
// make-portraits.cjs 一次性生成并入库的立绘清单（CI 上没有 raw 素材，只读这份清单）
const PORTRAITS = join(root, 'public', 'portraits', 'index.json');

const ORIGIN_ID = '角色/司辰小队/维尔汀';
const [ORIGIN_CAT, ORIGIN_SUB] = ORIGIN_ID.split('/');

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/* ---------- 工具 ---------- */
const safeName = (s) => s.replace(/[^\p{L}\p{N}·\-_]/gu, (ch) => '_' + ch.charCodeAt(0).toString(16) + '_');
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else if (name.endsWith('.md')) out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}
function parseFront(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { front: {}, body: text };
  const front = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]\w*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, val] = kv;
    front[key] = /^\[.*\]$/.test(val)
      ? val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["'](.*)["']$/, '$1')).filter(Boolean)
      : val.replace(/^["'](.*)["']$/, '$1');
  }
  return { front, body: text.slice(m[0].length) };
}
function summary(body, max = 140) {
  const p = body
    .replace(/^#.*$|^>.*$|^\|.*$/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .split(/\r?\n\s*\r?\n/).map((s) => s.trim()).find((s) => s.length >= 12) || '';
  return p.length > max ? p.slice(0, max) + '…' : p;
}
function links(body) {
  const out = new Set();
  for (const m of body.matchAll(/\]\((\/[^)\s#]+)\)/g)) {
    try { out.add(decodeURIComponent(m[1]).slice(1)); } catch { /* 坏链接跳过 */ }
  }
  return out;
}
const arr = (v) => (Array.isArray(v) ? v : []);
const r3 = (n) => +n.toFixed(3);

/** 椭圆轨道上一点（与前端 sampleOrbit 同一套旋转顺序：Z → X → Y） */
function orbitPoint(o, phase, lift) {
  const lx = o.a * Math.cos(phase), lz = o.b * Math.sin(phase);
  let x = lx * Math.cos(o.tiltZ) - lift * Math.sin(o.tiltZ);
  let y = lx * Math.sin(o.tiltZ) + lift * Math.cos(o.tiltZ);
  let z = lz;
  [y, z] = [y * Math.cos(o.tiltX) - z * Math.sin(o.tiltX), y * Math.sin(o.tiltX) + z * Math.cos(o.tiltX)];
  [x, z] = [x * Math.cos(o.tiltY) + z * Math.sin(o.tiltY), -x * Math.sin(o.tiltY) + z * Math.cos(o.tiltY)];
  return [x, y, z];
}

/* ---------- 读取 ---------- */
if (!existsSync(SRC)) { console.error(`[universe] 未找到 ${SRC}，先运行 sync-content`); process.exit(1); }
const portraits = existsSync(PORTRAITS) ? JSON.parse(readFileSync(PORTRAITS, 'utf8')) : {};

rmSync(OUT_PUB, { recursive: true, force: true });
mkdirSync(OUT_PUB, { recursive: true });
mkdirSync(dirname(OUT_IDX), { recursive: true });

const entries = [];
for (const rel of walk(SRC)) {
  const parts = rel.replace(/\.md$/, '').split('/');
  if (parts.length < 2) continue; // wiki/index.md 不是词条
  const id = parts.join('/');
  const { front, body } = parseFront(readFileSync(join(SRC, rel), 'utf8'));
  const sources = arr(front.sources);
  const file = safeName(id) + '.json';
  const entry = {
    id,
    cat: parts[0],
    sub: parts.length > 2 ? parts.slice(1, -1).join('/') : '',
    name: parts[parts.length - 1],
    title: front.title || parts[parts.length - 1],
    aliases: arr(front.aliases),
    file,
    portrait: portraits[id] ?? null,
    summary: summary(body),
    // 份量：角色用登场场次，其他用正文长度
    weight: sources.length ? Math.log2(1 + sources.length) / 4 : Math.log2(1 + body.length / 900) / 3.5,
    out: links(body),
  };
  entries.push(entry);
  writeFileSync(join(OUT_PUB, file), JSON.stringify({
    id, title: entry.title, cat: entry.cat, sub: entry.sub, aliases: entry.aliases,
    tags: arr(front.tags), sources, updated: front.updated || null, portrait: entry.portrait, body,
  }));
}
entries.sort((a, b) => a.id.localeCompare(b.id, 'zh'));

/* ---------- 布局：分类 → 星团 → 轨道 ---------- */
const subRadius = (n) => Math.min(20, Math.max(4, Math.sqrt(n) * 2.2));
const spiralDist = (i) => (i === 0 ? 0 : 14 + Math.sqrt(i) * 22);

function groupBy(list, key) {
  const m = new Map();
  for (const e of list) { const k = key(e); if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
  return m;
}
/** pinned 永远排第一，其余按数量降序 */
const ranked = (m, pinned) => [...m.entries()].sort((a, b) =>
  (b[0] === pinned) - (a[0] === pinned) || b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh'));

const cats = [];
const groups = [];
for (const [cat, list] of ranked(groupBy(entries, (e) => e.cat), ORIGIN_CAT)) {
  const subs = ranked(groupBy(list, (e) => e.sub), cat === ORIGIN_CAT ? ORIGIN_SUB : '').map(([sub, members], i) => {
    const r = subRadius(members.length);
    const ang = (i - 1) * GOLDEN + Math.PI / 6;
    const d = spiralDist(i);
    const rng = prng(hash32(cat + '/' + sub));
    return { sub, members, r, local: [Math.cos(ang) * d, i === 0 ? 0 : (rng() - 0.5) * 8, Math.sin(ang) * d] };
  });
  const extent = Math.max(...subs.map((s) => Math.hypot(s.local[0], s.local[2]) + s.r));
  cats.push({ id: cat, count: list.length, extent, subs });
}

// 分类星系环绕原点：第 0 个（维尔汀所在）在原点，其余黄金角铺开，距离保证互不重叠
const coreExtent = cats[0].extent;
cats.forEach((c, i) => {
  const rng = prng(hash32(c.id));
  if (i === 0) { c.center = [0, 0, 0]; return; }
  const d = coreExtent + 34 + c.extent + i * 6;
  const ang = (i - 1) * GOLDEN + 0.4;
  c.center = [Math.cos(ang) * d, (rng() - 0.5) * 24, Math.sin(ang) * d];
});

const placed = [];
for (const c of cats) {
  for (const s of c.subs) {
    const center = s.local.map((v, k) => v + c.center[k]);
    const key = s.sub ? `${c.id}/${s.sub}` : c.id;
    const n = s.members.length;
    const orbitCount = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(n / 2))));
    const rng = prng(hash32(key + '::orbits'));
    const orbits = Array.from({ length: orbitCount }, (_, i) => {
      const a = orbitCount === 1 ? s.r * 0.7 : s.r * (0.28 + 0.7 * (i / (orbitCount - 1)));
      return {
        a: r3(a), b: r3(a * (0.92 - rng() * 0.22)),
        tiltX: r3((rng() - 0.5) * 0.55), tiltY: r3(rng() * Math.PI * 2), tiltZ: r3((rng() - 0.5) * 0.35),
        phase0: r3(rng() * Math.PI * 2),
      };
    });
    groups.push({
      key, cat: c.id, sub: s.sub, count: n, radius: r3(s.r),
      center: center.map(r3), orbits,
    });

    // 组内按 id 排序后依次排上轨道：增删一条只会挪动相邻位置
    const perOrbit = Math.ceil(n / orbitCount);
    s.members.forEach((e, idx) => {
      const oi = Math.min(orbitCount - 1, Math.floor(idx / perOrbit));
      const prand = prng(hash32(e.id + '::phase'));
      const phase = orbits[oi].phase0 + ((idx - oi * perOrbit) / perOrbit) * Math.PI * 2 + (prand() - 0.5) * 0.35;
      const p = orbitPoint(orbits[oi], phase, (prand() - 0.5) * 0.6);
      const origin = e.id === ORIGIN_ID;
      placed.push({
        id: e.id, cat: e.cat, sub: e.sub, group: key, name: e.name, title: e.title,
        aliases: e.aliases, file: e.file, portrait: e.portrait, summary: e.summary,
        pos: origin ? [0, 0, 0] : p.map((v, k) => r3(v + center[k])),
        size: origin ? 1.1 : r3(0.18 + Math.min(1, e.weight) * 0.55),
        origin: origin || undefined,
      });
    });
  }
}

/* ---------- 边：任意词条 → 任意词条，去重成无向 ---------- */
const idSet = new Set(entries.map((e) => e.id));
const seen = new Set();
const edges = [];
for (const e of entries) {
  for (const t of e.out) {
    if (t === e.id || !idSet.has(t)) continue;
    const [a, b] = e.id < t ? [e.id, t] : [t, e.id];
    if (seen.has(a + '\n' + b)) continue;
    seen.add(a + '\n' + b);
    edges.push([a, b]);
  }
}

placed.sort((a, b) => a.id.localeCompare(b.id, 'zh'));
writeFileSync(OUT_IDX, JSON.stringify({
  cats: cats.map((c) => ({ id: c.id, count: c.count, center: c.center.map(r3), extent: r3(c.extent) })),
  groups,
  entries: placed,
  edges,
}));
console.log(`[universe] ${placed.length} 词条 / ${cats.length} 星系 / ${groups.length} 星团 / ${edges.length} 连线 / ${Object.keys(portraits).length} 立绘`);
