// 单页爬取（任意 URL）
// 用法：node tools/_scrape-one.js <url> <outpath>
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const URL = process.argv[2];
const OUT = process.argv[3];
if (!URL || !OUT) { console.error('Usage: node _scrape-one.js <url> <outpath>'); process.exit(1); }

async function extract(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));
  return page.evaluate(() => {
    const lines = [];
    const sts = document.querySelectorAll('.story-text');
    if (sts.length > 0) {
      for (const el of sts) {
        const nameEl = el.querySelector('.story-text--name');
        const text = el.textContent.trim();
        if (!text) continue;
        if (nameEl) {
          const speaker = nameEl.textContent.replace(/[：:]\s*$/, '').trim();
          const line = text.replace(nameEl.textContent, '').trim();
          lines.push(`**${speaker}**：${line}`);
        } else {
          lines.push(`> ${text}`);
        }
        lines.push('');
      }
    } else {
      const root = document.querySelector('.mw-parser-output');
      if (root) root.querySelectorAll('p, li, h2, h3, h4').forEach(el => {
        if (!el.querySelector('p')) {
          const t = (el.innerText || el.textContent).trim();
          if (t) lines.push(t);
        }
      });
    }
    return lines.join('\n');
  });
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  console.log(`Scraping: ${URL}`);
  const content = await extract(page, URL);
  const dir = path.dirname(OUT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUT, content, 'utf-8');
  console.log(`✅ Saved ${OUT} (${content.length} chars)`);
  await browser.close();
})().catch(console.error);
