/* ── 彩蛋「暴雨」：1999site（暴雨档案馆）的宇宙星图在本站浮现 ──
   数据 = build 时从 ../1999site 的 universe.json 压缩出的 storm.json（同一份 wiki 的 3D 布局）。
   原点金色漩涡 = 维尔汀；主线章节串成金线；内链为星轨；雨向上落（暴雨）。
   点星体进入本站对应词条——不跳转到 1999site。仅在触发时由 template 动态加载。 */
(function () {
  const INK = '#010204', PAPER = '230,226,214', GOLD = '224,185,104';
  let open = false;

  window.pxStorm = async function (root, onFail, onClose) {
    if (open) return;
    let data;
    try {
      const r = await fetch(root + 'storm.json');
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
    } catch (e) { if (onFail) onFail(); return; }
    open = true;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!document.getElementById('pxStormCss')) {
      const st = document.createElement('style');
      st.id = 'pxStormCss';
      st.textContent = `
.px-storm { position: fixed; inset: 0; z-index: 10000; background: ${INK}; color: rgb(${PAPER});
  font-family: 'Space Mono', 'Noto Sans SC', monospace; opacity: 0; transition: opacity .6s ease; cursor: grab; }
.px-storm.on { opacity: 1; }
.px-storm.grab { cursor: grabbing; }
.px-storm.hot { cursor: pointer; }
.px-storm canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.px-storm-cap { position: absolute; left: 28px; top: 24px; pointer-events: none; }
.px-storm-cap b { display: block; font-size: 15px; letter-spacing: 6px; color: rgb(${GOLD}); }
.px-storm-cap span { display: block; margin-top: 6px; font-size: 11px; letter-spacing: 2px; opacity: .6; }
.px-storm-hint { position: absolute; left: 28px; bottom: 22px; font-size: 11px; letter-spacing: 2px; opacity: .45; pointer-events: none; }
.px-storm-x { position: absolute; right: 24px; top: 20px; font: inherit; font-size: 12px; letter-spacing: 2px;
  color: rgb(${PAPER}); background: none; border: 1px solid rgba(${PAPER},.4); padding: 6px 12px; cursor: pointer; }
.px-storm-x:hover, .px-storm-x:focus-visible { border-color: rgb(${GOLD}); color: rgb(${GOLD}); }`;
      document.head.appendChild(st);
    }
    const ov = document.createElement('div');
    ov.className = 'px-storm';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', '暴雨档案馆星图');
    ov.innerHTML = '<canvas></canvas>'
      + '<div class="px-storm-cap"><b>暴雨档案馆 · THE STORM ARCHIVE</b>'
      + `<span>同一份档案的另一种显影 — ${data.e.length} 颗星 · ${data.l.length} 条星轨</span></div>`
      + '<div class="px-storm-hint">拖动旋转 · 滚轮缩放 · 点星体前往词条 · Esc 离开</div>'
      + '<button type="button" class="px-storm-x">✕ 雨停</button>';
    document.body.appendChild(ov);
    const cv = ov.querySelector('canvas'), ctx = cv.getContext('2d');
    requestAnimationFrame(() => ov.classList.add('on'));
    ov.querySelector('.px-storm-x').focus({ preventScroll: true });

    let W = 0, H = 0, F = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = innerWidth; H = innerHeight; F = Math.min(W, H) * 1.5;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener('resize', resize);

    /* 视角：yaw 绕 y 自转、pitch 俯视星盘；透视相机距原点 D */
    const D = 420;
    let yaw = 0.6, pitch = 0.42, zoom = 1;
    const proj = (x, y, z) => {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
      const y2 = y * cp + z1 * sp, d = D + z1 * cp - y * sp;
      const k = F / Math.max(40, d) * zoom;
      return [W / 2 + x1 * k, H / 2 - y2 * k, k, d];
    };

    /* 主线金线：原点 → 序幕 → 各章（e[7] = 章节序号+1） */
    const chain = data.e.map((e, i) => i).filter(i => data.e[i][7]).sort((a, b) => data.e[a][7] - data.e[b][7]);
    /* 漩涡粒子：XZ 平面对数螺线，内快外慢 */
    const swirl = Array.from({ length: 180 }, (_, i) => ({ a: i * 2.399, r: 1.5 + Math.pow(i / 180, 1.6) * 34 }));
    /* 向上的雨 */
    const rain = Array.from({ length: 150 }, () => ({ x: Math.random(), y: Math.random(), l: 8 + Math.random() * 22, v: 0.25 + Math.random() * 0.5 }));

    let P = [], hover = -1, drag = null, t0 = performance.now(), last = t0, raf = 0;
    function frame(now) {
      const t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!drag && !reduce) yaw += dt * 0.05;
      const rise = reduce ? 1 : Math.min(1, Math.max(0, (t - 0.5) / 1.4));   /* 雨先落，星后显 */
      const ease = 1 - Math.pow(1 - rise, 3);

      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      /* 雨：开场密集，随后稀疏留在背景 */
      const rainA = reduce ? 0.08 : 0.08 + 0.3 * Math.max(0, 1 - t / 2);
      ctx.strokeStyle = `rgba(${PAPER},${rainA})`; ctx.lineWidth = 1; ctx.beginPath();
      for (const d of rain) {
        if (!reduce) { d.y -= d.v * dt; if (d.y < -0.05) { d.y = 1.05; d.x = Math.random(); } }
        const x = d.x * W, y = d.y * H;
        ctx.moveTo(x, y); ctx.lineTo(x, y + d.l);
      }
      ctx.stroke();

      /* 星体投影（由原点向外展开） */
      P = data.e.map(e => proj(e[0] * ease, e[1] * ease, e[2] * ease));
      /* 星轨 */
      ctx.strokeStyle = `rgba(${PAPER},${0.05 * ease})`; ctx.beginPath();
      for (const [i, j] of data.l) { ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]); }
      ctx.stroke();
      /* 主线金线 */
      const o = proj(0, 0, 0);
      ctx.strokeStyle = `rgba(${GOLD},${0.55 * ease})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(o[0], o[1]);
      for (const i of chain) ctx.lineTo(P[i][0], P[i][1]);
      ctx.stroke(); ctx.lineWidth = 1;

      /* 原点漩涡（维尔汀 / 时间轴 0） */
      const g = ctx.createRadialGradient(o[0], o[1], 0, o[0], o[1], 46 * o[2]);
      g.addColorStop(0, `rgba(${GOLD},.55)`); g.addColorStop(1, `rgba(${GOLD},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o[0], o[1], 46 * o[2], 0, 7); ctx.fill();
      for (const s of swirl) {
        const a = s.a + t * 1.6 / (1 + s.r * 0.12);
        const q = proj(Math.cos(a) * s.r, 0, Math.sin(a) * s.r);
        ctx.fillStyle = `rgba(${GOLD},${(1 - s.r / 36) * 0.85})`;
        ctx.fillRect(q[0] - 0.8, q[1] - 0.8, 1.6, 1.6);
      }
      ctx.fillStyle = `rgba(${GOLD},.8)`; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('维尔汀 · 0', o[0], o[1] + 34 * o[2] + 14);

      /* 星体：远→近绘制 */
      const order = P.map((p, i) => i).sort((a, b) => P[b][3] - P[a][3]);
      for (const i of order) {
        const e = data.e[i], p = P[i];
        const r = Math.max(1.1, e[3] * p[2] * 2.2);
        const fog = Math.max(0.25, Math.min(1, 1.6 - p[3] / D));
        ctx.fillStyle = e[7] ? `rgba(${GOLD},${fog * ease})` : `rgba(${PAPER},${0.85 * fog * ease})`;
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill();
      }
      /* 分类名（星系） */
      ctx.font = '12px monospace'; ctx.fillStyle = `rgba(${PAPER},${0.5 * ease})`;
      for (const c of data.c) { const p = proj(c[1] * ease, c[2] * ease + 26, c[3] * ease); ctx.fillText(c[0], p[0], p[1]); }
      /* 悬停 */
      if (hover >= 0) {
        const e = data.e[hover], p = P[hover], r = Math.max(4, e[3] * p[2] * 2.2) + 5;
        ctx.strokeStyle = `rgb(${GOLD})`; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.stroke();
        ctx.font = '13px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = `rgb(${PAPER})`;
        ctx.fillText(e[5], p[0] + r + 6, p[1] + 4);
        ctx.fillStyle = `rgba(${PAPER},.5)`; ctx.font = '10px monospace';
        ctx.fillText(data.c[e[4]][0], p[0] + r + 6, p[1] + 18);
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    /* 交互：拖动旋转（超过阈值才算拖）、滚轮缩放、点击前往本站词条 */
    const pick = (x, y) => {
      let best = -1, bd = 14 * 14;
      P.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = i; } });
      return best;
    };
    ov.addEventListener('pointerdown', e => {
      if (e.target.closest('.px-storm-x')) return;
      drag = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false };
    });
    ov.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; ov.classList.add('grab'); try { ov.setPointerCapture(e.pointerId); } catch (_) {} }
        if (drag.moved) {
          yaw = drag.yaw + dx * 0.005;
          pitch = Math.max(-0.2, Math.min(1.35, drag.pitch + dy * 0.004));
          return;
        }
      }
      hover = pick(e.clientX, e.clientY);
      ov.classList.toggle('hot', hover >= 0);
    });
    ov.addEventListener('pointerup', e => {
      const d = drag; drag = null; ov.classList.remove('grab');
      if (!d || d.moved || e.target.closest('.px-storm-x')) return;
      const i = pick(e.clientX, e.clientY);
      if (i >= 0) location.href = root + data.e[i][6];
    });
    ov.addEventListener('wheel', e => {
      e.preventDefault();
      zoom = Math.max(0.5, Math.min(3.5, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    }, { passive: false });

    function close() {
      if (!open) return;
      open = false;
      ov.classList.remove('on');
      removeEventListener('resize', resize);
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => { cancelAnimationFrame(raf); ov.remove(); if (onClose) onClose(); }, 600);
    }
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.querySelector('.px-storm-x').addEventListener('click', close);
  };
})();
