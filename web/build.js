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
const PIXEL_CSS_PATH = path.join(__dirname, 'pixel.css');

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
  let   signature   = null;              // {url, label} —— {charName}_签名 收藏图

  // 先收集时装名，供后续匹配单品用
  // 命名规范：衣着_{名}_立绘.png + 衣着_{名}_L2D.png（双文件）；旧式 衣着_{名}.png 兼容
  const stripCostumeSuffix = (s) =>
    s.endsWith('_L2D') ? s.slice(0, -4) :
    s.endsWith('_立绘') ? s.slice(0, -3) : s;
  const costumeNames = new Set();
  for (const f of imgFiles) {
    const stem = f.replace(IMG_EXTS, '');
    if (stem.startsWith('衣着_')) {
      costumeNames.add(stripCostumeSuffix(stem.slice(3)));
    }
  }

  for (const f of imgFiles) {
    const stem  = f.replace(IMG_EXTS, '');
    const url   = urlBase + encodeURIComponent(f);

    if (stem === charName || stem.startsWith(charName + '_')) {
      const label = stem.replace(charName + '_', '') || charName;
      // 尤提姆作为行内注入，不进入立绘行
      if (label === '尤提姆') continue;
      // 签名为独立的收藏图，单独成区
      if (label === '签名') { signature = { url, label: charName }; continue; }
      portraits.push({ url, label });

    } else if (stem.startsWith('衣着_')) {
      const rest = stem.slice(3);
      const isL2D = rest.endsWith('_L2D');
      const isLi  = rest.endsWith('_立绘');
      const name  = stripCostumeSuffix(rest);
      if (!costumeArts[name]) costumeArts[name] = {};
      // _L2D → L2D；_立绘 或 无后缀 → portrait（立绘版本）
      costumeArts[name][isL2D ? 'L2D' : 'portrait'] = { url, label: name };

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
  // 有立绘（立绘版/L2D版）的时装
  const costumePortraitList = allCostumes.filter(n => costumeArts[n]?.portrait || costumeArts[n]?.L2D);

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
        + (arts.portrait ? fig(arts.portrait.url, '立绘', 'portrait-fig',          '') : '')
        + (arts.L2D      ? fig(arts.L2D.url,      'L2D',  'costume-art-fig L2D-fig', '') : '')
        + '</div></div></div>';
    });
    // 有签名图则附加一个"签名"页卡
    const tabLabels = ['立绘', ...costumePortraitList];
    const tabPanels = [portraitPanelHtml, ...costumePanels];
    if (signature) {
      tabLabels.push('签名');
      tabPanels.push(
        '<div class="gallery-section signature-section">'
        + `<figure class="signature-fig">${imgTag(signature.url, signature.label + '_签名', '')}</figure>`
        + '</div>'
      );
    }
    html += makeTabGroup(tabLabels, tabPanels);
  } else {
    // 无时装：若有签名，把 立绘 + 签名 也做成 tab 以保持一致；否则平铺
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
    if (signature) {
      const signaturePanelHtml = '<div class="gallery-section signature-section">'
        + `<figure class="signature-fig">${imgTag(signature.url, signature.label + '_签名', '')}</figure>`
        + '</div>';
      html += makeTabGroup(['立绘', '签名'], [portraitPanelHtml, signaturePanelHtml]);
    } else {
      html += portraitPanelHtml;
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

  // 先收集时装名（支持 _L2D / _立绘 / 无后缀三种形式）
  const stripCostumeSuffix2 = (s) =>
    s.endsWith('_L2D') ? s.slice(0, -4) :
    s.endsWith('_立绘') ? s.slice(0, -3) : s;
  const costumeNames = new Set();
  for (const f of imgFiles) {
    const stem = f.replace(IMG_EXTS, '');
    if (stem.startsWith('衣着_')) {
      costumeNames.add(stripCostumeSuffix2(stem.slice(3)));
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
 * 解析 raw/角色/{charName}.md 的 # 单品 段，返回单品列表。
 * 每个单品块格式：第一行 = 中文名（可能带引号）；后续行 = 英文名/估值/描述。
 */
function loadRawItems(charName) {
  const rawPath = path.join(RAW_DIR, '角色', charName + '.md');
  if (!fs.existsSync(rawPath)) return null;
  const allLines = fs.readFileSync(rawPath, 'utf8').split(/\r?\n/);
  // 定位 # 单品 标题行
  let start = -1;
  for (let i = 0; i < allLines.length; i++) {
    if (/^#{1,6}\s*单品/.test(allLines[i])) { start = i + 1; break; }
  }
  if (start < 0) return null;
  // 截至下一个任意级别 heading 或 整行粗体标记（如 **文化**：）
  let end = allLines.length;
  for (let i = start; i < allLines.length; i++) {
    const ln = allLines[i].trim();
    if (/^#{1,6}\s/.test(allLines[i])) { end = i; break; }
    if (/^\*\*[^*]+\*\*[:：]?\s*$/.test(ln)) { end = i; break; }
  }
  const body = allLines.slice(start, end).join('\n')
    .replace(/^---+\s*$/gm, '')
    .trim();
  if (!body) return null;
  const blocks = body.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split('\n').map(s => s.trim()).filter(Boolean);
    const firstLine = lines[0] || '';
    const name = stripQuotes(firstLine);
    return { name, firstLine, lines, block };
  });
}

// 引号字符 class（ASCII / 中文 ""''/ 日文「」『』/ 德式 „‟）
const QUOTE_CHARS_ALL = /["'“”‘’„‟「」『』]/g;
// 只剥前后（用于宽容匹配）
function stripQuotes(s) {
  return s.replace(/^["'“”‘’„‟「」『』]+|["'“”‘’„‟「""’„‟「」『』]+$/g, '');
}
// 全剥（用于显示名，处理星锑 "X"Y、卡戎 "X" 等不规则用法）
function stripAllQuotes(s) {
  return s.replace(QUOTE_CHARS_ALL, '').trim();
}

/**
 * 把 raw 单品块渲染为 item-card HTML 片段。
 * 第一行 = 名称（h4）；第二行（若为纯英文/拼音）= meta；其余 = 段落正文。
 */
function renderItemCard(item, imgUrl) {
  // 显示名全剥引号；item.name（仅剥前后）保留用于匹配
  const escName = escapeHtml(stripAllQuotes(item.firstLine));
  const imgHtml = imgUrl
    ? `<img class="item-card-img lb-trigger" src="${imgUrl}" alt="${escName}" loading="lazy" data-src="${imgUrl}">`
    : '';
  const lines = item.lines.slice(); // 拷贝
  lines.shift(); // 移除第一行（名称）
  // 第二行若为纯英文（含空格、引号、连字符、数字），视为英文名 meta（保留）
  let meta = '';
  if (lines.length && /^[\s\w"‘-‟'\-.()&,!:;]+$/.test(lines[0])) {
    meta = `<p class="item-card-meta">${escapeHtml(lines.shift())}</p>`;
  }
  // 第三行若以 估值/信任 关键词开头，识别并丢弃（不显示）
  if (lines.length && /^(雨滴|利齿子儿|无估值|无信任|未估价|信任达到)/.test(lines[0])) {
    lines.shift();
  }
  const body = lines.map(l => `<p>${escapeHtml(l)}</p>`).join('');
  return `<div class="item-card">${imgHtml}<div class="item-card-body"><h4 class="item-card-name">${escName}</h4>${meta}${body}</div></div>`;
}

/**
 * 对渲染后的文章 HTML，找到"单品 / 随身物件"段落的 <ul>，
 * 按时装（初始 / 时装A / …）拆分成 gallery-tab-group。
 * 多组时才生成页卡；只有一组则保持原样。
 *
 * 若 rawItems 存在，直接用 raw 全文替换 wiki 单品段（单一信息源）。
 */
function injectItemsTabs(html, inlineMap, rawItems) {
  if (!inlineMap || inlineMap.size === 0) return html;

  // 从 inlineMap 推断每个 label 所属时装；key 双份：原 label + 剥引号 label
  const labelCostume = new Map();
  for (const [label, url] of inlineMap) {
    const fname = decodeURIComponent(url.split('/').pop()).replace(/\.(png|jpg|jpeg|webp)$/i, '');
    let costume;
    if (fname.startsWith('初始_')) {
      costume = '初始';
    } else {
      const sep = fname.indexOf('_');
      costume = sep > 0 ? fname.slice(0, sep) : '初始';
    }
    labelCostume.set(label, costume);
    const stripped = stripQuotes(label);
    if (stripped !== label) labelCostume.set(stripped, costume);
  }
  // inlineMap 也做去引号映射（用于 renderItemCard 取图）
  const stripInlineMap = new Map();
  for (const [k, v] of inlineMap) {
    stripInlineMap.set(k, v);
    const sk = stripQuotes(k);
    if (sk !== k) stripInlineMap.set(sk, v);
  }

  // 找"单品"标题（h2）后的第一个 <ul>
  const h2Re = /<h2[^>]*>[\s\S]*?单品[\s\S]*?<\/h2>/;
  const h2Match = html.match(h2Re);
  if (!h2Match) return html;
  const h2Start = html.indexOf(h2Match[0]);
  const h2End = h2Start + h2Match[0].length;

  // ── 优先路径：rawItems 存在时，完全替换 单品 段 ───────────────────
  if (rawItems && rawItems.length > 0) {
    // 找下一个 h2 或 文档末尾，作为 section 结尾
    const nextH2Re = /<h2[^>]*>/g;
    nextH2Re.lastIndex = h2End;
    const nextH2 = nextH2Re.exec(html);
    const sectionEnd = nextH2 ? nextH2.index : html.length;

    // 按时装归类 rawItems
    const groups = new Map(); // costume → items[]
    for (const item of rawItems) {
      const costume = labelCostume.get(item.name) || '初始';
      if (!groups.has(costume)) groups.set(costume, []);
      groups.get(costume).push(item);
    }
    // 排序：初始 优先，其余按字母
    const costumeOrder = [...groups.keys()].sort((a, b) =>
      a === '初始' ? -1 : b === '初始' ? 1 : a.localeCompare(b)
    );

    let tabHtml = '<div class="gallery-tab-group items-tab-group">';
    tabHtml += '<div class="gallery-tabs" role="tablist">';
    costumeOrder.forEach((c, i) =>
      tabHtml += `<button class="gallery-tab${i === 0 ? ' active' : ''}" role="tab">${escapeHtml(c)}</button>`
    );
    tabHtml += '</div>';
    costumeOrder.forEach((c, i) => {
      tabHtml += `<div class="gallery-panel${i === 0 ? ' active' : ''}"><div class="item-cards">`;
      for (const item of groups.get(c)) {
        tabHtml += renderItemCard(item, stripInlineMap.get(item.name));
      }
      tabHtml += '</div></div>';
    });
    tabHtml += '</div>';

    return html.slice(0, h2End) + tabHtml + html.slice(sectionEnd);
  }

  // ── 回退路径：原 ul-based 分组（rawItems 不可用时） ───────────────
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

/* ── 加粗修复 ──
 * marked 遵循 CommonMark 的 emphasis flanking 规则：** 作为定界符时，
 * 紧邻中文/全角标点（如 “”《》（）：）或紧邻已转成 HTML 的 [[链接]] 时，
 * 会因「左/右 flanking」判定失败而无法成对解析，导致 **加粗** 原样残留。
 * 这里在 marked.parse 之前，先把成对的 **…**（同一行内、内容首尾非空白）
 * 直接转成 <strong>…</strong>，绕开 flanking 规则。
 * - 先用占位符保护 fenced code 与 inline code，避免误伤代码里的 **。
 * - 转义写法 \*\* 不含相邻的两个星号，天然不会被双星号正则匹配，因此不受影响。
 */
function fixCjkBold(md) {
  const stash = [];
  const protect = (s) => { stash.push(s); return '\u0000' + (stash.length - 1) + '\u0000'; };
  md = md.replace(/```[\s\S]*?```/g, protect);   // 围栏代码块
  md = md.replace(/`[^`\n]*`/g, protect);        // 行内代码
  md = md.replace(/\*\*(?!\s)([^\n]+?)(?<!\s)\*\*/g, (m, inner) => {
    if (/^\*+$/.test(inner)) return m;           // 形如 **** 之类，保持原样
    return '<strong>' + inner + '</strong>';
  });
  md = md.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[+i]);
  return md;
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
 * 在所有 org 下查找指定角色名的代表立绘 URL。
 * 优先级：{角色名}_初始 → 洞悉 → 基础
 */
function findCharPortraitUrl(charName) {
  const liDir = path.join(RAW_DIR, '立绘');
  if (!fs.existsSync(liDir)) return null;
  const orgs = fs.readdirSync(liDir).filter(d =>
    fs.statSync(path.join(liDir, d)).isDirectory()
  );
  for (const org of orgs) {
    const srcDir = path.join(liDir, org, charName);
    if (!fs.existsSync(srcDir)) continue;
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
  }
  return null;
}

/**
 * 获取词条代表图 URL（相对于 dist 根目录，用于报纸首页）。
 * - character/npc: 自身立绘
 * - event_summary: featured_chars[0] 的立绘
 * - 其他类型暂无代表图
 */
function getRepresentativeImage(file) {
  const type = file.meta?.type;

  if (type === 'character' || type === 'npc') {
    const parts = file.slug.split('/');
    if (parts[0] !== '角色' || parts.length < 3) return null;
    const charName = parts[2];
    return findCharPortraitUrl(charName);
  }

  // 活动概要：优先用 featured_chars 第一个角色的立绘
  if (type === 'event_summary' && Array.isArray(file.meta.featured_chars)) {
    for (const name of file.meta.featured_chars) {
      const url = findCharPortraitUrl(name);
      if (url) return url;
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

  // 打乱
  const shuffled = [...candidates].sort(() => 0.5 - Math.random());
  if (shuffled.length < 3) return '';

  const isChar = f => f.meta?.type === 'character' || f.meta?.type === 'npc';
  const chars  = shuffled.filter(isChar);
  const others = shuffled.filter(f => !isChar(f));

  // 头条：从有图的池子里取（chars 通常有图，event_summary 现在也可能有图）
  const withImg = shuffled.filter(f => imgMap.has(f.slug));
  const headline = withImg[0] || shuffled[0];

  // 6 篇要闻：避免角色一统天下——限制最多 2 个角色，至少 4 个其他类型
  // （考虑头条通常已是角色或事件概要，正文里以多样性优先）
  const headlineIsChar = isChar(headline);
  const remainingChars  = chars.filter(f => f.slug !== headline.slug);
  const remainingOthers = others.filter(f => f.slug !== headline.slug);
  // 头条已占一个角色席位时，正文最多 1 个角色；否则正文最多 2 个角色
  const maxCharsInStories = headlineIsChar ? 1 : 2;
  const charPick  = remainingChars.slice(0, Math.min(maxCharsInStories, remainingChars.length));
  const otherPick = remainingOthers.slice(0, Math.max(0, 6 - charPick.length));

  // 若 others 不够（小 wiki 早期），用 chars 补齐
  let stories = [...charPick, ...otherPick];
  if (stories.length < 6) {
    const overflow = remainingChars.slice(charPick.length, charPick.length + (6 - stories.length));
    stories = [...stories, ...overflow];
  }
  // 类型交错：再洗一次牌
  stories = stories.sort(() => 0.5 - Math.random()).slice(0, 6);

  const selected = [headline, ...stories];

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

  // ── 今日要闻（6篇，3列×2行）────────────────────────────────────
  html += `<div class="np-section-rule"><span>今日要闻</span></div>`;
  html += `<div class="np-grid">`;
  for (const s of stories) html += card(s, 150);
  html += `</div>`;

  // ── 底栏（简讯一行）─────────────────────────────────────────────
  html += `<footer class="newspaper-footer">
  <span class="np-brief-inline">今日简讯：本站共收录 <strong>${files.length}</strong> 篇词条，涵盖角色、剧情、世界观等内容，资料均来自游戏原作，仅供创作参考。</span>
  <span class="np-footer-reload"><a href="index.html" onclick="location.reload();return false;">刷新换一批</a></span>
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
    // 加粗修复：绕开 marked 在中文/全角标点边界的 flanking 失败
    mdBody = fixCjkBold(mdBody);

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
    // 单品段落：优先用 raw/角色/{name}.md 的原文注入；否则按时装分组现有 ul
    let rawItemsForChar = null;
    if (file.meta?.type === 'character' || file.meta?.type === 'npc') {
      const parts = file.slug.split('/');
      const charName = parts[parts.length - 1];
      rawItemsForChar = loadRawItems(charName);
    }
    contentHtml = injectItemsTabs(contentHtml, inlineMap, rawItemsForChar);

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
      .replace(/\{\{bodyclass\}\}/g, 'px-shut px-enter')
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
    .replace(/\{\{bodyclass\}\}/g, 'px-shut px-enter')
    .replace(/\{\{nav\}\}/g, buildNav('newspaper.html'))
    .replace(/\{\{breadcrumbs\}\}/g, '')
    .replace(/\{\{watermark\}\}/g, '')
    .replace(/\{\{content\}\}/g, newspaperHtml);
  fs.writeFileSync(path.join(DIST_DIR, 'newspaper.html'), newspaperPage, 'utf-8');

  /* ── 封面首页：站点名 + 圆环菜单/D20 骰子；今日报纸只在掷骰后出现 ── */
  const coverHtml = `<div class="cover-hero">
  <div class="cover-kicker">THE REVERSE: 1999 CHRONICLE</div>
  <h1 class="cover-title">1999剧情Wiki</h1>
  <p class="cover-hint"><a href="newspaper.html">掷出 D20 · 阅读今日报纸 →</a></p>
</div>`;
  const coverPage = template
    .replace(/\{\{title\}\}/g, '首页')
    .replace(/\{\{root\}\}/g, '')
    .replace(/\{\{bodyclass\}\}/g, 'px-home')
    .replace(/\{\{nav\}\}/g, buildNav('index.html'))
    .replace(/\{\{breadcrumbs\}\}/g, '')
    .replace(/\{\{watermark\}\}/g, '')
    .replace(/\{\{content\}\}/g, coverHtml);
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), coverPage, 'utf-8');

  /* ── 写入搜索索引 & 复制静态资源 ── */
  fs.writeFileSync(path.join(DIST_DIR, 'search.json'), JSON.stringify(searchDocs), 'utf-8');
  fs.copyFileSync(CSS_PATH, path.join(DIST_DIR, 'style.css'));
  fs.copyFileSync(PIXEL_CSS_PATH, path.join(DIST_DIR, 'pixel.css'));

  console.log(`✅ 构建完成：${files.length} 个页面 → ${DIST_DIR}`);
  console.log(`   搜索索引：${searchDocs.length} 条`);
}

buildAll().catch(err => { console.error('❌ 构建出错：', err); process.exit(1); });
