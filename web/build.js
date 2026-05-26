const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

// sharp 可选：用于生成压缩水印 WebP；未安装时退化为直接复制原图
let sharp = null;
try { sharp = require('sharp'); } catch (e) { console.warn('⚠ sharp 未安装，水印将直接复制原图（可运行 npm install sharp --save-dev 安装）'); }

const WIKI_DIR = path.join(__dirname, '..', 'wiki');
const RAW_DIR  = path.join(__dirname, '..', 'raw');
const DIST_DIR = path.join(__dirname, 'dist');
const TEMPLATE_PATH = path.join(__dirname, 'template.html');
const CSS_PATH = path.join(__dirname, 'style.css');

const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

/* ── 工具函数 ── */
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function relativeRoot(urlPath) {
  const depth = urlPath.split('/').length - 1;
  return depth <= 0 ? '' : '../'.repeat(depth);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── 立绘画廊 ── */
const IMG_EXTS = /\.(png|jpg|jpeg|webp)$/i;

function copyImgIfMissing(src, dest) {
  if (!fs.existsSync(dest)) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

/** 将路径各段分别 encodeURIComponent，再用 / 拼接 */
function encodeUrlPath(...segments) {
  return segments.map(s => encodeURIComponent(s)).join('/');
}

function imgTag(url, label, cls = '') {
  const alt = escapeHtml(label);
  return `<img src="${url}" alt="${alt}" loading="lazy" class="lb-trigger${cls ? ' ' + cls : ''}" data-src="${url}">`;
}

/**
 * 为角色/npc 词条生成画廊 HTML，并把图片 copy 到 dist。
 * 命名规则：
 *   {角色名}_*.ext          → 主立绘
 *   衣着_{时装名}.ext        → 时装场景图
 *   衣着_{时装名}_L2D.ext    → 时装站绘
 *   {时装名}_{单品名}.ext    → 时装单品（时装名从衣着_*中自动发现）
 *   初始_{单品名}.ext        → 初始单品
 *   其他                    → 附图
 */
function buildCharGallery(file, root) {
  const type = file.meta?.type;
  if (type !== 'character' && type !== 'npc') return '';

  const parts = file.slug.split('/');
  if (parts[0] !== '角色' || parts.length < 3) return '';
  const org = parts[1];
  const charName = parts[2];

  const srcDir = path.join(RAW_DIR, '立绘', org, charName);
  if (!fs.existsSync(srcDir)) return '';

  const imgFiles = fs.readdirSync(srcDir)
    .filter(f => IMG_EXTS.test(f))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (!imgFiles.length) return '';

  // 复制到 dist
  const distDir = path.join(DIST_DIR, 'assets', '立绘', org, charName);
  for (const f of imgFiles) copyImgIfMissing(path.join(srcDir, f), path.join(distDir, f));

  // 构造 URL 前缀（相对于当前页面的根）
  const urlBase = `${root}assets/${encodeUrlPath('立绘', org, charName)}/`;

  // ── 分类 ──────────────────────────────────────────────────────────
  const portraits   = [];                // {url, label}
  const costumeArts = {};                // name → {scene?, L2D?}
  const costumeItems = {};               // name → [{url, label}]
  const initialItems = [];
  const misc        = [];

  // 先收集时装名，供后续匹配单品用
  const costumeNames = new Set();
  for (const f of imgFiles) {
    const stem = f.replace(IMG_EXTS, '');
    if (stem.startsWith('衣着_')) {
      const rest = stem.slice(3);
      costumeNames.add(rest.endsWith('_L2D') ? rest.slice(0, -4) : rest);
    }
  }

  for (const f of imgFiles) {
    const stem  = f.replace(IMG_EXTS, '');
    const url   = urlBase + encodeURIComponent(f);

    if (stem === charName || stem.startsWith(charName + '_')) {
      const label = stem.replace(charName + '_', '') || charName;
      // 尤提姆作为行内注入，不进入立绘行
      if (label !== '尤提姆') portraits.push({ url, label });

    } else if (stem.startsWith('衣着_')) {
      const rest = stem.slice(3);
      const isL2D = rest.endsWith('_L2D');
      const name  = isL2D ? rest.slice(0, -4) : rest;
      if (!costumeArts[name]) costumeArts[name] = {};
      costumeArts[name][isL2D ? 'L2D' : 'scene'] = { url, label: name };

    } else if (stem.startsWith('初始_')) {
      initialItems.push({ url, label: stem.slice(3) });

    } else {
      const sep = stem.indexOf('_');
      const prefix = sep > 0 ? stem.slice(0, sep) : '';
      if (prefix && costumeNames.has(prefix)) {
        if (!costumeItems[prefix]) costumeItems[prefix] = [];
        costumeItems[prefix].push({ url, label: stem.slice(sep + 1) });
      } else {
        misc.push({ url, label: stem });
      }
    }
  }

  // ── 构建 HTML ─────────────────────────────────────────────────────
  const fig = (url, label, figCls, imgCls) =>
    `<figure class="${figCls}">${imgTag(url, label, imgCls)}<figcaption>${escapeHtml(label)}</figcaption></figure>`;

  const allCostumes = [...new Set([...Object.keys(costumeArts), ...Object.keys(costumeItems)])].sort();
  // 有立绘（场景图/L2D）的时装
  const costumePortraitList = allCostumes.filter(n => costumeArts[n]?.scene || costumeArts[n]?.L2D);

  // ── 辅助：生成独立页卡组（每组独立作用域）────────────────────────
  const makeTabGroup = (labels, panels) => {
    let h = '<div class="gallery-tab-group">';
    h += '<div class="gallery-tabs" role="tablist">';
    labels.forEach((l, i) =>
      h += `<button class="gallery-tab${i === 0 ? ' active' : ''}" role="tab">${escapeHtml(l)}</button>`
    );
    h += '</div>';
    panels.forEach((c, i) =>
      h += `<div class="gallery-panel${i === 0 ? ' active' : ''}">${c}</div>`
    );
    h += '</div>';
    return h;
  };

  let html = '<div class="char-gallery">';

  // ── 立绘部分 ──────────────────────────────────────────────────────
  if (costumePortraitList.length > 0) {
    // 有时装立绘：页卡
    const portraitPanelHtml = (() => {
      let p = '';
      if (portraits.length) {
        p += '<div class="gallery-section"><div class="portraits-row">';
        for (const x of portraits) p += fig(x.url, x.label, 'portrait-fig', '');
        p += '</div></div>';
      }
      if (misc.length) {
        p += '<div class="gallery-section"><div class="gallery-label">附图</div><div class="portraits-row">';
        for (const m of misc) p += fig(m.url, m.label, 'portrait-fig', '');
        p += '</div></div>';
      }
      return p;
    })();
    const costumePanels = costumePortraitList.map(name => {
      const arts = costumeArts[name] || {};
      return '<div class="gallery-section costume-section"><div class="costume-layout"><div class="costume-arts">'
        + (arts.scene ? fig(arts.scene.url, '场景图', 'costume-art-fig scene-fig', '') : '')
        + (arts.L2D   ? fig(arts.L2D.url,   '立绘',   'portrait-fig', '') : '')
        + '</div></div></div>';
    });
    html += makeTabGroup(['立绘', ...costumePortraitList], [portraitPanelHtml, ...costumePanels]);
  } else {
    // 无时装：平铺
    if (portraits.length) {
      html += '<div class="gallery-section"><div class="gallery-label">立绘</div><div class="portraits-row">';
      for (const p of portraits) html += fig(p.url, p.label, 'portrait-fig', '');
      html += '</div></div>';
    }
    if (misc.length) {
      html += '<div class="gallery-section"><div class="gallery-label">附图</div><div class="portraits-row">';
      for (const m of misc) html += fig(m.url, m.label, 'portrait-fig', '');
      html += '</div></div>';
    }
  }

  html += '</div>'; // .char-gallery
  // 单品由 injectItemsTabs() 在文章渲染后处理，画廊仅展示立绘
  return html;
}

/**
 * 若存在洞悉立绘，生成压缩 WebP 水印（用 sharp），并返回水印 div HTML。
 * 水印 div 作为 {{watermark}} 注入 .content 层（article 的兄弟元素）。
 */
async function buildCharWatermark(file, root) {
  const type = file.meta?.type;
  if (type !== 'character' && type !== 'npc') return '';
  const parts = file.slug.split('/');
  if (parts[0] !== '角色' || parts.length < 3) return '';
  const org = parts[1], charName = parts[2];
  const srcDir = path.join(RAW_DIR, '立绘', org, charName);
  if (!fs.existsSync(srcDir)) return '';

  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const srcFilename = `${charName}_洞悉${ext}`;
    const src = path.join(srcDir, srcFilename);
    if (!fs.existsSync(src)) continue;

    const destDir = path.join(DIST_DIR, 'assets', '立绘', org, charName);
    ensureDir(destDir);

    // 生成压缩水印 WebP（1000px 宽，quality 75）；已存在则跳过
    const wmFilename = `${charName}_洞悉_wm.webp`;
    const wmDest = path.join(destDir, wmFilename);
    if (!fs.existsSync(wmDest)) {
      if (sharp) {
        await sharp(src)
          .resize({ width: 1000, withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(wmDest);
      } else {
        // fallback：直接复制原图
        fs.copyFileSync(src, wmDest);
      }
    }

    // 同时确保原图也复制到 dist（画廊等仍需要）
    copyImgIfMissing(src, path.join(destDir, srcFilename));

    const url = `${root}assets/${encodeUrlPath('立绘', org, charName)}/${encodeURIComponent(wmFilename)}`;
    return `<div class="char-watermark" aria-hidden="true"><img src="${url}" alt="" loading="lazy"></div>`;
  }
  return '';
}

/**
 * 构建"标签 → 图片URL"映射，用于行内注入：
 *   {charName}_尤提姆.png   → '尤提姆'
 *   初始_{单品名}.png       → '{单品名}'
 *   {时装名}_{单品名}.png   → '{单品名}'
 */
function buildInlineImgMap(file, root) {
  const type = file.meta?.type;
  if (type !== 'character' && type !== 'npc') return new Map();

  const parts = file.slug.split('/');
  if (parts[0] !== '角色' || parts.length < 3) return new Map();
  const org = parts[1];
  const charName = parts[2];

  const srcDir = path.join(RAW_DIR, '立绘', org, charName);
  if (!fs.existsSync(srcDir)) return new Map();

  const imgFiles = fs.readdirSync(srcDir).filter(f => IMG_EXTS.test(f));
  if (!imgFiles.length) return new Map();

  const distDir = path.join(DIST_DIR, 'assets', '立绘', org, charName);
  for (const f of imgFiles) copyImgIfMissing(path.join(srcDir, f), path.join(distDir, f));

  const urlBase = `${root}assets/${encodeUrlPath('立绘', org, charName)}/`;

  // 先收集时装名
  const costumeNames = new Set();
  for (const f of imgFiles) {
    const stem = f.replace(IMG_EXTS, '');
    if (stem.startsWith('衣着_')) {
      const rest = stem.slice(3);
      costumeNames.add(rest.endsWith('_L2D') ? rest.slice(0, -4) : rest);
    }
  }

  const map = new Map();
  for (const f of imgFiles) {
    const stem = f.replace(IMG_EXTS, '');
    const url  = urlBase + encodeURIComponent(f);

    if (stem.startsWith(charName + '_')) {
      const label = stem.slice(charName.length + 1);
      if (label === '尤提姆') map.set('尤提姆', url);
      // 其他立绘变体（初始/洞悉/基础）不做行内注入

    } else if (stem.startsWith('初始_')) {
      map.set(stem.slice(3), url);

    } else if (!stem.startsWith('衣着_')) {
      const sep = stem.indexOf('_');
      const prefix = sep > 0 ? stem.slice(0, sep) : '';
      if (prefix && costumeNames.has(prefix)) {
        map.set(stem.slice(sep + 1), url);
      }
    }
  }
  return map;
}

/**
 * 在渲染好的 HTML 中，把 <strong>LABEL</strong>（位于 li 或 p 内）
 * 的左侧注入单品小图，使用 float:left 浮动排版。
 * 也支持 startsWith 匹配（如 "尤提姆 Udimo" 匹配 label="尤提姆"）。
 */
function injectInlineImages(html, inlineMap) {
  if (!inlineMap.size) return html;

  for (const [label, url] of inlineMap) {
    const alt = escapeHtml(label);
    const imgHtml = `<img class="item-inline-img lb-trigger" src="${url}" alt="${alt}" loading="lazy" data-src="${url}">`;
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 匹配 <strong>{label}…</strong>（精确开头），在其前面插入图片
    // 只注入一次（第一次出现），避免重复
    const re = new RegExp(`(<strong>)(${esc}[^<]*</strong>)`);
    if (re.test(html)) {
      html = html.replace(re, `${imgHtml}$1$2`);
    }
  }
  return html;
}

/**
 * 对渲染后的文章 HTML，找到"单品 / 随身物件"段落的 <ul>，
 * 按时装（初始 / 时装A / …）拆分成 gallery-tab-group。
 * 多组时才生成页卡；只有一组则保持原样。
 */
function injectItemsTabs(html, inlineMap) {
  if (!inlineMap || inlineMap.size === 0) return html;

  // 从 inlineMap 推断每个 label 所属时装
  const labelCostume = new Map();
  for (const [label, url] of inlineMap) {
    const fname = decodeURIComponent(url.split('/').pop()).replace(/\.(png|jpg|jpeg|webp)$/i, '');
    if (fname.startsWith('初始_')) {
      labelCostume.set(label, '初始');
    } else {
      const sep = fname.indexOf('_');
      labelCostume.set(label, sep > 0 ? fname.slice(0, sep) : '初始');
    }
  }

  // 找"单品"标题（h2）后的第一个 <ul>
  const h2Re = /<h2[^>]*>[\s\S]*?单品[\s\S]*?<\/h2>/;
  const h2Match = html.match(h2Re);
  if (!h2Match) return html;

  const h2End = html.indexOf(h2Match[0]) + h2Match[0].length;
  const ulStart = html.indexOf('<ul>', h2End);
  if (ulStart === -1) return html;
  const ulEnd   = html.indexOf('</ul>', ulStart) + 5;
  const ulInner = html.slice(ulStart + 4, ulEnd - 5);

  // 提取 <li> 并按时装分组
  const groups = new Map(); // costume → li html[]
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(ulInner)) !== null) {
    const liContent = m[1];
    const altM = liContent.match(/item-inline-img[^>]+?alt="([^"]+)"/);
    const label   = altM ? altM[1] : null;
    const costume = label ? (labelCostume.get(label) || '初始') : '初始';
    if (!groups.has(costume)) groups.set(costume, []);
    groups.get(costume).push(m[0]);
  }

  if (groups.size <= 1) return html; // 只有一组，不需要页卡

  // 过滤掉非单品组（如尤提姆用角色名做前缀；其不会出现在单品 ul，但保险起见）
  // 只保留 '初始' 和实际时装名
  const validCostumes = [...groups.keys()];

  // 构建 gallery-tab-group HTML
  let tabHtml = '<div class="gallery-tab-group">';
  tabHtml += '<div class="gallery-tabs" role="tablist">';
  validCostumes.forEach((c, i) =>
    tabHtml += `<button class="gallery-tab${i === 0 ? ' active' : ''}" role="tab">${escapeHtml(c)}</button>`
  );
  tabHtml += '</div>';
  validCostumes.forEach((c, i) => {
    tabHtml += `<div class="gallery-panel${i === 0 ? ' active' : ''}"><ul>`;
    tabHtml += groups.get(c).join('');
    tabHtml += '</ul></div>';
  });
  tabHtml += '</div>';

  return html.slice(0, ulStart) + tabHtml + html.slice(ulEnd);
}

