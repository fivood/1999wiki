/**
 * extract-links.js
 * 
 * Extracts all individual story chapter links from the four listing pages
 * on the Reverse: 1999 wiki. Outputs a JSON file with categorized links.
 * 
 * Usage: node extract-links.js
 * Output: ../raw/story-links.json
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const LISTING_PAGES = [
  {
    category: '主线故事',
    url: 'https://res1999.huijiwiki.com/wiki/%E7%AB%A0%E8%8A%82%E5%88%97%E8%A1%A8/%E4%B8%BB%E7%BA%BF%E6%95%85%E4%BA%8B'
  },
  {
    category: '活动剧情',
    url: 'https://res1999.huijiwiki.com/wiki/%E7%AB%A0%E8%8A%82%E5%88%97%E8%A1%A8/%E6%B4%BB%E5%8A%A8%E5%89%A7%E6%83%85'
  },
  {
    category: '角色剧情',
    url: 'https://res1999.huijiwiki.com/wiki/%E7%AB%A0%E8%8A%82%E5%88%97%E8%A1%A8/%E8%A7%92%E8%89%B2%E5%89%A7%E6%83%85'
  },
  {
    category: '轶事',
    url: 'https://res1999.huijiwiki.com/wiki/%E7%AB%A0%E8%8A%82%E5%88%97%E8%A1%A8/%E8%BD%B6%E4%BA%8B'
  }
];

async function extractLinksFromPage(page, url, category) {
  console.log(`\n📖 正在提取 [${category}] 的链接...`);
  console.log(`   URL: ${url}`);
  
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  
  // Wait for content to load
  await page.waitForSelector('.mw-parser-output', { timeout: 30000 });
  
  // Extra wait for dynamic content
  await new Promise(r => setTimeout(r, 2000));
  
  // Extract all story chapter links from the page
  const links = await page.evaluate(() => {
    const results = [];
    const parserOutput = document.querySelector('.mw-parser-output');
    if (!parserOutput) return results;
    
    // Find all links within the parser output area
    const allLinks = parserOutput.querySelectorAll('a[href]');
    const seen = new Set();
    
    for (const link of allLinks) {
      const href = link.getAttribute('href');
      const text = link.textContent.trim();
      
      // Skip non-story links (category pages, external, anchors, special pages)
      if (!href || 
          href.startsWith('#') || 
          href.includes('章节列表') || 
          href.includes('Special:') ||
          href.includes('File:') ||
          href.includes('Category:') ||
          href.includes('action=') ||
          href.startsWith('http') && !href.includes('res1999.huijiwiki.com/wiki/') ||
          !text ||
          text.length > 50) {
        continue;
      }
      
      // Normalize the URL
      let fullUrl = href;
      if (href.startsWith('/wiki/')) {
        fullUrl = 'https://res1999.huijiwiki.com' + href;
      } else if (href.startsWith('/')) {
        continue; // Skip other relative paths
      }
      
      // Only include wiki article links
      if (!fullUrl.includes('/wiki/')) continue;
      
      // Extract the page name from URL
      const pageName = decodeURIComponent(fullUrl.split('/wiki/')[1] || '');
      
      // Skip if we've already seen this URL
      if (seen.has(pageName)) continue;
      seen.add(pageName);
      
      // Skip listing pages and meta pages
      if (pageName.includes('章节列表') || 
          pageName.includes('模板:') ||
          pageName.includes('分类:') ||
          pageName === '') continue;
      
      results.push({
        title: text,
        pageName: pageName,
        url: fullUrl
      });
    }
    
    return results;
  });
  
  console.log(`   ✅ 找到 ${links.length} 个链接`);
  return links.map(link => ({ ...link, category }));
}

async function main() {
  console.log('🚀 启动浏览器...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Set a realistic user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  
  const allLinks = {};
  let totalCount = 0;
  
  for (const listing of LISTING_PAGES) {
    try {
      const links = await extractLinksFromPage(page, listing.url, listing.category);
      allLinks[listing.category] = links;
      totalCount += links.length;
      
      // Polite delay between pages
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`   ❌ 提取 ${listing.category} 失败:`, err.message);
      allLinks[listing.category] = [];
    }
  }
  
  await browser.close();
  
  // Save results
  const outputPath = path.resolve(__dirname, '..', 'raw', 'story-links.json');
  const output = {
    extractedAt: new Date().toISOString(),
    totalCount,
    categories: allLinks
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  
  console.log(`\n📊 提取完成！`);
  console.log(`   总计: ${totalCount} 个链接`);
  for (const [cat, links] of Object.entries(allLinks)) {
    console.log(`   ${cat}: ${links.length} 个`);
  }
  console.log(`   保存至: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
