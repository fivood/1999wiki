"""
fetch_cg.py — 从灰机wiki抓取重返未来:1999 CG图片
用法：python tools/fetch_cg.py [分类名 ...]
不带参数则抓取所有分类。

示例：
  python tools/fetch_cg.py 主线剧情
  python tools/fetch_cg.py 主线剧情 角色故事
  python tools/fetch_cg.py 活动剧情
  python tools/fetch_cg.py          # 全部抓取

输出目录：
  raw/CG/主线剧情/<章节>/文件名.png
  raw/CG/角色故事/<角色名>/文件名.png
  raw/CG/活动剧情/<版本号>/文件名.png   （如 1.1, 1.2 … 3.4）

说明：
  - 主线剧情、角色故事：单页，按 h2 标题分章节/角色
  - 活动剧情：多子页（/1.1, /1.2, …），按版本号分目录，自动探测现有版本
  - 维也纳拾遗、嗡鸣的往昔：wiki 暂无独立 CG 页，待补充
"""

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

# 单页分类：直接抓一张页面，按 h2 分节
SINGLE_PAGE_CATEGORIES = {
    "主线剧情": "/wiki/CG/主线剧情",
    "角色故事": "/wiki/CG/角色故事",
}

# 活动剧情版本列表（1.1 起，遇连续 3 个 404 自动停止）
ACTIVITY_VERSION_START = (1, 1)
ACTIVITY_VERSION_MAX   = (9, 9)   # 安全上限

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


def fetch_status(url: str) -> int:
    """只获取 HTTP 状态码，不抛异常。"""
    try:
        r = SCRAPER.get(url, timeout=15)
        return r.status_code
    except Exception:
        return 0


def thumb_to_original(src: str) -> str:
    """
    缩略图 URL → 原图 URL

    输入:  https://huiji-thumb.huijistatic.com/res1999/uploads/thumb/3/30/Cg-xxx.png/500px-Cg-xxx.png
    输出:  https://huiji-public.huijistatic.com/res1999/uploads/3/30/Cg-xxx.png
    """
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

        if elem.name == "h2":
            text = elem.get_text(strip=True).replace("[编辑]", "").strip()
            if text and text != "目录":
                current_section = safe_name(text)
            continue

        if elem.name == "a" and "image" in (elem.get("class") or []):
            img = elem.find("img")
            if not img:
                continue
            src = img.get("src") or img.get("data-src") or ""
            if not src or "uploads" not in src:
                continue
            orig_url = thumb_to_original(src)
            fname = urllib.parse.unquote(Path(urllib.parse.urlparse(orig_url).path).name)
            if not fname:
                continue
            result.setdefault(current_section, []).append((orig_url, fname))

    return result


def process_single_page(cat_name: str, path: str):
    """抓取单页分类（主线剧情、角色故事）。"""
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


def discover_activity_versions() -> list[str]:
    """
    自动探测活动剧情存在的版本子页（/1.1, /1.2 …）。
    遇到连续 3 个 404 则认为已到末尾，停止探测。
    """
    print("  [探测] 正在发现活动剧情各版本子页…")
    versions = []
    miss = 0
    major, minor = ACTIVITY_VERSION_START
    max_major, max_minor = ACTIVITY_VERSION_MAX

    while (major, minor) <= (max_major, max_minor):
        ver = f"{major}.{minor}"
        url = f"{BASE_WIKI}/wiki/CG/%E6%B4%BB%E5%8A%A8%E5%89%A7%E6%83%85/{ver}"
        status = fetch_status(url)
        if status == 200:
            versions.append(ver)
            miss = 0
            print(f"    ✓ {ver}")
        else:
            miss += 1
            if miss >= 3:
                break
        # 递增版本号
        minor += 1
        if minor > 9:
            minor = 0
            major += 1

    return versions


def process_activity():
    """抓取活动剧情（多版本子页）。"""
    print(f"\n{'='*55}")
    print(f"  分类: 活动剧情")
    print(f"{'='*55}")

    versions = discover_activity_versions()
    if not versions:
        print("  [提示] 未发现任何活动剧情子页")
        return

    print(f"\n  共发现 {len(versions)} 个版本: {', '.join(versions)}")

    total_dl = total_skip = 0
    for ver in versions:
        url  = f"{BASE_WIKI}/wiki/CG/%E6%B4%BB%E5%8A%A8%E5%89%A7%E6%83%85/{ver}"
        soup = fetch_page(url)
        if not soup:
            continue

        # 活动剧情子页通常无 h2，images 全在 _未分类；直接平铺到版本目录
        sections = extract_by_section(soup)
        images_all = []
        for imgs in sections.values():
            images_all.extend(imgs)

        if not images_all:
            continue

        dest_dir = OUTPUT_DIR / "活动剧情" / ver
        print(f"\n  版本: {ver}  ({len(images_all)} 张)")
        for orig_url, fname in images_all:
            dest = dest_dir / fname
            ok = download(orig_url, dest)
            if ok:
                print(f"    ↓ {fname}")
                total_dl += 1
            else:
                total_skip += 1
            time.sleep(DELAY)

    print(f"\n  ── 活动剧情完成: 新下载 {total_dl} 张，已跳过 {total_skip} 张 ──")


# ── 入口 ─────────────────────────────────────────────────────────────────────

ALL_NAMES = list(SINGLE_PAGE_CATEGORIES.keys()) + ["活动剧情"]

if __name__ == "__main__":
    targets = sys.argv[1:]

    if not targets:
        targets = ALL_NAMES

    for t in targets:
        if t == "活动剧情":
            process_activity()
        elif t in SINGLE_PAGE_CATEGORIES:
            process_single_page(t, SINGLE_PAGE_CATEGORIES[t])
        else:
            print(f"[未知分类] '{t}'，可用: {'、'.join(ALL_NAMES)}")
