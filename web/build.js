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

/* ── 生成报纸首页 ── */
function generateNewspaperHome(files) {
  const candidates = files.filter(f => f.slug !== 'index' && f.meta?.title);
  const shuffled = candidates.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 7);
  if (selected.length < 3) return '';

  const headline = selected[0];
  const stories = selected.slice(1);
  const dateStr = '<span id="newspaperDate"></span>';
  const issueNum = Math.floor(Math.random() * 900) + 100;

  let html = `<div class="newspaper">`;

  // 报头
  html += `<header class="masthead">`;
  html += `<h1>THE REVERSE: 1999 CHRONICLE</h1>`;
  html += `<div class="masthead-sub">重返未来：1999 剧情 Wiki</div>`;
  html += `<div class="masthead-meta">`;
  html += `<span>第 ${issueNum} 期</span>`;
  html += `<span>${dateStr}</span>`;
  html += `<span>售价 1 利齿子儿</span>`;
  html += `</div></header>`;

  // 头条
  html += `<div class="headline-story">`;
  html += `<div class="headline-main">`;
  html += `<h2><a href="${headline.url}">${escapeHtml(headline.meta.title)}</a></h2>`;
  html += `<p class="headline-summary">${escapeHtml(extractSummary(headline, 320))}</p>`;
  html += `<a href="${headline.url}" class="read-more">阅读全文 →</a>`;
  html += `</div>`;
  html += `<div class="headline-side">`;
  html += `<div class="box-ad">`;
  html += `<div class="box-ad-title">今日简讯</div>`;
  html += `<div class="box-ad-text">本站共收录 ${files.length} 篇词条，涵盖角色、剧情、世界观等内容。所有资料均来自游戏原作，仅供创作参考。</div>`;
  html += `</div>`;
  html += `</div>`;
  html += `</div>`;

  // 新闻网格（不规则布局）
  const [s1, s2, s3, s4, s5, s6] = stories;
  html += `<div class="news-grid">`;

  // 全宽头条
  html += `<article class="news-item news-headline">`;
  html += `<h3><a href="${s1.url}">${escapeHtml(s1.meta.title)}</a></h3>`;
  html += `<p>${escapeHtml(extractSummary(s1, 260))}</p>`;
  html += `<a href="${s1.url}" class="read-more">阅读全文 →</a>`;
  html += `</article>`;

  // 左中
  html += `<article class="news-item news-left-mid">`;
  html += `<h3><a href="${s2.url}">${escapeHtml(s2.meta.title)}</a></h3>`;
  html += `<p>${escapeHtml(extractSummary(s2, 200))}</p>`;
  html += `<a href="${s2.url}" class="read-more">阅读全文 →</a>`;
  html += `</article>`;

  // 右中
  html += `<article class="news-item news-right-mid">`;
  html += `<h3><a href="${s3.url}">${escapeHtml(s3.meta.title)}</a></h3>`;
  html += `<p>${escapeHtml(extractSummary(s3, 160))}</p>`;
  html += `<a href="${s3.url}" class="read-more">阅读全文 →</a>`;
  html += `</article>`;

  // 左下（竖长条）
  html += `<article class="news-item news-left-low">`;
  html += `<h3><a href="${s4.url}">${escapeHtml(s4.meta.title)}</a></h3>`;
  html += `<p>${escapeHtml(extractSummary(s4, 240))}</p>`;
  html += `<a href="${s4.url}" class="read-more">阅读全文 →</a>`;
  html += `</article>`;

  // 右下上
  html += `<article class="news-item news-right-up">`;
  html += `<h3><a href="${s5.url}">${escapeHtml(s5.meta.title)}</a></h3>`;
  html += `<p>${escapeHtml(extractSummary(s5, 180))}</p>`;
  html += `<a href="${s5.url}" class="read-more">阅读全文 →</a>`;
  html += `</article>`;

  // 右下下
  html += `<article class="news-item news-right-down">`;
  html += `<h3><a href="${s6.url}">${escapeHtml(s6.meta.title)}</a></h3>`;
  html += `<p>${escapeHtml(extractSummary(s6, 140))}</p>`;
  html += `<a href="${s6.url}" class="read-more">阅读全文 →</a>`;
  html += `</article>`;

  html += `</div>`;

  // 底栏
  html += `<footer class="newspaper-footer">`;
  html += `<div>本页内容每次访问随机生成 · <a href="index.html" onclick="location.reload();return false;">刷新换一批</a></div>`;
  html += `</footer>`;

  html += `</div>`;
  return html;
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
    const id = plain.toLowerCase().replace(/[^\w一-龥]+/g, '-').replace(/^-|-$/g, '');
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

/* ── 生成报纸首页（独立页面） ── */
const newspaperHtml = generateNewspaperHome(files);
const newspaperPage = template
  .replace(/\{\{title\}\}/g, '今日报纸')
  .replace(/\{\{root\}\}/g, '')
  .replace(/\{\{nav\}\}/g, buildNav('newspaper.html'))
  .replace(/\{\{breadcrumbs\}\}/g, '')
  .replace(/\{\{content\}\}/g, newspaperHtml);
fs.writeFileSync(path.join(DIST_DIR, 'newspaper.html'), newspaperPage, 'utf-8');
// 同时写入根目录默认页，让 https://1999.fivood.com/ 直接显示报纸
fs.writeFileSync(path.join(DIST_DIR, 'index.html'), newspaperPage, 'utf-8');

/* ── 写入搜索索引 & 复制静态资源 ── */
fs.writeFileSync(path.join(DIST_DIR, 'search.json'), JSON.stringify(searchDocs), 'utf-8');
fs.copyFileSync(CSS_PATH, path.join(DIST_DIR, 'style.css'));

console.log(`✅ 构建完成：${files.length} 个页面 → ${DIST_DIR}`);
console.log(`   搜索索引：${searchDocs.length} 条`);
