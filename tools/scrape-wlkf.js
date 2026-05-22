const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const STORY_NAME = '无路可返';
const CHAPTERS = Array.from({length: 8}, (_, i) => {
  const num = String(i + 1).padStart(2, '0');
  return {
    url: `https://res1999.huijiwiki.com/wiki/${encodeURIComponent(STORY_NAME)}-${num}`,
    name: `${STORY_NAME}-${num}`,
  };
});

async function extractContent(page, item) {
  await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  const textContent = await page.evaluate(() => {
    let lines = [];

    // First try .story-text approach (dialogue format)
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
      // Fallback: grab paragraph content from mw-parser-output
      const mwParserOutput = document.querySelector('.mw-parser-output');
      if (mwParserOutput) {
        mwParserOutput.querySelectorAll('p, h2, h3, h4, li').forEach(el => {
          const txt = el.innerText ? el.innerText.trim() : el.textContent.trim();
          if (txt && !el.querySelector('p')) {
            lines.push(txt);
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
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  const outDir = 'G:\\1999story\\raw\\角色剧情';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const item of CHAPTERS) {
    console.log(`Scraping: ${item.name}`);
    try {
      const content = await extractContent(page, item);
      const md = `---
title: "${item.name}"
source_url: "${item.url}"
extracted_at: "${new Date().toISOString().split('T')[0]}"
---

# ${item.name}

${content}
`;
      const filePath = path.join(outDir, `${item.name}.md`);
      fs.writeFileSync(filePath, md, 'utf-8');
      console.log(`Saved: ${filePath}`);
    } catch (e) {
      console.error(`Failed ${item.name}: ${e.message}`);
    }
  }

  await browser.close();
  console.log('Done!');
}

main().catch(console.error);
