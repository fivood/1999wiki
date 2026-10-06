import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * wiki 词条集合：同步自 1999wiki 仓库的 wiki/ 目录。
 * generateId 保持「目录/文件名」原样（不去标点、不 slug 化），
 * 使路由与 Obsidian 内链目标（如 [[角色/司辰小队/维尔汀]]）一一对应。
 */
const wiki = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/wiki',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    type: z.string().optional(),
    title: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    sources: z.array(z.string()).optional(),
    updated: z.string().optional(),
  }),
});

export const collections = { wiki };