/**
 * 为非角色页面收集剧情图（raw/剧情图/{pageName}/），
 * 返回 stem→url 映射，供 injectStoryImages 使用。
 */
function buildStoryImgMap(file, root) {
  const type = file.meta?.type;
  if (type === 'character' || type === 'npc') return new Map();

  const pageName = file.slug.split('/').pop();
  const srcDir = path.join(RAW_DIR, '剧情图', pageName);
  if (!fs.existsSync(srcDir)) return new Map();

  const imgFiles = fs.readdirSync(srcDir).filter(f => IMG_EXTS.test(f));
  if (!imgFiles.length) return new Map();

  const distDir = path.join(DIST_DIR, 'assets', '剧情图', pageName);
  for (const f of imgFiles) copyImgIfMissing(path.join(srcDir, f), path.join(distDir, f));

  const urlBase = `${root}assets/${encodeUrlPath('剧情图', pageName)}/`;
  const map = new Map();
  for (const f of imgFiles) {
    const stem = f.replace(IMG_EXTS, '');
    map.set(stem, urlBase + encodeURIComponent(f));
  }
  return map;
}

/**
 * 在渲染后的文章 HTML 中注入剧情图：
 *   1. 找到与 storyImgMap 键名匹配的 <h3> 标题，在其后注入 float-left 小图。
 *      匹配规则：h3 纯文本以 stem 开头（忽略副标题、【】标注）。
 *   2. 把 {{storyimg:name}} 或 <p>{{storyimg:name}}</p> 占位符替换为居中大图。
 */
