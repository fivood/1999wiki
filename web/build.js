const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const WIKI_DIR = path.join(__dirname, '..', 'wiki');
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
const slugSet = new Set(files.map(f => f.slug));

/* ── 构建导航树 ── */
function buildNav(currentUrl) {
  // 按目录分组
  const groups = {};
  for (const f of files) {
    const top = f.dir.split('/')[0] || '其他';
    if (!groups[top]) groups[top] = [];
    groups[top].push(f);
  }

  // 定义分组顺序
  const order = ['index', '角色', '世界观', '地点', '组织', '主题', '剧情概要', '轶事', '其他'];
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  let html = '';
  for (const key of sortedKeys) {
    const list = groups[key];
    const isIndex = key === 'index';
    const label = isIndex ? '首页 & 索引' : key;
    const hasCurrent = list.some(f => f.url === currentUrl);

    html += `<div class="nav-group${hasCurrent ? '' : ' collapsed'}">`;
    html += `<div class="nav-group-title" onclick="this.parentElement.classList.toggle('collapsed')"><span class="arrow">▾</span>${escapeHtml(label)}</div>`;
    html += '<ul class="nav-list">';
    for (const f of list) {
      const active = f.url === currentUrl ? ' active' : '';
      const title = f.meta?.title || f.name;
      html += `<li><a href="${relativeRoot(currentUrl)}${f.url}" class="${active}">${escapeHtml(title)}</a></li>`;
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

/* ── 处理单个文件 ── */
const searchDocs = [];

for (const file of files) {
  const raw = fs.readFileSync(file.full, 'utf-8');
  const parsed = matter(raw);
  file.meta = parsed.data;

  // Wiki Link → HTML 链接
  let mdBody = processWikiLinks(parsed.content, file.slug);

  let contentHtml = marked.parse(mdBody);

  // 给 heading 添加 anchor id（基于纯文本内容）
  contentHtml = contentHtml.replace(/<h([1-6])>(.+?)<\/h\1>/g, (match, level, inner) => {
    const plain = inner.replace(/<[^>]+>/g, '');
    const id = plain.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
    const safeId = id || 'heading-' + Math.random().toString(36).slice(2, 7);
    return `<h${level} id="${safeId}">${inner}</h${level}>`;
  });

  // 组装页面
  const root = relativeRoot(file.url);
  const title = parsed.data.title || (file.slug === 'index' ? '首页' : file.name);
  const navHtml = buildNav(file.url);
  const breadcrumbs = buildBreadcrumbs(file.slug, root);
  const metaBar = buildMetaBar(parsed.data);

  let page = template
    .replace(/\{\{title\}\}/g, escapeHtml(title))
    .replace(/\{\{root\}\}/g, root)
    .replace(/\{\{nav\}\}/g, navHtml)
    .replace(/\{\{breadcrumbs\}\}/g, breadcrumbs)
    .replace(/\{\{content\}\}/g, metaBar + contentHtml);

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

/* ── 写入搜索索引 & CSS ── */
fs.writeFileSync(path.join(DIST_DIR, 'search.json'), JSON.stringify(searchDocs), 'utf-8');
fs.copyFileSync(CSS_PATH, path.join(DIST_DIR, 'style.css'));

console.log(`✅ 构建完成：${files.length} 个页面 → ${DIST_DIR}`);
console.log(`   搜索索引：${searchDocs.length} 条`);
