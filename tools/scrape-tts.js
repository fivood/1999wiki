// 爬取 v3.8「世纪末尺度 The Temporal Scale」TTS-01 ~ TTS-22
// 沿用 scrape-13th.js 的结构，跳过 hub 发现，直接枚举 01..22
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const CATEGORY = '主线故事';
const OUTPUT_DIR = 'g:\\1999story\\raw\\主线故事';
const PREFIX = 'TTS';
const COUNT = 22;

async function extractStoryContent(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));

  const textContent = await page.evaluate(() => {
    let lines = [];

    const storyTexts = document.querySelectorAll('.story-text');
    if (storyTexts.length > 0) {
      for (const el of storyTexts) {
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
      const mwParserOutput = document.querySelector('.mw-parser-output');
      if (mwParserOutput) {
        mwParserOutput.querySelectorAll('*').forEach(el => {
          if (el.tagName === 'P' || el.tagName === 'LI' || el.tagName === 'H2' || el.tagName === 'H3' || el.tagName === 'H4') {
            const txt = el.innerText ? el.innerText.trim() : el.textContent.trim();
            if (txt && !el.querySelector('p')) {
              lines.push(txt);
            }
          }
        });
      } else {
        lines.push(document.body.innerText);
      }
    }
    return lines.join('\n');
  });

  return textContent;
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  const failures = [];
  for (let i = 1; i <= COUNT; i++) {
    const id = `${PREFIX}-${String(i).padStart(2, '0')}`;
    const url = `https://res1999.huijiwiki.com/wiki/${id}`;
    console.log(`[${i}/${COUNT}] Scraping: ${id}`);
    try {
      const content = await extractStoryContent(page, url);
      if (!content || content.trim().length < 50) {
        console.warn(`  ⚠️ Very short content for ${id} (${content.length} chars), may have failed`);
      }
      const md = `---
title: "${id}"
category: "${CATEGORY}"
source_url: "${url}"
extracted_at: "${new Date().toISOString().split('T')[0]}"
---

# ${id}

${content}
`;
      fs.writeFileSync(path.join(OUTPUT_DIR, `${id}.md`), md, 'utf-8');
      console.log(`  ✅ Saved ${id}.md (${content.length} chars)`);
    } catch (e) {
      console.error(`  ❌ Failed: ${id} — ${e.message}`);
      failures.push({ id, error: e.message });
    }
  }

  await browser.close();
  if (failures.length) {
    console.log(`\n⚠️  ${failures.length} failures:`);
    for (const f of failures) console.log(`  - ${f.id}: ${f.error}`);
  } else {
    console.log('\n✅ All done!');
  }
}

main().catch(console.error);
