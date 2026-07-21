# 1999story Wiki 项目说明

## 项目目的

《重返未来：1999》剧情 wiki，最终服务于用户写**塞梅尔维斯 × 瓦伦缇娜**的 CP 同人文（最高优先级）。

## 目录结构

- `raw/` — 游戏原始素材（角色档案、活动剧情、小径碎片、沙盘解构、立绘）
- `wiki/` — 整理后的 wiki 条目（Markdown），按 角色/剧情概要/世界观/组织/地点/轶事 分类
- `web/` — 静态站点构建器（`node web/build.js` 生成 `web/dist/`）

构建命令：`node web/build.js`

### Web 双主题（重要）

站点有两套**互斥加载**的完整样式表，页头按钮即时切换，`localStorage('wiki-theme')` 记忆：

- `web/style.css` — **经典版**（原浅色报纸风）
- `web/pixel.css` — **像素版**（默认，深色复古黑白终端风，含 CRT 扫描线/滚动浮现等动效）

注意：pixel.css 是独立全量样式（不叠加在 style.css 上），改动经典版不会自动同步到像素版；
新增模板元素需同时考虑两套样式，像素版专属装饰元素用 `.px-*` 类并在 style.css 中隐藏。

## 模型自动路由（重要）

项目默认模型已设为 **Sonnet 4.6**（见 `.Codex/settings.json`）。处理用户请求时按以下规则判断是否升级：

### 直接 Sonnet 处理（默认）
- 加新词条（按既有模板把 raw 整理成 wiki）
- 修改 build.js / style.css 的局部调整
- 简单的引号/标点/格式修复
- 文件移动、批量重命名、git 操作
- 索引补更、单个章节扩写
- 上述任务可直接做，或主动 spawn `wiki-ingest` subagent

### Spawn `wiki-deep` subagent（Opus）
触发关键词或场景：
- 用户说"**核查 / 对照 / 查错 / 真实性 / 准确性 / 矛盾**"
- 涉及**跨 3 个以上 raw 文件**的综合判断
- 涉及哲学流派 / 历史年代 / 文学典故的**学术性归属**
- 涉及**塞梅尔维斯 / 瓦伦缇娜 / 贝拉 / 黄昏的音序**的 CP 描写或同人创作
- 用户要求"**写一段 / 模仿我的写法 / 用五木的文风 / 润色**"
- 需要做**结构性重构判断**（如重新分类、目录调整）

### 用户明确指定时
- `/model opus` 或 `/model sonnet` 显式切换，遵从用户指定
- 单条请求里说"用 Opus" / "用 Sonnet"，遵从

## Wiki 维护铁律

1. **YAML front-matter 完整**：type / title / aliases / tags / sources / updated
2. **角色页路径必须匹配立绘**：`wiki/角色/{org}/{charName}.md` 与 `raw/立绘/{org}/{charName}/` 同 org
3. **单品加粗内容 = 图片文件名 stem**：含全角/半角标点必须一致，否则 inline 图片注入失败
4. **中文引号**：用 `“ ”`，不要用 ASCII `"`，不要反向 `”X“`
5. **主线章节 H1**：用游戏菜单名（"第N章：菜单名"），不用 Arc 副题
6. **CP 相关**：剧情准确性 > 一切，疑问就核查 raw

## Git 工作流偏好

- **直接合并进 main**，不走分支+PR 流程
- 每次任务结束 commit + push
- commit message 第一行 ≤72 字符，正文用清晰条目列改动

## 五木文风（CP 创作时）

调用 `anthropic-skills:semmelweis-valentina-style` skill，遵循冷幽默 / 英式克制 / 双线对位 / 五木文风规范。**结局4为正典**。
