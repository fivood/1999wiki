const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const HUB_URL = 'https://res1999.huijiwiki.com/wiki/%E4%BB%96%E8%80%85%E7%9A%84%E6%82%B2%E5%93%80';
const CATEGORY = '主线故事';
const OUTPUT_DIR = 'g:\\1999story\\raw\\主线故事';

async function extractStoryContent(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));

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

async function discoverSceneLinks(page) {
  await page.goto(HUB_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  // Look for links matching 13TH-XX pattern
  const links = await page.evaluate(() => {
    const anchors = document.querySelectorAll('a[href]');
    const results = [];
    for (const a of anchors) {
      const href = a.getAttribute('href');
      const text = a.textContent.trim();
      if (href && /13TH-\d+/.test(href)) {
        const match = href.match(/13TH-(\d+)/);
        if (match) {
          results.push({
            url: 'https://res1999.huijiwiki.com' + href,
            id: 'A' + match[1].padStart(2, '0'), // e.g. A01
            name: text || match[0]
          });
        }
      }
    }
    // Deduplicate by url
    const seen = new Set();
    return results.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
  });

  return links;
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

  console.log('Discovering 13TH scene links from hub page...');
  let scenes = await discoverSceneLinks(page);
  console.log(`Found ${scenes.length} scenes: ${scenes.map(s => s.url).join(', ')}`);

  if (scenes.length === 0) {
    // Hub page has no sub-links — scrape the hub itself as a single file
    console.log('No sub-scenes found. Scraping hub page directly...');
    const content = await extractStoryContent(page, HUB_URL);
    const name = '13TH_他者的悲哀';
    const md = `---
title: "${name}"
category: "${CATEGORY}"
source_url: "${HUB_URL}"
extracted_at: "${new Date().toISOString().split('T')[0]}"
---

# ${name}

${content}
`;
    fs.writeFileSync(path.join(OUTPUT_DIR, `${name}.md`), md, 'utf-8');
    console.log(`Saved ${name}.md`);
  } else {
    // Sort by scene number
    scenes.sort((a, b) => a.url.localeCompare(b.url));

    for (const scene of scenes) {
      // Extract scene id like 13TH-01 from URL
      const idMatch = scene.url.match(/\/(13TH-\d+)/);
      const sceneId = idMatch ? idMatch[1] : scene.id;
      console.log(`Scraping: ${sceneId} - ${scene.name}`);
      try {
        const content = await extractStoryContent(page, scene.url);
        const name = sceneId;
        const md = `---
title: "${name}"
category: "${CATEGORY}"
source_url: "${scene.url}"
extracted_at: "${new Date().toISOString().split('T')[0]}"
---

# ${name}

${content}
`;
        fs.writeFileSync(path.join(OUTPUT_DIR, `${name}.md`), md, 'utf-8');
        console.log(`Saved ${name}.md`);
      } catch (e) {
        console.error(`Failed: ${sceneId} — ${e.message}`);
      }
    }
  }

  await browser.close();
  console.log('Done!');
}

main().catch(console.error);