function injectStoryImages(html, storyImgMap) {
  if (!storyImgMap || storyImgMap.size === 0) return html;

  // 1. h3 自动注入 float-left 图（在 </h3> 后插入）
  html = html.replace(/(<h3[^>]*>)([\s\S]*?)(<\/h3>)/g, (match, open, inner, close) => {
    const plain = inner.replace(/<[^>]+>/g, '').trim();
    for (const [stem, url] of storyImgMap) {
      if (plain.startsWith(stem)) {
        const fig = `<figure class="story-img-float">`
          + `<img src="${url}" alt="${escapeHtml(stem)}" loading="lazy" class="lb-trigger" data-src="${url}">`
          + `</figure>`;
        return match + fig;
      }
    }
    return match;
  });

  // 2. {{storyimg:name}} 占位符 → 居中展示图
  const placeholder = (name) => {
    const url = storyImgMap.get(name.trim());
    if (!url) return '';
    return `<figure class="story-img-block">`
      + `<img src="${url}" alt="${escapeHtml(name.trim())}" loading="lazy" class="lb-trigger" data-src="${url}">`
      + `</figure>`;
  };
  html = html.replace(/<p>\{\{storyimg:([^}]+)\}\}<\/p>/g, (_, name) => placeholder(name));
  html = html.replace(/\{\{storyimg:([^}]+)\}\}/g, (_, name) => placeholder(name));

  return html;
}

