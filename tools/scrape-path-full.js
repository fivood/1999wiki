const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const PARENT_URL = 'https://res1999.huijiwiki.com/wiki/%E5%B0%8F%E5%BE%84/%E5%9C%A8%E6%88%91%E4%BB%AC%E7%9A%84%E6%97%B6%E4%BB%A3%E9%87%8C';

async function extractContent(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));
  
  const textContent = await page.evaluate(() => {
    let lines = [];
    
    // First try .story-text
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
        mwParserOutput.querySelectorAll('p').forEach(el => {
            const txt = el.innerText ? el.innerText.trim() : el.textContent.trim();
            if (txt) {
                lines.push(txt);
            }
        });
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
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  
  console.log('Fetching parent page...');
  await page.goto(PARENT_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  
  // Extract all subpage links
  const links = await page.evaluate(() => {
    const items = [];
    const tableCells = document.querySelectorAll('.mw-parser-output td, .mw-parser-output li');
    tableCells.forEach(td => {
      const a = td.querySelector('a');
      if (a && a.href && a.href.includes('/wiki/')) {
        items.push({
          title: a.innerText.trim(),
          url: a.href
        });
      }
    });
    return items;
  });
  
  console.log(`Found ${links.length} potential sub-stories!`);
  
  let fullDoc = '# 在我们的时代里\\n\\n';
  
  for (const item of links) {
    if (!item.title) continue;
    console.log(`Scraping sub-story: ${item.title}`);
    try {
      const content = await extractContent(page, item.url);
      if (content.trim()) {
        fullDoc += `## ${item.title}\\n\\n${content}\\n\\n`;
      } else {
         fullDoc += `## ${item.title}\\n\\n*(无内容或格式特殊)*\\n\\n`;
      }
    } catch (e) {
      console.log(`Failed format ${item.title} ` + e.toString());
    }
  }
  
  const dir = path.join('g:\\1999story\\raw', '小径');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '在我们的时代里_完整内容.md'), fullDoc.replace(/\\n/g, '\\n'), 'utf-8');
  
  await browser.close();
  console.log('All done!');
}

main().catch(console.error);
