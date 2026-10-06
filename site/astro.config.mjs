// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { BASE } from './site-base.mjs';

export default defineConfig({
  site: 'https://1999site.pages.dev',
  // 与 wiki 合并为一个站点：本站挂在 BASE 子路径，直接输出进 wiki 的 dist（根 npm run build 一次构建）
  base: BASE,
  outDir: '../web/dist' + BASE,
  integrations: [react()],
});
