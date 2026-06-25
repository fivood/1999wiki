// 爬取单个 UTTU 闪烁集会活动剧情文本
// 用法：node tools/scrape-uttu-event.js <wiki页面名> <活动名>
// 例：  node tools/scrape-uttu-event.js 昨日金杯-剧情 昨日金杯
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const PAGE_NAME = process.argv[2] || '昨日金杯-剧情';
const EVENT_NAME = process.argv[3] || '昨日金杯';
const URL = `https://res1999.huijiwiki.com/wiki/${encodeURIComponent(PAGE_NAME)}`;
const OUT_DIR = path.join('g:\\1999story\\raw\\活动剧情', 'UTTU闪烁集会');
const OUT_FILE = path.join(OUT_DIR, `${EVENT_NAME}.md`);

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
      if (root) {
        root.querySelectorAll('p, li, h2, h3, h4').forEach(el => {
          if (!el.querySelector('p')) {
            const t = (el.innerText || el.textContent).trim();
            if (t) lines.push(t);
          }
        });
      }
    }
    return lines.join('\n');
  });
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  console.log(`Scraping: ${URL}`);
  const content = await extract(page, URL);
  const md = `---
title: "${EVENT_NAME}"
category: "UTTU闪烁集会"
source_url: "${URL}"
extracted_at: "${new Date().toISOString().split('T')[0]}"
---

# ${EVENT_NAME}

${content}
`;
  fs.writeFileSync(OUT_FILE, md, 'utf-8');
  console.log(`✅ Saved ${OUT_FILE} (${content.length} chars)`);
  await browser.close();
}

main().catch(console.error);
