"""
fetch_cg.py — 从灰机wiki抓取重返未来:1999 CG图片
用法：python tools/fetch_cg.py [分类名 ...]
不带参数则抓取所有分类。

示例：
  python tools/fetch_cg.py 主线剧情
  python tools/fetch_cg.py 主线剧情 角色故事
  python tools/fetch_cg.py          # 全部抓取

输出目录：raw/CG/<分类>/<章节>/文件名.png
"""

import os
import re
import sys
import time
import urllib.parse
from pathlib import Path

import cloudscraper
from bs4 import BeautifulSoup, Tag

# ── 配置 ────────────────────────────────────────────────────────────────────

BASE_WIKI   = "https://res1999.huijiwiki.com"
BASE_IMG    = "https://huiji-public.huijistatic.com"
OUTPUT_DIR  = Path(__file__).parent.parent / "raw" / "CG"
DELAY       = 1.0   # 每张图下载间隔（秒）

CATEGORIES = {
    "主线剧情":   "/wiki/CG/主线剧情",
    "角色故事":   "/wiki/CG/角色故事",
    "活动剧情":   "/wiki/CG/活动剧情",
    "维也纳拾遗": "/wiki/CG/维也纳拾遗",
    "嗡鸣的往昔": "/wiki/CG/嗡鸣的往昔",
}

SCRAPER = cloudscraper.create_scraper(
    browser={"browser": "chrome", "platform": "windows", "mobile": False}
)

# ── 工具函数 ─────────────────────────────────────────────────────────────────

def fetch_page(url: str) -> BeautifulSoup | None:
    try:
        r = SCRAPER.get(url, timeout=20)
        r.raise_for_status()
        return BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        print(f"  [错误] 获取页面失败: {url}\n        {e}")
        return None


def thumb_to_original(src: str) -> str:
    """
    缩略图 URL → 原图 URL

    输入:  https://huiji-thumb.huijistatic.com/res1999/uploads/thumb/3/30/Cg-xxx.png/500px-Cg-xxx.png
    输出:  https://huiji-public.huijistatic.com/res1999/uploads/3/30/Cg-xxx.png
    """
    # 去掉 /thumb 并去掉末尾的尺寸片段
    path = re.sub(
        r"/(thumb)/([a-f0-9]/[a-f0-9a-f]+/[^/]+)/[^/]+$",
        r"/\2",
        urllib.parse.urlparse(src).path,
    )
    return BASE_IMG + path


def safe_name(name: str) -> str:
    """去除文件名或目录名中的非法字符。"""
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    return name.strip(". ") or "unnamed"


def download(url: str, dest: Path) -> bool:
    if dest.exists():
        return False  # 已存在，静默跳过
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        r = SCRAPER.get(url, timeout=30, stream=True)
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(8192):
                f.write(chunk)
        return True
    except Exception as e:
        print(f"  [错误] {dest.name}: {e}")
        return False


# ── 核心逻辑 ─────────────────────────────────────────────────────────────────

def extract_by_section(soup: BeautifulSoup) -> dict[str, list[tuple[str, str]]]:
    """
    按 h2 章节分组，返回 {章节名: [(原图URL, 文件名), ...]}
    未归属到任何章节的图片放在 "_未分类" 键下。
    """
    content = soup.select_one("#mw-content-text") or soup
    result: dict[str, list] = {}
    current_section = "_未分类"

    for elem in content.descendants:
        if not isinstance(elem, Tag):
            continue

        # 遇到 h2 更新当前章节
        if elem.name == "h2":
            text = elem.get_text(strip=True).replace("[编辑]", "").strip()
            if text and text != "目录":
                current_section = safe_name(text)
            continue

        # 遇到带 class="image" 的 <a> 标签
        if elem.name == "a" and "image" in (elem.get("class") or []):
            img = elem.find("img")
            if not img:
                continue
            src = img.get("src") or img.get("data-src") or ""
            if not src or "uploads" not in src:
                continue
            orig_url = thumb_to_original(src)
            # 文件名：取 URL 最后一段
            fname = urllib.parse.unquote(Path(urllib.parse.urlparse(orig_url).path).name)
            if not fname:
                continue
            result.setdefault(current_section, []).append((orig_url, fname))

    return result


def process_category(cat_name: str, path: str):
    print(f"\n{'='*55}")
    print(f"  分类: {cat_name}")
    print(f"{'='*55}")

    url  = BASE_WIKI + path
    soup = fetch_page(url)
    if not soup:
        return

    sections = extract_by_section(soup)
    if not sections:
        print("  [提示] 未找到 CG 图片，页面结构可能有变化")
        return

    total_dl = total_skip = 0

    for section, images in sections.items():
        dest_dir = OUTPUT_DIR / cat_name / section
        print(f"\n  章节: {section}  ({len(images)} 张)")
        for orig_url, fname in images:
            dest = dest_dir / fname
            ok = download(orig_url, dest)
            if ok:
                print(f"    ↓ {fname}")
                total_dl += 1
            else:
                total_skip += 1
            time.sleep(DELAY)

    print(f"\n  ── 完成: 新下载 {total_dl} 张，已跳过 {total_skip} 张 ──")


# ── 入口 ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    targets = sys.argv[1:]

    if targets:
        for t in targets:
            if t in CATEGORIES:
                process_category(t, CATEGORIES[t])
            else:
                available = "、".join(CATEGORIES.keys())
                print(f"[未知分类] '{t}'，可用: {available}")
    else:
        for name, path in CATEGORIES.items():
            process_category(name, path)
