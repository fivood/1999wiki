// 富文本爬取：抓正文 + 表格 + 图片 alt/title
// 用法：node tools/_scrape-rich.js <url> <outpath>
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const URL = process.argv[2];
const OUT = process.argv[3];
if (!URL || !OUT) { console.error('Usage: node _scrape-rich.js <url> <outpath>'); process.exit(1); }

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  console.log(`Scraping: ${URL}`);
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  const out = await page.evaluate(() => {
    const lines = [];
    const root = document.querySelector('.mw-parser-output');
    if (!root) return '';

    function walk(el, depth = 0) {
      for (const node of el.childNodes) {
        if (node.nodeType === 3) { // text
          const t = node.textContent.trim();
          if (t) lines.push(t);
        } else if (node.nodeType === 1) {
          const tag = node.tagName.toLowerCase();
          if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
            lines.push('\n' + '#'.repeat(parseInt(tag[1])) + ' ' + (node.innerText || node.textContent).trim());
          } else if (tag === 'img') {
            const alt = node.getAttribute('alt') || '';
            const title = node.getAttribute('title') || '';
            const src = node.getAttribute('src') || '';
            const meta = [alt, title].filter(Boolean).join(' / ');
            if (meta && !/^\d+px-/.test(meta) && meta.length > 1) {
              lines.push(`[图: ${meta}]`);
            }
          } else if (tag === 'table') {
            // try to extract table rows
            const rows = node.querySelectorAll('tr');
            for (const r of rows) {
              const cells = [...r.querySelectorAll('th,td')].map(c => {
                let txt = (c.innerText || c.textContent).trim().replace(/\s+/g, ' ');
                // include img alts inside cell
                const imgs = c.querySelectorAll('img');
                const imgMeta = [...imgs].map(i => i.getAttribute('alt') || i.getAttribute('title') || '')
                  .filter(t => t && t.length > 1 && !/^\d+px-/.test(t))
                  .join(' / ');
                if (imgMeta) txt = `[图: ${imgMeta}]` + (txt ? ' | ' + txt : '');
                return txt;
              }).filter(Boolean);
              if (cells.length) lines.push('| ' + cells.join(' | ') + ' |');
            }
            lines.push('');
          } else if (tag === 'ul' || tag === 'ol') {
            for (const li of node.querySelectorAll(':scope > li')) {
              lines.push('- ' + (li.innerText || li.textContent).trim().replace(/\s+/g, ' '));
            }
          } else if (tag === 'p') {
            const t = (node.innerText || node.textContent).trim();
            if (t) lines.push(t);
          } else {
            walk(node, depth + 1);
          }
        }
      }
    }
    walk(root);
    return lines.join('\n');
  });

  const dir = path.dirname(OUT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUT, out, 'utf-8');
  console.log(`✅ Saved ${OUT} (${out.length} chars)`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
