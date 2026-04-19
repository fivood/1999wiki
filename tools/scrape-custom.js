const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const URLS_TO_SCRAPE = [
  { url: 'https://res1999.huijiwiki.com/wiki/ASD-01', name: 'ASD-01 一场恶梦', category: '黄昏的音序' },
  { url: 'https://res1999.huijiwiki.com/wiki/ASD-02', name: 'ASD-02 二等公民', category: '黄昏的音序' },
  { url: 'https://res1999.huijiwiki.com/wiki/ASD-03', name: 'ASD-03 职业道德', category: '黄昏的音序' },
  { url: 'https://res1999.huijiwiki.com/wiki/ASD-04', name: 'ASD-04 致意亚琛·上', category: '黄昏的音序' },
  { url: 'https://res1999.huijiwiki.com/wiki/ASD-05', name: 'ASD-05 致意亚琛·下', category: '黄昏的音序' },
  { url: 'https://res1999.huijiwiki.com/wiki/ASD-06', name: 'ASD-06 镜中的命运', category: '黄昏的音序' },
  { url: 'https://res1999.huijiwiki.com/wiki/ASD-07', name: 'ASD-07 浪花与音符', category: '黄昏的音序' },
  { url: 'https://res1999.huijiwiki.com/wiki/%E9%BB%84%E6%98%8F%E7%9A%84%E9%9F%B3%E5%BA%8F', name: '黄昏的音序_结局合集', category: '黄昏的音序' },
  { url: 'https://res1999.huijiwiki.com/wiki/%E7%AC%AC%E4%B8%89%E6%89%87%E9%97%A8/%E9%98%BF%E5%8B%92%E5%A4%AB%E5%85%8B%E5%A7%86%E9%81%97%E9%97%BB', name: '阿勒夫克姆遗闻', category: '第三扇门' }
];

async function extractContent(page, item) {
  await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000)); // wait for rendering
  
  // Save a screenshot for debugging
  await page.screenshot({ path: path.join(__dirname, `${item.name}.png`) });

  const textContent = await page.evaluate(() => {
    let lines = [];
    
    // First try .story-text approach
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
      // Look for the main content block
      const mwParserOutput = document.querySelector('.mw-parser-output');
      if (mwParserOutput) {
        // Collect text broadly from useful elements
        mwParserOutput.querySelectorAll('*').forEach(el => {
            // Keep it simple: if it has direct text nodes or is a paragraph
            if (el.tagName === 'P' || el.tagName === 'LI' || el.tagName === 'H2' || el.tagName === 'H3' || el.tagName === 'H4') {
                const txt = el.innerText ? el.innerText.trim() : el.textContent.trim();
                // Avoid duplicating text from parents by only taking it if it's not empty, and we haven't processed its parent exactly.
                if (txt && !el.querySelector('p')) { // crude check to avoid wrappers
                    lines.push(txt);
                }
            }
        });
      } else {
         lines.push(document.body.innerText);
      }
    }
    return lines.join('\\n');
  });

  return textContent;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  // Provide realistic user agent to avoid bot detection
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  
  for (const item of URLS_TO_SCRAPE) {
    console.log(`Scraping: ${item.name}`);
    try {
      const content = await extractContent(page, item);
      let md = `---
title: "${item.name}"
category: "${item.category}"
source_url: "${item.url}"
extracted_at: "${new Date().toISOString().split('T')[0]}"
---

# ${item.name}

${content}
`;
      const dir = path.join('g:\\1999story\\raw', item.category);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${item.name}.md`);
      fs.writeFileSync(filePath, md.replace(/\\n/g, '\\n'), 'utf-8');
      console.log(`Saved to ${filePath}`);
    } catch (e) {
      console.log(`Failed format ${item.name} ` + e.toString());
    }
  }
  
  await browser.close();
  console.log('All done!');
}

main().catch(console.error);
