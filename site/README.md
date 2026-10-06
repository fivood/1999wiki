# 暴雨档案馆 · The Storm Archive

> 《重返未来：1999》（Reverse: 1999）剧情 wiki 的沉浸式前端 —— 整个 wiki 是一个宇宙：分类是星系，词条是行星，内链是星轨，维尔汀是坐标原点。
>
> **在线访问**：https://1999site.pages.dev/archive/（与 wiki 合为一个站点，wiki 在根路径）
> **内容源**：同仓库根目录 `wiki/`（原独立仓库 fivood/1999site 已并入本仓库 `site/`）

---

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Astro 7（SSG，Content Collections，View Transitions） |
| 3D | three.js + @react-three/fiber（宇宙场景、金色漩涡核心、主线金线、星轨连线） |
| 后处理 | @react-three/postprocessing（景深对焦镜头注视点 + Bloom + Vignette） |
| 动效 | GSAP（全景 / 星系 / 词条三级镜头飞行） |
| 部署 | Cloudflare Pages（GitHub Actions + wrangler-action） |

词条内容是带 YAML front-matter 的 Markdown（Obsidian 风格 `[[内链]]`），
构建前由 `scripts/sync-content.mjs` 同步并把内链改写为标准 Markdown 链接，
再由 `scripts/build-universe.mjs` 从目录结构派生宇宙布局与连线（新增分类/词条自动入轨，无手写坐标）。

## 本地开发

本目录是 1999wiki 仓库的子项目，构建统一走仓库根：

```bash
# 仓库根执行
npm run setup      # 安装 web/ 与 site/ 依赖
npm run build      # site sync → web build → astro build，产物全在 web/dist（本站在 web/dist/archive）
npm run dev:site   # 只调试 3D 站（同步词条 + astro dev，访问 /archive/）
```

站点挂载的子路径由 `site-base.mjs` 的 `BASE` 统一决定（astro base/outDir、内链改写、组件路径都读它）。
内容源默认读仓库根 `wiki/`，也可用环境变量 `WIKI_SRC` 指向别处。

角色立绘（`public/portraits/*.webp` + `index.json`，入库）由一次性脚本从仓库根 `raw/立绘` 批量生成
（复用 `web/node_modules` 的 sharp）：

```bash
node scripts/make-portraits.cjs
```

## 部署（Cloudflare Pages）

由仓库根 `.github/workflows/deploy.yml` 负责：push 到 `main`（或手动 `workflow_dispatch`）即构建整站并部署到 Pages 项目 `1999site`。
需要在 **1999wiki 仓库** 的 Settings → Secrets and variables → Actions 配置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。

## 目录结构

```
site/
├── scripts/
│   ├── sync-content.mjs    # 词条同步 + [[内链]] 改写 + ids 清单
│   ├── build-universe.mjs  # 目录结构 → 宇宙布局 / 连线 / 单条正文 json
│   ├── make-portraits.cjs  # 一次性：raw/立绘 → webp + 清单（产物入库）
│   └── fetch-wallpapers.mjs # 官网壁纸增量抓取（wallpapers/，不入库）
├── src/
│   ├── content.config.ts   # wiki 集合（glob loader，id 保持路径原样）
│   ├── components/
│   │   ├── GalaxyScene.tsx # 宇宙场景：星系 / 轨道 / 行星 / 金色漩涡 / 主线金线 / 景深
│   │   ├── GalaxyRoot.tsx  # 页壳：星图索引 / URL 同步 / 引线
│   │   ├── EntryPanel.tsx  # 档案卡（按需拉正文，内链飞往对应星体）
│   │   ├── galaxyStore.ts  # 场景 ↔ DOM 共享状态
│   │   └── WikiArticle.astro  # 词条单页（SEO / 无 JS 回退）
│   ├── layouts/            # Base 骨架 + Universe（所有分类首页共用）
│   ├── pages/              # 分类首页 = 同一宇宙不同初始镜头；词条单页静态生成
│   ├── styles/global.css   # 设计系统
│   └── utils/              # 摘要提取 / 上一篇下一篇 / base 路径
└── site-base.mjs           # 挂载子路径（/archive）唯一来源
```

## 版权声明

站点代码 MIT。词条内容整理自《重返未来：1999》游戏剧情，
所有角色、剧情及世界观设定版权归 **深蓝互动 BLUEPOCH** 所有，仅供同人创作参考。
