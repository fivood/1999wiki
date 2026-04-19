/**
 * extract-content.js
 * 
 * Reads story-links.json and extracts the actual story text from each
 * individual chapter page. Saves each chapter as a Markdown file in the
 * appropriate raw/ subdirectory.
 * 
 * Usage: node extract-content.js [--category 主线故事] [--limit 10] [--resume]
 * 
 * Options:
 *   --category <name>  Only extract a specific category
 *   --limit <n>        Limit to first n pages (for testing)
 *   --resume           Skip already-extracted files
 *   --delay <ms>       Delay between pages (default: 3000)
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const CATEGORY_FILTER = getArg('category');
const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : null;
const RESUME = hasFlag('resume');
const DELAY = getArg('delay') ? parseInt(getArg('delay')) : 3000;

// Sanitize filename - replace characters not allowed in Windows filenames
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

// Convert extracted story elements to Markdown
function toMarkdown(storyData) {
  const lines = [];
  
  // YAML frontmatter
  lines.push('---');
  lines.push(`title: "${storyData.title}"`);
  lines.push(`chapter: "${storyData.chapter}"`);
  lines.push(`category: "${storyData.category}"`);
  lines.push(`source_url: "${storyData.url}"`);
  lines.push(`extracted_at: "${new Date().toISOString().split('T')[0]}"`);
  lines.push('---');
  lines.push('');
  
  // Title
  lines.push(`# ${storyData.chapter} ${storyData.title}`);
  lines.push('');
  
  // Story content
  for (const item of storyData.content) {
    if (item.type === 'dialogue') {
      lines.push(`**${item.speaker}**：${item.line}`);
      lines.push('');
    } else if (item.type === 'narration') {
      lines.push(`> ${item.line}`);
      lines.push('');
    } else if (item.type === 'section') {
      lines.push(`## ${item.text}`);
      lines.push('');
    }
  }
  
  return lines.join('\n');
}

async function extractStoryContent(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  
  // Wait for story content to load
  try {
    await page.waitForSelector('.story-text, .mw-parser-output', { timeout: 15000 });
  } catch (e) {
    // Page might not have .story-text, try parser output
  }
  
  // Extra wait for dynamic rendering
  await new Promise(r => setTimeout(r, 1500));
  
  const data = await page.evaluate(() => {
    const result = {
      pageTitle: '',
      content: []
    };
    
    // Get page title
    const titleEl = document.querySelector('#firstHeading, .page-header__title, h1');
    result.pageTitle = titleEl ? titleEl.textContent.trim() : '';
    
    // Try to find story-text elements first (primary method)
    const storyTexts = document.querySelectorAll('.story-text');
    
    if (storyTexts.length > 0) {
      for (const el of storyTexts) {
        const nameEl = el.querySelector('.story-text--name');
        const text = el.textContent.trim();
        
        if (!text) continue;
        
        if (nameEl) {
          const speaker = nameEl.textContent.replace(/[：:]\s*$/, '').trim();
          const line = text.replace(nameEl.textContent, '').trim();
          result.content.push({
            type: 'dialogue',
            speaker: speaker,
            line: line
          });
        } else {
          // Narration text - could be in a span with font-size style
          const cleanText = text.trim();
          if (cleanText) {
            result.content.push({
              type: 'narration',
              line: cleanText
            });
          }
        }
      }
    } else {
      // Fallback: extract from .mw-parser-output
      const parserOutput = document.querySelector('.mw-parser-output');
      if (parserOutput) {
        const paragraphs = parserOutput.querySelectorAll('p');
        for (const p of paragraphs) {
          const text = p.textContent.trim();
          if (text) {
            // Try to detect dialogue pattern: "Name: text" or "Name：text"
            const dialogueMatch = text.match(/^(.{1,10})[：:]\s*(.+)$/);
            if (dialogueMatch) {
              result.content.push({
                type: 'dialogue',
                speaker: dialogueMatch[1],
                line: dialogueMatch[2]
              });
            } else {
              result.content.push({
                type: 'narration',
                line: text
              });
            }
          }
        }
      }
    }
    
    return result;
  });
  
  return data;
}

async function main() {
  // Load links
  const linksPath = path.resolve(__dirname, '..', 'raw', 'story-links.json');
  if (!fs.existsSync(linksPath)) {
    console.error('❌ story-links.json 不存在！请先运行 extract-links.js');
    process.exit(1);
  }
  
  const linksData = JSON.parse(fs.readFileSync(linksPath, 'utf-8'));
  
  // Flatten and filter links
  let allLinks = [];
  for (const [category, links] of Object.entries(linksData.categories)) {
    if (CATEGORY_FILTER && category !== CATEGORY_FILTER) continue;
    allLinks.push(...links);
  }
  
  if (LIMIT) {
    allLinks = allLinks.slice(0, LIMIT);
  }
  
  console.log(`📚 准备提取 ${allLinks.length} 个章节`);
  if (CATEGORY_FILTER) console.log(`   类别筛选: ${CATEGORY_FILTER}`);
  if (LIMIT) console.log(`   数量限制: ${LIMIT}`);
  if (RESUME) console.log(`   续传模式: 跳过已有文件`);
  console.log(`   请求间隔: ${DELAY}ms`);
  
  // Launch browser
  console.log('\n🚀 启动浏览器...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const errors = [];
  
  for (let i = 0; i < allLinks.length; i++) {
    const link = allLinks[i];
    const category = link.category;
    const filename = sanitizeFilename(link.pageName) + '.md';
    const categoryDir = path.resolve(__dirname, '..', 'raw', category);
    const filePath = path.join(categoryDir, filename);
    
    // Progress indicator
    const progress = `[${i + 1}/${allLinks.length}]`;
    
    // Skip if file exists and resume mode
    if (RESUME && fs.existsSync(filePath)) {
      skipCount++;
      console.log(`${progress} ⏭ 跳过 (已存在): ${link.pageName}`);
      continue;
    }
    
    try {
      console.log(`${progress} 📖 提取: ${link.pageName} (${category})`);
      
      const data = await extractStoryContent(page, link.url);
      
      if (data.content.length === 0) {
        console.log(`${progress} ⚠️ 无内容: ${link.pageName}`);
        errors.push({ link, error: 'No content found' });
        errorCount++;
        continue;
      }
      
      // Build markdown
      const storyData = {
        title: link.title || data.pageTitle,
        chapter: link.pageName,
        category: category,
        url: link.url,
        content: data.content
      };
      
      const markdown = toMarkdown(storyData);
      
      // Ensure directory exists
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, markdown, 'utf-8');
      successCount++;
      console.log(`${progress} ✅ 保存: ${filename} (${data.content.length} 段)`);
      
    } catch (err) {
      console.error(`${progress} ❌ 失败: ${link.pageName} - ${err.message}`);
      errors.push({ link, error: err.message });
      errorCount++;
    }
    
    // Polite delay
    if (i < allLinks.length - 1) {
      await new Promise(r => setTimeout(r, DELAY));
    }
  }
  
  await browser.close();
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 提取完成！');
  console.log(`   ✅ 成功: ${successCount}`);
  console.log(`   ⏭ 跳过: ${skipCount}`);
  console.log(`   ❌ 失败: ${errorCount}`);
  
  if (errors.length > 0) {
    const errorLogPath = path.resolve(__dirname, '..', 'raw', 'extraction-errors.json');
    fs.writeFileSync(errorLogPath, JSON.stringify(errors, null, 2), 'utf-8');
    console.log(`   错误日志: ${errorLogPath}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
