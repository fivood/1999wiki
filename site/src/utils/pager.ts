import type { CollectionEntry } from 'astro:content';
import { BASE } from './base';

/** 同目录内的上一篇/下一篇（按 id 排序） */
export function siblings(entries: CollectionEntry<'wiki'>[], id: string) {
  const dir = id.split('/').slice(0, -1).join('/');
  const sibs = entries
    .filter((e) => e.id.split('/').slice(0, -1).join('/') === dir)
    .sort((a, b) => a.id.localeCompare(b.id, 'zh'));
  const i = sibs.findIndex((e) => e.id === id);
  const toPager = (e?: CollectionEntry<'wiki'>) =>
    e ? { href: BASE + '/' + e.id, title: (e.data.title ?? e.id.split('/').pop()) as string } : null;
  return { prev: toPager(sibs[i - 1]), next: toPager(sibs[i + 1]) };
}
