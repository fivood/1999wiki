const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const URLS_TO_SCRAPE = [
  { url: 'https://res1999.huijiwiki.com/wiki/%E5%B0%8F%E5%BE%84/%E5%9C%A8%E6%88%91%E4%BB%AC%E7%9A%84%E6%97%B6%E4%BB%A3%E9%87%8C', name: '在我们的时代里', category: '小径' }
];

async function extractContent(page, item) {
  await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  
  const textContent = await page.evaluate(() => {
    let lines = [];
    
    // Attempt standard MW parser finding
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
