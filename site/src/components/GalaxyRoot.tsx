/**
 * 宇宙页壳：Canvas + 左侧星图索引 + 档案卡 + 引线。
 * 所有分类页（/、/角色、/组织…）都挂这一个组件，只是初始区域不同；
 * 页内切换分类/词条全部是镜头飞行 + pushState，不刷新页面。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GalaxyScene from './GalaxyScene';
import type { Entry, UniverseData } from './GalaxyScene';
import EntryPanel from './EntryPanel';
import { getState, runtime, setState, subscribe, useGalaxy } from './galaxyStore';
import './galaxy.css';
import { BASE, segs } from '../utils/base';

/* ---------- URL ↔ 状态 ---------- */
function readUrl(cats: Set<string>) {
  const seg = segs(location.pathname)[0] ?? '';
  return {
    activeGroup: new URLSearchParams(location.search).get('group') ?? (cats.has(seg) ? seg : null),
    focusedId: new URLSearchParams(location.search).get('focus'),
  };
}
function writeUrl() {
  const { activeGroup, focusedId } = getState();
  const cat = activeGroup?.split('/')[0];
  const q = new URLSearchParams();
  if (activeGroup && activeGroup !== cat) q.set('group', activeGroup);
  if (focusedId) q.set('focus', focusedId);
  const url = BASE + (cat ? `/${cat}` : '/') + (q.size ? `?${q}` : '');
  if (url !== decodeURI(location.pathname) + location.search) history.pushState(null, '', url);
  document.querySelectorAll<HTMLAnchorElement>('.nav-links a').forEach((a) => {
    a.classList.toggle('active', decodeURI(a.pathname) === `${BASE}/${cat}`);
  });
}

/* ---------- 左侧星图索引：分类 → 星团 → 词条 ---------- */

/** 悬停菜单项：预览区域 + 把引线锚到场景里的目标 */
function hoverIn(el: HTMLElement, world: [number, number, number], patch: Parameters<typeof setState>[0]) {
  runtime.hoverAnchor = { el, world };
  setState(patch);
}
function hoverOut(patch: Parameters<typeof setState>[0]) {
  runtime.hoverAnchor = null;
  setState(patch);
}

