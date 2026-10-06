/**
 * 宇宙视图共享状态：HUD/面板（DOM）↔ Canvas 内组件。极简订阅式 store。
 */
import { useEffect, useState } from 'react';

export interface GalaxyState {
  hoveredId: string | null;
  focusedId: string | null;
  /** 当前区域：分类（"角色"）或星团（"角色/司辰小队"）；null = 全景 */
  activeGroup: string | null;
  /** 菜单悬停预览的区域：只改高亮，不动镜头 */
  previewGroup: string | null;
}

type Listener = (s: GalaxyState) => void;

const state: GalaxyState = { hoveredId: null, focusedId: null, activeGroup: null, previewGroup: null };
const listeners = new Set<Listener>();

export const getState = (): GalaxyState => ({ ...state });

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setState(patch: Partial<GalaxyState>) {
  let changed = false;
  for (const k of Object.keys(patch) as (keyof GalaxyState)[]) {
    if (state[k] !== patch[k]) { (state as any)[k] = patch[k]; changed = true; }
  }
  if (changed) listeners.forEach((f) => f({ ...state }));
}

export function useGalaxy<T>(selector: (s: GalaxyState) => T): T {
  const [v, setV] = useState<T>(() => selector(state));
  useEffect(() => subscribe((s) => setV(selector(s))), []);
  return v;
}

/** 词条是否属于某区域（分类或星团） */
export const inGroup = (e: { cat: string; group: string }, g: string | null) => !g || e.cat === g || e.group === g;

/** 每帧变化的值，不走 React：场景 useFrame 写，DOM rAF 读 */
export const runtime = {
  focusedScreen: { x: 0, y: 0, visible: false },
  /** 菜单悬停项 → 场景里的世界坐标；场景投影成 hoverScreen，DOM 画引线 */
  hoverAnchor: null as null | { el: HTMLElement; world: [number, number, number] },
  hoverScreen: { x: 0, y: 0, visible: false },
};

/** 高亮用的区域：预览优先于当前区域 */
export const viewGroup = (s: GalaxyState) => s.previewGroup ?? s.activeGroup;