/* ── 扫描所有 wiki 文件 ── */
function scanWiki(dir, base = '') {
  const entries = [];
  for (const name of fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      entries.push(...scanWiki(full, rel));
    } else if (name.endsWith('.md')) {
      const slug = rel.slice(0, -3); // 去掉 .md
      entries.push({
        rel,
        slug,
        url: slug + '.html',
        dir: base,
        name: name.slice(0, -3),
        full,
      });
    }
  }
  return entries;
}

const files = scanWiki(WIKI_DIR);

// wiki 的 index.md 输出到 contents.html，
// index.html 留给报纸页（根 URL 默认页）
const indexFile = files.find(f => f.slug === 'index');
if (indexFile) indexFile.url = 'contents.html';

const slugSet = new Set(files.map(f => f.slug));

/* ── 构建导航树（支持两级子分组） ── */
function buildNav(currentUrl) {
  // 按目录层级分组：topKey → { files: [], subgroups: { subKey → [files] } }
  const topGroups = {};

  for (const f of files) {
    const parts = f.dir ? f.dir.split('/') : [];
    const top = parts[0] || 'index';
    if (!topGroups[top]) topGroups[top] = { files: [], subgroups: {} };

    if (parts.length <= 1) {
      // 直接位于顶级目录或根目录
      topGroups[top].files.push(f);
    } else {
      // 位于二级子目录
      const sub = parts[1];
      if (!topGroups[top].subgroups[sub]) topGroups[top].subgroups[sub] = [];
      topGroups[top].subgroups[sub].push(f);
    }
  }

  // 定义顶级分组顺序
  const topOrder = ['index', '角色', '世界观', '地点', '组织', '主题', '剧情概要', '轶事'];
  const sortedTopKeys = Object.keys(topGroups).sort((a, b) => {
    const ia = topOrder.indexOf(a);
    const ib = topOrder.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  let html = '';
  for (const top of sortedTopKeys) {
    const { files: topFiles, subgroups } = topGroups[top];
    const isIndex = top === 'index';
    const label = isIndex ? '首页 & 索引' : top;

    // 判断当前页是否在此组（报纸页归入首页组）
    const allGroupFiles = [...topFiles, ...Object.values(subgroups).flat()];
    const isCurrentGroup = allGroupFiles.some(f => f.url === currentUrl)
      || (isIndex && (currentUrl === 'newspaper.html' || currentUrl === 'index.html'));

    html += `<div class="nav-group${isCurrentGroup ? ' current' : ' collapsed'}">`;
    html += `<div class="nav-group-title" onclick="this.parentElement.classList.toggle('collapsed')"><span class="arrow">▾</span>${escapeHtml(label)}</div>`;
    html += '<ul class="nav-list">';

    // 首页分组：加入报纸页链接
    if (isIndex) {
      const npActive = currentUrl === 'newspaper.html' ? ' active' : '';
      html += `<li><a href="${relativeRoot(currentUrl)}newspaper.html" class="${npActive}">今日报纸</a></li>`;
    }

    // 顶级文件（直接在此目录下，无子目录）
    for (const f of topFiles) {
      const active = f.url === currentUrl ? ' active' : '';
      const title = f.meta?.title || f.name;
      html += `<li><a href="${relativeRoot(currentUrl)}${f.url}" class="${active}">${escapeHtml(title)}</a></li>`;
    }

    // 二级子分组
    const sortedSubKeys = Object.keys(subgroups).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    for (const sub of sortedSubKeys) {
      const subFiles = subgroups[sub];
      const subHasCurrent = subFiles.some(f => f.url === currentUrl);

      html += `<li class="nav-subgroup${subHasCurrent ? ' open' : ''}">`;
      html += `<div class="nav-subgroup-title" onclick="this.parentElement.classList.toggle('open')"><span class="subarrow">▶</span>${escapeHtml(sub)}</div>`;
      html += '<ul class="nav-sublist">';
      for (const f of subFiles) {
        const active = f.url === currentUrl ? ' active' : '';
        const title = f.meta?.title || f.name;
        html += `<li><a href="${relativeRoot(currentUrl)}${f.url}" class="${active}">${escapeHtml(title)}</a></li>`;
      }
      html += '</ul></li>';
    }

    html += '</ul></div>';
  }
  return html;
}

/* ── 面包屑 ── */
function buildBreadcrumbs(slug, root) {
  if (slug === 'index') return '';
  const parts = slug.split('/');
  let html = `<div class="breadcrumbs"><a href="${root}index.html">首页</a>`;
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    if (isLast) {
      html += `<span>/</span>${escapeHtml(parts[i])}`;
    } else if (slugSet.has(acc)) {
      html += `<span>/</span><a href="${root}${acc}.html">${escapeHtml(parts[i])}</a>`;
    } else {
      html += `<span>/</span>${escapeHtml(parts[i])}`;
    }
  }
  html += '</div>';
  return html;
}

/* ── Frontmatter 信息条 ── */
function buildMetaBar(meta) {
  if (!meta) return '';
  const tags = [];
  if (meta.type) tags.push(`<span class="label">类型</span>${escapeHtml(meta.type)}`);
  if (meta.aliases && meta.aliases.length) {
    tags.push(`<span class="label">别名</span>${escapeHtml(meta.aliases.join(' / '))}`);
  }
  if (meta.updated) tags.push(`<span class="label">更新</span>${escapeHtml(meta.updated)}`);
  if (!tags.length) return '';
  return `<div class="meta-bar">${tags.map(t => `<span class="meta-tag">${t}</span>`).join('')}</div>`;
}

/* ── Wiki Link 转换 ── */
function processWikiLinks(mdText, currentSlug) {
  return mdText.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, target, display) => {
    const t = target.trim();
    const d = display ? display.trim() : path.basename(t);
    // 检查页面是否存在（精确匹配或加当前目录前缀）
    let resolved = t;
    if (!slugSet.has(t) && currentSlug.includes('/')) {
      const tryRel = path.dirname(currentSlug).replace(/\\/g, '/') + '/' + t;
      if (slugSet.has(tryRel)) resolved = tryRel;
    }
    const exists = slugSet.has(resolved);
    const href = relativeRoot(currentSlug + '.html') + resolved + '.html';
    const cls = exists ? 'wiki-link' : 'wiki-link missing';
    const style = exists ? '' : ' style="color:var(--text-dim);text-decoration:line-through;"';
    return `<a href="${href}" class="${cls}"${style}>${escapeHtml(d)}</a>`;
  });
}