/** 数字从 0 滚到目标值 */
function CountUp({ n }: { n: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      setV(Math.round(n * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n]);
  return <>{String(v).padStart(2, '0')}</>;
}

function Index({ data, onSelect }: { data: UniverseData; onSelect: (id: string) => void }) {
  const active = useGalaxy((s) => s.activeGroup);
  const preview = useGalaxy((s) => s.previewGroup);
  const focused = useGalaxy((s) => s.focusedId);
  const hovered = useGalaxy((s) => s.hoveredId);
  const [open, setOpen] = useState(() => innerWidth > 760); // 手机默认收起，别挡画面
  const activeCat = active?.split('/')[0] ?? null;

  const tree = useMemo(() => data.cats.map((c) => ({
    ...c,
    groups: data.groups.filter((g) => g.cat === c.id),
    // 00_序幕 < 01_第一章 < … 按数字序
    entries: data.entries.filter((e) => e.cat === c.id).sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true })),
  })), [data]);
  const max = Math.max(...data.cats.map((c) => c.count));

  // 场景里悬停的行星 → 菜单对应行滚入视野（悬停来自菜单本身时不滚）
  const listRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!hovered || runtime.hoverAnchor) return;
    listRef.current?.querySelector(`[data-id="${CSS.escape(hovered)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hovered]);

  const names = (list: Entry[]) => (
    <ul className="galaxy-org-names">
      {list.map((e, i) => (
        <li key={e.id} style={{ '--i': Math.min(i, 24) } as React.CSSProperties}>
          <button
            data-id={e.id}
            className={`galaxy-name ${focused === e.id ? 'selected' : ''} ${hovered === e.id ? 'hovered' : ''}`}
            onMouseEnter={(ev) => hoverIn(ev.currentTarget, e.pos, { hoveredId: e.id })}
            onMouseLeave={() => hoverOut({ hoveredId: null })}
            onClick={() => onSelect(e.id)}
          >
            <span className="galaxy-name-text">{e.title}</span>
            {e.aliases[0] && <span className="galaxy-name-alias">{e.aliases[0]}</span>}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <nav ref={listRef} className={`galaxy-orgs ${open ? '' : 'collapsed'}`} aria-label="档案索引">
      <button className="galaxy-index-toggle" onClick={() => setOpen(!open)}>
        <span className="ico" aria-hidden>{open ? '−' : '+'}</span>{open ? '收起索引' : '档案索引'}
      </button>
      {open && tree.map((c, ci) => {
        const here = activeCat === c.id;
        const multi = c.groups.length > 1;
        return (
          <div key={c.id} className="galaxy-org-block">
            <button
              className={`galaxy-org ${here ? 'active' : ''} ${preview === c.id ? 'preview' : ''}`}
              style={{ '--i': ci, '--w': `${Math.max(6, (c.count / max) * 22)}px` } as React.CSSProperties}
              onMouseEnter={(ev) => hoverIn(ev.currentTarget, c.center, { previewGroup: c.id })}
              onMouseLeave={() => hoverOut({ previewGroup: null })}
              onClick={() => { hoverOut({ previewGroup: null }); setState({ activeGroup: here && active === c.id ? null : c.id, focusedId: null }); }}
            >
              <span className="swatch" />
              <span className="label">{c.id}</span>
              <span className="count"><CountUp n={c.count} /></span>
            </button>
            {here && !multi && names(c.entries)}
            {here && multi && c.groups.map((g, gi) => (
              <div key={g.key} className="galaxy-sub-block">
                <button
                  className={`galaxy-sub ${active === g.key ? 'active' : ''}`}
                  style={{ '--i': gi } as React.CSSProperties}
                  onMouseEnter={(ev) => hoverIn(ev.currentTarget, g.center, { previewGroup: g.key })}
                  onMouseLeave={() => hoverOut({ previewGroup: null })}
                  onClick={() => { hoverOut({ previewGroup: null }); setState({ activeGroup: active === g.key ? c.id : g.key, focusedId: null }); }}
                >
                  <span>{g.sub || '主篇'}</span>
                  <span className="count">{g.count}</span>
                </button>
                {active === g.key && names(c.entries.filter((e) => e.group === g.key))}
              </div>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

/** 菜单悬停项 → 场景目标的金色引线 */
function HoverLeader() {
  const svg = useRef<SVGSVGElement>(null);
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  useEffect(() => {
    let raf = 0;
    let last: HTMLElement | null = null;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const a = runtime.hoverAnchor, s = runtime.hoverScreen, el = svg.current!;
      if (!a || !s.visible || !a.el.isConnected) { el.classList.remove('on'); last = null; return; }
      // 换了一个悬停项：摘掉 on 再加回，让描线动画重播
      if (a.el !== last) { el.classList.remove('on'); void el.getBoundingClientRect(); last = a.el; }
      const r = a.el.getBoundingClientRect();
      // 顶栏链接从下边缘出线，菜单项从右边缘出线
      const fromNav = !!a.el.closest('.nav');
      const x0 = fromNav ? r.left + r.width / 2 : r.right + 6;
      const y0 = fromNav ? r.bottom + 4 : r.top + r.height / 2;
      const c1 = fromNav ? `${x0} ${y0 + 80}` : `${x0 + 80} ${y0}`;
      path.current!.setAttribute('d', `M ${x0} ${y0} C ${c1}, ${s.x} ${s.y - 60}, ${s.x} ${s.y}`);
      dot.current!.setAttribute('cx', String(s.x));
      dot.current!.setAttribute('cy', String(s.y));
      el.classList.add('on');
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <svg ref={svg} className="galaxy-leader" aria-hidden="true">
      <path ref={path} pathLength={1} />
      <circle ref={dot} r="4" />
    </svg>
  );
}

/* ---------- 星体 → 档案卡的引线 ---------- */
function PointerLine() {
  const svg = useRef<SVGSVGElement>(null);
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const bracket = useRef<SVGPathElement>(null);
  const focused = useGalaxy((s) => s.focusedId);

  useEffect(() => {
    const el = svg.current!;
    el.style.opacity = '0';
    if (!focused) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { x, y, visible } = runtime.focusedScreen;
      const panel = document.querySelector<HTMLElement>('.galaxy-panel.open');
      if (!visible || !panel) { el.style.opacity = '0'; return; }
      const r = panel.getBoundingClientRect();
      const lx = r.left, ly = r.top + Math.min(r.height * 0.22, 130);
      path.current!.setAttribute('d', `M ${x} ${y} Q ${x + (lx - x) * 0.55} ${y + (ly - y) * 0.35} ${lx} ${ly}`);
      dot.current!.setAttribute('cx', String(x));
      dot.current!.setAttribute('cy', String(y));
      bracket.current!.setAttribute('transform', `translate(${lx} ${ly})`);
      el.style.opacity = '1';
    };
    tick();
    return () => { cancelAnimationFrame(raf); el.style.opacity = '0'; };
  }, [focused]);

  return (
    <svg ref={svg} className="galaxy-pointer" aria-hidden="true">
      <path ref={path} className="galaxy-pointer-path" />
      <circle ref={dot} className="galaxy-pointer-dot" r="3.5" />
      <path ref={bracket} className="galaxy-pointer-bracket" d="M 0 -10 L -6 -10 L -6 10 L 0 10" />
    </svg>
  );
}

function Breadcrumb() {
  const active = useGalaxy((s) => s.activeGroup);
  const focused = useGalaxy((s) => s.focusedId);
  return (
    <div className="galaxy-title">
      <span className="en">Reverse : 1999 · Archive Index</span>
      <button className="zh" onClick={() => setState({ activeGroup: null, focusedId: null })}>暴雨档案馆</button>
      <span className="sub">
        {active ? active.split('/').join(' · ') : '全景 · 以司辰为原点'}
        {focused && ` · ${focused.split('/').pop()}`}
      </span>
    </div>
  );
}

export default function GalaxyRoot({ data, region = null }: { data: UniverseData; region?: string | null }) {
  const byId = useMemo(() => new Map(data.entries.map((e) => [e.id, e])), [data.entries]);
  const cats = useMemo(() => new Set(data.cats.map((c) => c.id)), [data.cats]);

  // 首次挂载前就把 URL 状态写进 store，镜头首帧直接就位
  useState(() => {
    const u = readUrl(cats);
    setState({ activeGroup: u.activeGroup ?? region, focusedId: u.focusedId && byId.has(u.focusedId) ? u.focusedId : null });
  });

  const select = useCallback((id: string) => setState({ focusedId: id, hoveredId: null }), []);
  const close = useCallback(() => setState({ focusedId: null }), []);

  useEffect(() => {
    // ResizeObserver 在部分环境首次不触发，补一次
    const t = setTimeout(() => dispatchEvent(new Event('resize')), 60);
    const onPop = () => setState(readUrl(cats));
    // 顶栏分类链接：在宇宙里改成飞行而不是换页
    const onNav = (ev: MouseEvent) => {
      const a = (ev.target as HTMLElement).closest<HTMLAnchorElement>('.nav a');
      if (!a || a.origin !== location.origin || ev.metaKey || ev.ctrlKey) return;
      const seg = segs(a.pathname);
      if (seg.length > 1 || (seg[0] && !cats.has(seg[0]))) return;
      ev.preventDefault();
      setState({ activeGroup: seg[0] ?? null, focusedId: null });
    };
    // 顶栏链接悬停：同样预览对应星系 + 引线
    const onNavHover = (ev: MouseEvent) => {
      const a = (ev.target as HTMLElement).closest<HTMLAnchorElement>('.nav-links a');
      const seg = a ? segs(a.pathname)[0] : null;
      const c = seg ? data.cats.find((x) => x.id === seg) : null;
      if (a && c) { runtime.hoverAnchor = { el: a, world: c.center }; setState({ previewGroup: c.id }); }
      else if (runtime.hoverAnchor?.el.closest('.nav')) { runtime.hoverAnchor = null; setState({ previewGroup: null }); }
    };
    document.addEventListener('mouseover', onNavHover);
    addEventListener('popstate', onPop);
    document.addEventListener('click', onNav, true);
    return () => { clearTimeout(t); removeEventListener('popstate', onPop); document.removeEventListener('click', onNav, true); document.removeEventListener('mouseover', onNavHover); };
  }, [cats, data.cats]);

  // 任何区域/聚焦变化都写回 URL（popstate 回放时 URL 已一致，writeUrl 不会重复 push）
  useEffect(() => {
    const key = () => `${getState().activeGroup}|${getState().focusedId}`;
    let last = key();
    return subscribe(() => { if (key() !== last) { last = key(); writeUrl(); } });
  }, []);

  return (
    <div className="galaxy-stage">
      <GalaxyScene data={data} onSelect={select} />
      <Breadcrumb />
      <Index data={data} onSelect={select} />
      <Hint />
      <PointerLine />
      <HoverLeader />
      <EntryPanel byId={byId} onSelect={select} onClose={close} />
    </div>
  );
}

function Hint() {
  const focused = useGalaxy((s) => s.focusedId);
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 800); return () => clearTimeout(t); }, []);
  if (focused) return null;
  return (
    <div className={`galaxy-hint ${show ? 'show' : ''}`}>
      <span className="dot" />
      <span>悬停辨认 · 点击词条阅读 · 点击分类名进入 · ESC 返回</span>
    </div>
  );
}
