/**
 * 词条档案卡：浮在右侧、2/3 屏高，指向聚焦的星体。
 * 正文按需 fetch（public/data/entry/<file>），marked 渲染；
 * 正文里指向其他词条的链接 → 飞往那颗星，而不是跳页。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BASE, segs } from '../utils/base';
import { marked } from 'marked';
import { useGalaxy } from './galaxyStore';
import type { Entry } from './GalaxyScene';

interface Detail {
  id: string; title: string; cat: string; sub: string;
  aliases: string[]; tags: string[]; sources: string[];
  updated: string | null; portrait: string | null; body: string;
}

function fileNo(id: string) {
  let h = 0;
  for (const ch of id) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return String(Math.abs(h) % 1000).padStart(3, '0');
}

interface Props {
  byId: Map<string, Entry>;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function EntryPanel({ byId, onSelect, onClose }: Props) {
  const focused = useGalaxy((s) => s.focusedId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setErr(null);
    const e = focused ? byId.get(focused) : null;
    if (!e) return; // 关闭时保留旧内容，让滑出动画不闪白
    const ctl = new AbortController();
    fetch(`${BASE}/data/entry/${e.file}`, { signal: ctl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: Detail) => { setDetail(d); bodyRef.current?.scrollTo(0, 0); })
      .catch((x) => { if (x.name !== 'AbortError') { setDetail(null); setErr(`${e.file}：${x.message}`); } });
    return () => ctl.abort();
  }, [focused, byId, retry]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && focused) onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [focused, onClose]);

  const html = useMemo(
    () => (detail ? (marked.parse(detail.body.replace(/^\s*#\s+.*$/m, '').trimStart()) as string) : ''),
    [detail],
  );

  // 内链 → 飞往对应星体；非词条链接照常
  const onBodyClick = (ev: React.MouseEvent) => {
    const a = (ev.target as HTMLElement).closest('a');
    if (!a) return;
    let id = a.getAttribute('href') ?? '';
    try { id = segs(id).join('/'); } catch { return; }
    if (byId.has(id)) { ev.preventDefault(); onSelect(id); }
  };

  const open = !!focused;
  const stale = detail && detail.id !== focused;

  return (
    <aside className={`galaxy-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
      <button className="galaxy-panel-close" aria-label="关闭" onClick={onClose}>✕</button>
      <div className="galaxy-panel-card">
        <span className="galaxy-panel-corner tl" /><span className="galaxy-panel-corner tr" />
        <span className="galaxy-panel-corner bl" /><span className="galaxy-panel-corner br" />
        <div className={`galaxy-panel-scroll ${stale ? 'stale' : ''}`} ref={bodyRef}>
          {!detail && !err && open && <div className="galaxy-panel-loading">读取档案…</div>}
          {err && (
            <div className="galaxy-panel-error">
              档案读取失败
              <div className="galaxy-panel-error-msg">{err}</div>
              <button className="galaxy-panel-retry" onClick={() => setRetry((n) => n + 1)}>重试</button>
            </div>
          )}
          {detail && (
            <>
              <header className="galaxy-panel-head">
                <div className="galaxy-panel-topline">
                  <span className="galaxy-panel-fileid">档案 · {detail.cat.slice(0, 2)}-{fileNo(detail.id)}</span>
                  <span className="galaxy-panel-org">{[detail.cat, detail.sub].filter(Boolean).join(' / ')}</span>
                </div>
                <h2 className="galaxy-panel-name">{detail.title}</h2>
                {detail.aliases.length > 0 && <p className="galaxy-panel-alias">{detail.aliases.join(' · ')}</p>}
                {detail.portrait && (
                  <div className="galaxy-panel-portrait">
                    <img src={BASE + detail.portrait} alt={detail.title} loading="lazy" />
                  </div>
                )}
                <div className="galaxy-panel-meta">
                  {detail.sources.length > 0 && <span><em>登场</em>{detail.sources.length} 场次</span>}
                  {detail.updated && <span><em>更新</em>{detail.updated}</span>}
                  <a className="galaxy-panel-permalink" href={`${BASE}/${detail.id}`}>单页打开 →</a>
                </div>
              </header>
              <div className="galaxy-panel-body" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