/* ── 提取纯文本摘要 ── */
function extractSummary(file, maxLen = 220) {
  const raw = fs.readFileSync(file.full, 'utf-8');
  const parsed = matter(raw);
  let text = parsed.content
    .replace(/^#+ .+\n?/gm, '')          // 去掉标题
    .replace(/\[\[[^\]]+\]\]/g, '')      // 去掉 wiki link
    .replace(/!\[.*?\]\(.*?\)/g, '')     // 去掉图片
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 保留链接文字
    .replace(/[*_~`>#\-|]/g, '')         // 去掉 markdown 符号
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLen) + (text.length > maxLen ? '…' : '');
}

/**
 * 获取词条代表图 URL（相对于 dist 根目录，用于报纸首页）。
 * 优先级：{角色名}_初始 → 洞悉 → 基础
 * 非角色词条返回 null。
 */
function getRepresentativeImage(file) {
  const type = file.meta?.type;
  if (type !== 'character' && type !== 'npc') return null;
  const parts = file.slug.split('/');
  if (parts[0] !== '角色' || parts.length < 3) return null;
  const org = parts[1], charName = parts[2];
  const srcDir = path.join(RAW_DIR, '立绘', org, charName);
  if (!fs.existsSync(srcDir)) return null;
  for (const stem of ['初始', '洞悉', '基础']) {
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      const f = `${charName}_${stem}${ext}`;
      const src = path.join(srcDir, f);
      if (fs.existsSync(src)) {
        const destDir = path.join(DIST_DIR, 'assets', '立绘', org, charName);
        copyImgIfMissing(src, path.join(destDir, f));
        return `assets/${encodeUrlPath('立绘', org, charName)}/${encodeURIComponent(f)}`;
      }
    }
  }
  return null;
}

/* ── 生成报纸首页 ── */
function generateNewspaperHome(files) {
  const candidates = files.filter(f => f.slug !== 'index' && f.meta?.title);

  // 为所有候选词条预计算代表图
  const imgMap = new Map();
  for (const f of candidates) {
    const img = getRepresentativeImage(f);
    if (img) imgMap.set(f.slug, img);
  }

  // 打乱后：有图的优先进入头条位置
  const shuffled = [...candidates].sort(() => 0.5 - Math.random());
  const withImg  = shuffled.filter(f =>  imgMap.has(f.slug));
  const noImg    = shuffled.filter(f => !imgMap.has(f.slug));
  const pool = [...withImg, ...noImg];
  if (pool.length < 3) return '';

  const selected = pool.slice(0, 7);
  const [headline, ...stories] = selected;

  const dateStr  = '<span id="newspaperDate"></span>';
  const issueNum = Math.floor(Math.random() * 900) + 100;

  // ── 辅助：渲染一张故事卡 ──────────────────────────────────────────
  const card = (f, summaryLen = 150) => {
    const img = imgMap.get(f.slug);
    const imgBlock = img
      ? `<div class="np-card-img-wrap"><img class="np-card-img lb-trigger" src="${img}" data-src="${img}" alt="${escapeHtml(f.meta.title)}" loading="lazy"></div>`
      : '';
    return `<article class="np-story${img ? ' has-img' : ''}">
  ${imgBlock}<div class="np-story-body"><h3><a href="${f.url}">${escapeHtml(f.meta.title)}</a></h3>
  <p>${escapeHtml(extractSummary(f, summaryLen))}</p>
  <a href="${f.url}" class="read-more">阅读全文 →</a>
  </div></article>`;
  };

  let html = `<div class="newspaper">`;

  // ── 报头 ─────────────────────────────────────────────────────────
  html += `<header class="masthead">
  <h1>THE REVERSE: 1999 CHRONICLE</h1>
  <div class="masthead-sub">重返未来：1999 剧情 Wiki</div>
  <div class="masthead-meta">
    <span>第 ${issueNum} 期</span>
    <span>${dateStr}</span>
    <span>售价 1 利齿子儿</span>
  </div>
</header>`;

  // ── 头条 ─────────────────────────────────────────────────────────
  const hlImg = imgMap.get(headline.slug);
  const hlImgBlock = hlImg
    ? `<div class="np-hl-img-wrap"><img class="np-hl-img lb-trigger" src="${hlImg}" data-src="${hlImg}" alt="${escapeHtml(headline.meta.title)}" loading="lazy"></div>`
    : '';

  html += `<div class="np-headline${hlImg ? ' has-img' : ''}">
  <div class="np-hl-main">
    ${hlImgBlock}
    <div class="np-hl-text">
      <div class="np-kicker">头条</div>
      <h2><a href="${headline.url}">${escapeHtml(headline.meta.title)}</a></h2>
      <p>${escapeHtml(extractSummary(headline, 340))}</p>
      <a href="${headline.url}" class="read-more">阅读全文 →</a>
    </div>
  </div>
</div>`;

  // ── 今日要闻分割线 ────────────────────────────────────────────────
  html += `<div class="np-section-rule"><span>今日要闻</span></div>`;

  // ── 上排：前3篇（1篇跨2列 + 1篇） ────────────────────────────────
  const topStories = stories.slice(0, 3);
  html += `<div class="np-grid np-grid-top">`;
  for (const s of topStories) html += card(s, 180);
  html += `</div>`;

  // ── 下排：剩余篇（4列，更紧凑） ──────────────────────────────────
  const botStories = stories.slice(3);
  if (botStories.length) {
    html += `<div class="np-grid np-grid-bot">`;
    for (const s of botStories) html += card(s, 110);
    html += `</div>`;
  }

  // ── 底栏（今日简讯嵌入右侧）──────────────────────────────────────
  html += `<footer class="newspaper-footer">
  <div class="newspaper-footer-text">本页内容每次访问随机生成 · <a href="index.html" onclick="location.reload();return false;">刷新换一批</a></div>
  <aside class="np-brief-box">
    <div class="np-brief-title">今日简讯</div>
    <p class="np-brief-text">本站共收录 <strong>${files.length}</strong> 篇词条，涵盖角色、剧情、世界观等内容。</p>
    <p class="np-brief-text">所有资料均来自游戏原作，仅供创作参考。</p>
    <hr>
    <p class="np-brief-text">点击任意图片可放大查看。</p>
  </aside>
</footer>`;

  // ── 每日模板选择脚本（基于日期，0/1/2 循环）────────────────────
  html += `<script>
(function(){
  var d = new Date();
  var seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  var tmpl = seed % 3;
  var el = document.querySelector('.newspaper');
  if (el) el.dataset.tmpl = tmpl;
})();
</script>`;

  html += `</div>`;
  return html;
}

/* ── 构建主流程（async，因 buildCharWatermark 用了 sharp） ── */
async function buildAll() {
  const searchDocs = [];

  for (const file of files) {
    const raw = fs.readFileSync(file.full, 'utf-8');
    const parsed = matter(raw);
    file.meta = parsed.data;

    // Wiki Link → HTML 链接
    let mdBody = processWikiLinks(parsed.content, file.slug);

    // 组装页面
    const root = relativeRoot(file.url);

    let contentHtml = marked.parse(mdBody);

    // 给 heading 添加 anchor id（基于纯文本内容）
    contentHtml = contentHtml.replace(/<h([1-6])>(.+?)<\/h\1>/g, (match, level, inner) => {
      const plain = inner.replace(/<[^>]+>/g, '');
      const id = plain.toLowerCase().replace(/[^\w一-龥]+/g, '-').replace(/^-|-$/g, '');
      const safeId = id || 'heading-' + Math.random().toString(36).slice(2, 7);
      return `<h${level} id="${safeId}">${inner}</h${level}>`;
    });

    // 行内单品 / 尤提姆图片注入
    const inlineMap = buildInlineImgMap(file, root);
    contentHtml = injectInlineImages(contentHtml, inlineMap);
    // 单品段落按时装分组为页卡（多组时启用）
    contentHtml = injectItemsTabs(contentHtml, inlineMap);

    const title = parsed.data.title || (file.slug === 'index' ? '首页' : file.name);
    const navHtml = buildNav(file.url);
    const breadcrumbs = buildBreadcrumbs(file.slug, root);
    const metaBar = buildMetaBar(parsed.data);
    const gallery      = buildCharGallery(file, root);
    const storyImgMap  = buildStoryImgMap(file, root);
    // watermark 现在是 {{watermark}} 独立槽位（.content 层兄弟元素）
    const watermark = await buildCharWatermark(file, root);

    // 剧情图行内注入（h3 自动 float-left + {{storyimg:}} 占位符）
    contentHtml = injectStoryImages(contentHtml, storyImgMap);

    let page = template
      .replace(/\{\{title\}\}/g, escapeHtml(title))
      .replace(/\{\{root\}\}/g, root)
      .replace(/\{\{nav\}\}/g, navHtml)
      .replace(/\{\{breadcrumbs\}\}/g, breadcrumbs)
      .replace(/\{\{watermark\}\}/g, watermark)
      .replace(/\{\{content\}\}/g, metaBar + gallery + contentHtml);

    // 写入
    const outPath = path.join(DIST_DIR, file.url);
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, page, 'utf-8');

    // 收集搜索数据
    const plainText = contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    searchDocs.push({
      title,
      url: file.url,
      text: plainText.slice(0, 3000), // 限制长度
    });
  }

  /* ── 生成报纸首页（独立页面） ── */
  const newspaperHtml = generateNewspaperHome(files);
  const newspaperPage = template
    .replace(/\{\{title\}\}/g, '今日报纸')
    .replace(/\{\{root\}\}/g, '')
    .replace(/\{\{nav\}\}/g, buildNav('newspaper.html'))
    .replace(/\{\{breadcrumbs\}\}/g, '')
    .replace(/\{\{watermark\}\}/g, '')
    .replace(/\{\{content\}\}/g, newspaperHtml);
  fs.writeFileSync(path.join(DIST_DIR, 'newspaper.html'), newspaperPage, 'utf-8');
  // 同时写入根目录默认页，让 https://1999.fivood.com/ 直接显示报纸
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), newspaperPage, 'utf-8');

  /* ── 写入搜索索引 & 复制静态资源 ── */
  fs.writeFileSync(path.join(DIST_DIR, 'search.json'), JSON.stringify(searchDocs), 'utf-8');
  fs.copyFileSync(CSS_PATH, path.join(DIST_DIR, 'style.css'));

  console.log(`✅ 构建完成：${files.length} 个页面 → ${DIST_DIR}`);
  console.log(`   搜索索引：${searchDocs.length} 条`);
}

buildAll().catch(err => { console.error('❌ 构建出错：', err); process.exit(1); });
