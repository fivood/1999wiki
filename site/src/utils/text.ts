/** 从词条正文（Markdown 源码）提取纯文本摘要 */
export function excerpt(body: string | undefined, len = 90): string {
  if (!body) return '';
  const text = body
    .replace(/^---[\s\S]*?---/, '') // front matter（保险）
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接 → 文字
    .replace(/^#{1,6}\s*/gm, '') // 标题记号
    .replace(/[*_`>|-]{1,3}/g, '') // 强调/引用/列表记号
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > len ? text.slice(0, len) + '……' : text;
}

/** 词条 type 字段 → 中文标签 */
export const TYPE_LABELS: Record<string, string> = {
  character: '角色档案',
  summary: '剧情概要',
  worldview: '世界观',
  location: '地点',
  org: '组织',
  organization: '组织',
  anecdote: '轶事',
  theme: '主题',
};

/** 一级目录 → 导航/面包屑标签 */
export const CATEGORY_LABELS: Record<string, string> = {
  剧情概要: '剧情概要',
  角色: '角色',
  世界观: '世界观',
  组织: '组织',
  地点: '地点',
  轶事: '轶事',
  主题: '主题',
};

/** 走 [category] 通用路由的一级目录（剧情概要/角色有专属路由） */
export const FLAT_CATEGORIES = Object.keys(CATEGORY_LABELS).filter(
  (c) => !['剧情概要', '角色'].includes(c),
);

/** 分类索引页的英文标注与简介 */
export const CATEGORY_META: Record<string, { en: string; sub: string }> = {
  世界观: { en: 'Worldview · 设定', sub: '暴雨、神秘学、箱子与时代的运行机制。' },
  组织: { en: 'Organizations · 阵营', sub: '圣洛夫基金会、重塑之手，以及在时代缝隙中行动的诸方。' },
  地点: { en: 'Locations · 场域', sub: '从 1929 年的芝加哥到南极遗址城——剧情发生的地方。' },
  轶事: { en: 'Anecdotes · 拾遗', sub: '签到记录与边角的碎片。' },
  主题: { en: 'Themes · 主题', sub: '贯穿剧情的母题与分析。' },
};
