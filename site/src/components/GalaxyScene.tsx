/**
 * 宇宙场景：整个 wiki 的 3D 视图。
 *   分类 = 星系（中心有名字标签，可点击飞入）；星团 = 一组椭圆轨道；词条 = 行星（形状按分类区分）；
 *   连线 = 正文内链（常态极淡，聚焦时只点亮相关的）。
 * 布局全部来自 build-universe 生成的 universe.json，这里只做可视化。
 * 调色：近黑底 + 米白，唯一的金色留给"当前选中"。
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, DepthOfField } from '@react-three/postprocessing';
import { Html } from '@react-three/drei';
import gsap from 'gsap';
import { getState, inGroup, runtime, setState, subscribe, useGalaxy, viewGroup } from './galaxyStore';

/* ---------- 数据类型 ---------- */
export interface OrbitParam { a: number; b: number; tiltX: number; tiltY: number; tiltZ: number; phase0: number }
export interface Cat { id: string; count: number; center: [number, number, number]; extent: number }
export interface Group { key: string; cat: string; sub: string; count: number; radius: number; center: [number, number, number]; orbits: OrbitParam[] }
export interface Entry {
  id: string; cat: string; sub: string; group: string;
  name: string; title: string; aliases: string[];
  file: string; portrait: string | null; summary: string;
  pos: [number, number, number]; size: number; origin?: boolean;
}
export interface UniverseData { cats: Cat[]; groups: Group[]; entries: Entry[]; edges: [string, string][] }

const C_INK = '#010204';
const C_PAPER = '#e6e2d6';
const C_LINE = '#8a8776';
const C_GOLD = '#e0b968';

/** 分类 → 行星形状（单色系统里靠轮廓区分分类） */
const SHAPES: Record<string, () => THREE.BufferGeometry> = {
  角色: () => new THREE.SphereGeometry(1, 20, 20),
  剧情概要: () => new THREE.OctahedronGeometry(1.1),
  世界观: () => new THREE.IcosahedronGeometry(0.95),
  组织: () => new THREE.DodecahedronGeometry(0.95),
  轶事: () => new THREE.TetrahedronGeometry(1.15),
};
const shapeFor = (cat: string) => (SHAPES[cat] ?? SHAPES['角色'])();

const v3 = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]);

/** 镜头注视点：CameraRig 写，景深对焦读 */
const camTarget = new THREE.Vector3();

/* ---------- 背景：星云 + 星点 ---------- */
const NEBULA_FS = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));vec2 u=f*f*(3.0-2.0*f);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
  float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}
  void main(){
    vec2 p = vUv*2.0-1.0;
    vec2 q = vUv*3.2 + vec2(uTime*0.006, -uTime*0.004);
    float m = fbm(q + fbm(q*1.4));
    // 注意：这里是线性色，后处理会转 sRGB（0.01 线性 ≈ 0.1 显示）
    vec3 col = mix(vec3(0.0003,0.0005,0.0012), vec3(0.003,0.0038,0.008), smoothstep(0.3,0.9,m));
    col += vec3(0.0016,0.0014,0.001) * (1.0 - smoothstep(0.0,0.7,length(p)));
    col *= mix(1.0, 0.15, smoothstep(0.72,1.35,length(p)));
    gl_FragColor = vec4(col,1.0);
  }`;

function Nebula() {
  const ref = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  // 星云贴在相机后方远处，始终填满视野
  useFrame(({ camera }, dt) => {
    uniforms.uTime.value += dt;
    const m = ref.current;
    if (!m) return;
    m.position.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 900);
    m.quaternion.copy(camera.quaternion);
  });
  return (
    <mesh ref={ref} scale={[2400, 1500, 1]} renderOrder={-3} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial uniforms={uniforms} vertexShader={`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`} fragmentShader={NEBULA_FS} depthWrite={false} depthTest={false} />
    </mesh>
  );
}

function StarField({ count = 3200 }: { count?: number }) {
  const geometry = useMemo(() => {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 650 + Math.random() * 550;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th)], i * 3);
      const warm = Math.random() < 0.06;
      c.setHSL(warm ? 0.1 : 0.6, warm ? 0.15 : 0.03, 0.22 + Math.random() * 0.36).toArray(col, i * 3);
      size[i] = 0.35 + Math.random() * 1.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    return g;
  }, [count]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((_, dt) => { uniforms.uTime.value += dt; });
  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={-2}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={`attribute float aSize; varying vec3 vCol; uniform float uTime;
          void main(){ vCol=color; vec4 mv=modelViewMatrix*vec4(position,1.0);
            float tw=0.9+0.14*sin(uTime*1.2+position.x*13.0+position.y*7.0);
            gl_PointSize=aSize*tw*(1100.0/-mv.z); gl_Position=projectionMatrix*mv; }`}
        fragmentShader={`varying vec3 vCol; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(vCol,smoothstep(0.5,0.05,d)); }`}
        transparent vertexColors depthWrite={false} blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/* ---------- 轨道 ---------- */
function sampleOrbit(o: OrbitParam, c: number[], N: number) {
  const out = new Float32Array((N + 1) * 3);
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const lx = o.a * Math.cos(t), lz = o.b * Math.sin(t);
    let x = lx * Math.cos(o.tiltZ), y = lx * Math.sin(o.tiltZ), z = lz;
    [y, z] = [y * Math.cos(o.tiltX) - z * Math.sin(o.tiltX), y * Math.sin(o.tiltX) + z * Math.cos(o.tiltX)];
    [x, z] = [x * Math.cos(o.tiltY) + z * Math.sin(o.tiltY), -x * Math.sin(o.tiltY) + z * Math.cos(o.tiltY)];
    out.set([c[0] + x, c[1] + y, c[2] + z], i * 3);
  }
  return out;
}

function OrbitLines({ groups }: { groups: Group[] }) {
  const active = useGalaxy(viewGroup);
  const lines = useMemo(() => groups.flatMap((g) => g.orbits.map((o) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(sampleOrbit(o, g.center, 128), 3));
    return { g, geo };
  })), [groups]);
  useEffect(() => () => lines.forEach((l) => l.geo.dispose()), [lines]);
  return (
    <group>
      {lines.map(({ g, geo }, i) => (
        <line key={i} geometry={geo as any}>
          <lineBasicMaterial color={C_LINE} transparent opacity={inGroup(g, active) ? 0.2 : 0.04} depthWrite={false} blending={THREE.AdditiveBlending} />
        </line>
      ))}
    </group>
  );
}

/* ---------- 连线：二次贝塞尔弧 ---------- */
const SEG = 14;
function arcs(pairs: [Entry, Entry][], bend: number) {
  const out = new Float32Array(pairs.length * SEG * 6);
  let w = 0;
  const ctrl = new THREE.Vector3();
  for (const [a, b] of pairs) {
    const p0 = v3(a.pos), p1 = v3(b.pos);
    const d = p0.distanceTo(p1);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    ctrl.copy(mid).addScaledVector(mid.clone().normalize(), d * bend).add(new THREE.Vector3(0, d * 0.05, 0));
    let px = p0.x, py = p0.y, pz = p0.z;
    for (let i = 1; i <= SEG; i++) {
      const t = i / SEG, u = 1 - t;
      const x = u * u * p0.x + 2 * u * t * ctrl.x + t * t * p1.x;
      const y = u * u * p0.y + 2 * u * t * ctrl.y + t * t * p1.y;
      const z = u * u * p0.z + 2 * u * t * ctrl.z + t * t * p1.z;
      out.set([px, py, pz, x, y, z], w); w += 6;
      px = x; py = y; pz = z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return g;
}

function Edges({ data, byId, adj }: { data: UniverseData; byId: Map<string, Entry>; adj: Map<string, string[]> }) {
  const focused = useGalaxy((s) => s.focusedId);
  const active = useGalaxy(viewGroup);
  const base = useMemo(() => arcs(data.edges.map(([a, b]) => [byId.get(a)!, byId.get(b)!]), 0.32), [data.edges, byId]);
  const hi = useMemo(() => {
    const src = focused ? byId.get(focused) : null;
    return src ? arcs((adj.get(src.id) ?? []).map((id) => [src, byId.get(id)!]), 0.18) : null;
  }, [focused, byId, adj]);
  useEffect(() => () => base.dispose(), [base]);
  useEffect(() => () => hi?.dispose(), [hi]);
  return (
    <group>
      <lineSegments geometry={base}>
        <lineBasicMaterial color={C_LINE} transparent opacity={focused ? 0.012 : active ? 0.018 : 0.026} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
      {hi && (
        <lineSegments geometry={hi}>
          <lineBasicMaterial color={C_GOLD} transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineSegments>
      )}
    </group>
  );
}

/* ---------- 行星：每个分类一个 InstancedMesh ---------- */
function Planets({ cat, items, onSelect }: { cat: string; items: Entry[]; onSelect: (id: string) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const active = useGalaxy(viewGroup);
  const focused = useGalaxy((s) => s.focusedId);
  const geometry = useMemo(() => shapeFor(cat), [cat]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const mesh = ref.current!;
    const o = new THREE.Object3D();
    items.forEach((e, i) => {
      o.position.set(...e.pos);
      o.scale.setScalar(e.size);
      o.rotation.set(e.pos[0], e.pos[1], e.pos[2]); // 伪随机朝向，让多面体不千篇一律
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // 包围球在首帧（实例还都在原点时）就被缓存了，不重算的话镜头看不到原点时整组会被视锥剔除
    mesh.computeBoundingSphere();
  }, [items]);

  useEffect(() => {
    const mesh = ref.current!;
    // 行星本体压到 0.62，避免近景虚化后被 bloom 放成白斑
    const paper = new THREE.Color(C_PAPER).multiplyScalar(0.8), dim = new THREE.Color('#3e3c36'), gold = new THREE.Color(C_GOLD);
    // 主线章节是金线上的金珠；选中也是金色；其余米白，区域外压暗
    items.forEach((e, i) => mesh.setColorAt(i, e.id === focused || (isMainChapter(e) && inGroup(e, active)) ? gold : inGroup(e, active) ? paper : dim));
    mesh.instanceColor!.needsUpdate = true;
  }, [items, active, focused]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, undefined, items.length]}
      onPointerMove={(ev) => {
        ev.stopPropagation();
        const id = items[ev.instanceId!]?.id ?? null;
        if (id !== getState().hoveredId) setState({ hoveredId: id });
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => { setState({ hoveredId: null }); document.body.style.cursor = ''; }}
      onClick={(ev) => { ev.stopPropagation(); const e = items[ev.instanceId!]; if (e) onSelect(e.id); }}
    >
      <meshLambertMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/* ---------- 原点：金色漩涡（维尔汀 / 时间轴 0） ---------- */
const GOLD = new THREE.Color(C_GOLD), PAPER = new THREE.Color(C_PAPER);

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一束同心细弧：越靠内越金越亮，越外越淡越白；additive 下颜色亮度即透明度 */
function arcBand(n: number, seed: number, rMax: number) {
  const rnd = mulberry(seed);
  const pos: number[] = [], col: number[] = [];
  const c = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const t = Math.pow(rnd(), 1.7);
    const r = 0.9 + t * rMax;
    const a0 = rnd() * Math.PI * 2, len = (0.25 + rnd() * 1.4) * Math.PI;
    const seg = Math.max(8, Math.round(len * r * 1.5));
    const fade = Math.pow(1 - t, 1.6) * (0.35 + rnd() * 0.65);
    c.copy(GOLD).lerp(PAPER, Math.min(1, t * 1.6)).multiplyScalar(fade);
    for (let i = 0; i < seg; i++) {
      const u0 = a0 + (len * i) / seg, u1 = a0 + (len * (i + 1)) / seg;
      pos.push(Math.cos(u0) * r, 0, Math.sin(u0) * r, Math.cos(u1) * r, 0, Math.sin(u1) * r);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** 刻度环：每 3° 一根短刻度，每 30° 一根长的 */
function tickRing(r: number) {
  const pos: number[] = [];
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2, l = i % 10 === 0 ? 1.4 : 0.5;
    pos.push(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(a) * (r + l), 0, Math.sin(a) * (r + l));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** 柔光：始终朝向相机的径向渐变面片 */
function Glow({ size, color, strength }: { size: number; color: string; strength: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(() => ({ uColor: { value: new THREE.Color(color) }, uK: { value: strength } }), [color, strength]);
  useFrame(({ camera }) => { ref.current?.quaternion.copy(camera.quaternion); });
  return (
    <mesh ref={ref} scale={size}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        transparent depthWrite={false} blending={THREE.AdditiveBlending} uniforms={uniforms}
        vertexShader={`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`}
        fragmentShader={`uniform vec3 uColor; uniform float uK; varying vec2 vUv;
          void main(){ float d=length(vUv-0.5)*2.0; float a=exp(-d*d*9.0)+0.25*exp(-d*3.0);
            gl_FragColor=vec4(uColor*a*uK*(1.0-smoothstep(0.85,1.0,d)),1.0); }`}
      />
    </mesh>
  );
}

function OriginCore({ e }: { e: Entry }) {
  const bands = useMemo(() => [arcBand(90, 7, 26), arcBand(110, 11, 30), arcBand(70, 23, 18)], []);
  const ticks = useMemo(() => tickRing(33), []);
  const refs = useRef<(THREE.LineSegments | null)[]>([]);
  // 差速旋转
  useFrame((_, dt) => refs.current.forEach((l, i) => { if (l) l.rotation.y += dt * [0.05, -0.022, 0.09][i]; }));
  useEffect(() => () => [...bands, ticks].forEach((g) => g.dispose()), [bands, ticks]);
  return (
    <group position={e.pos} rotation={[0.12, 0, 0.06]}>
      {bands.map((g, i) => (
        <lineSegments key={i} ref={(el) => { refs.current[i] = el; }} geometry={g}>
          <lineBasicMaterial vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineSegments>
      ))}
      <lineSegments geometry={ticks}>
        <lineBasicMaterial color={C_PAPER} transparent opacity={0.22} depthWrite={false} />
      </lineSegments>
      <Glow size={13} color={C_GOLD} strength={0.55} />
      <Glow size={3.2} color="#fff1cf" strength={0.7} />
    </group>
  );
}

/* ---------- 主线金线：维尔汀 → 序幕 → 第十三章，一条盘旋的金色尘埃带 ---------- */
export const isMainChapter = (e: Entry) => e.cat === '剧情概要' && !e.sub && /^\d\d_/.test(e.name);

let beadTex: THREE.Texture | null = null;
function beadSprite() {
  if (beadTex) return beadTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return (beadTex = new THREE.CanvasTexture(c));
}

function StoryTrail({ entries }: { entries: Entry[] }) {
  const built = useMemo(() => {
    const chapters = entries.filter(isMainChapter).sort((a, b) => a.name.localeCompare(b.name));
    const origin = entries.find((e) => e.origin);
    const pts = [...(origin ? [origin] : []), ...chapters].map((e) => v3(e.pos));
    if (pts.length < 2) return null;
    // 从漩涡里先抬起再甩出去，避免贴着星盘拉直线
    if (origin) pts.splice(1, 0, pts[0].clone().lerp(pts[1], 0.35).add(new THREE.Vector3(0, 26, 0)));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');

    const N = 5200, rnd = mulberry(1999);
    const pos = new Float32Array(N * 3), t = new Float32Array(N), size = new Float32Array(N);
    const p = new THREE.Vector3(), tan = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < N; i++) {
      const u = rnd();
      curve.getPointAt(u, p);
      curve.getTangentAt(u, tan);
      n1.crossVectors(tan, up).normalize();
      n2.crossVectors(tan, n1).normalize();
      // 带宽：近原点细、向外散开（高斯分布）
      const w = (0.5 + u * 5.5) * Math.sqrt(-2 * Math.log(rnd() + 1e-6)), ang = rnd() * Math.PI * 2;
      p.addScaledVector(n1, Math.cos(ang) * w).addScaledVector(n2, Math.sin(ang) * w * 0.45);
      pos.set([p.x, p.y, p.z], i * 3);
      t[i] = u;
      size[i] = rnd() < 0.04 ? 2.6 + rnd() * 2 : 0.6 + rnd() * 1.1;
    }
    const dust = new THREE.BufferGeometry();
    dust.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    dust.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    return {
      dust,
      line: new THREE.BufferGeometry().setFromPoints(curve.getSpacedPoints(600)),
      beads: new THREE.BufferGeometry().setFromPoints(chapters.map((e) => v3(e.pos))),
    };
  }, [entries]);

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uColor: { value: GOLD.clone() } }), []);
  useFrame((_, dt) => { uniforms.uTime.value += dt; });
  useEffect(() => () => { built?.dust.dispose(); built?.line.dispose(); built?.beads.dispose(); }, [built]);
  if (!built) return null;

  return (
    <group>
      <points geometry={built.dust} frustumCulled={false}>
        <shaderMaterial
          uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending}
          vertexShader={`attribute float aT; attribute float aSize; uniform float uTime; varying float vA;
            void main(){
              vec4 mv = modelViewMatrix*vec4(position,1.0);
              float wave = 0.35 + 0.65*pow(0.5+0.5*sin(aT*70.0 - uTime*1.6), 3.0); // 沿时间线向外流动的亮波
              vA = wave * mix(1.0, 0.55, aT);
              gl_PointSize = aSize * (260.0 / -mv.z);
              gl_Position = projectionMatrix*mv;
            }`}
          fragmentShader={`uniform vec3 uColor; varying float vA;
            void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(uColor*vA*smoothstep(0.5,0.0,d)*0.8,1.0); }`}
        />
      </points>
      <line geometry={built.line as any}>
        <lineBasicMaterial color={C_GOLD} transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending} />
      </line>
      <points geometry={built.beads}>
        <pointsMaterial color="#ffd9a0" size={9} sizeAttenuation={false} map={beadSprite()} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </group>
  );
}

/* ---------- 悬停 / 聚焦环 ---------- */
function Highlights({ byId }: { byId: Map<string, Entry> }) {
  const hovered = useGalaxy((s) => s.hoveredId);
  const focused = useGalaxy((s) => s.focusedId);
  const fRef = useRef<THREE.Group>(null), hRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  useFrame((_, dt) => {
    // 环始终朝向相机，从任何角度看都是正圆
    if (fRef.current) { fRef.current.quaternion.copy(camera.quaternion); fRef.current.children[0].rotation.z -= dt * 0.28; }
    if (hRef.current) hRef.current.quaternion.copy(camera.quaternion);
  });
  const h = hovered && hovered !== focused ? byId.get(hovered) : null;
  const f = focused ? byId.get(focused) : null;
  const T = 0.02;
  const mat = (c: string, o: number) => <meshBasicMaterial color={c} side={THREE.DoubleSide} transparent opacity={o} depthWrite={false} />;
  return (
    <group>
      {h && <mesh ref={hRef} position={h.pos}><ringGeometry args={[h.size * 1.8, h.size * 1.8 + T, 96]} />{mat(C_PAPER, 0.7)}</mesh>}
      {f && (
        <group ref={fRef} position={f.pos}>
          <mesh><ringGeometry args={[f.size * 2.15, f.size * 2.15 + T, 128, 1, 0, Math.PI * 1.7]} />{mat(C_GOLD, 0.95)}</mesh>
          <mesh><ringGeometry args={[f.size * 2.6, f.size * 2.6 + T, 128]} />{mat(C_GOLD, 0.35)}</mesh>
        </group>
      )}
    </group>
  );
}

/* ---------- 文字标签 ---------- */
function HoverLabel({ byId }: { byId: Map<string, Entry> }) {
  const hovered = useGalaxy((s) => s.hoveredId);
  const focused = useGalaxy((s) => s.focusedId);
  const e = hovered && hovered !== focused ? byId.get(hovered) : null;
  if (!e) return null;
  return (
    <Html position={e.pos} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="galaxy-tag">
        <span className="galaxy-tag-name">{e.title}</span>
        <span className="galaxy-tag-org">{e.sub || e.cat}</span>
      </div>
    </Html>
  );
}

function CatLabels({ cats }: { cats: Cat[] }) {
  const active = useGalaxy(viewGroup);
  const focused = useGalaxy((s) => s.focusedId);
  if (focused) return null;
  return (
    <>
      {cats.map((c) => (
        <Html key={c.id} position={[c.center[0], c.center[1] + c.extent * 0.55 + 6, c.center[2]]} center zIndexRange={[5, 0]}>
          <button
            className={`galaxy-cat-label ${active?.split('/')[0] === c.id ? 'active' : ''}`}
            onClick={() => setState({ activeGroup: c.id })}
          >
            <span className="n">{c.id}</span>
            <span className="c">{String(c.count).padStart(3, '0')}</span>
          </button>
        </Html>
      ))}
    </>
  );
}

/* ---------- 摄像机：全景 / 区域 / 聚焦 三种机位 ---------- */
function CameraRig({ data, byId }: { data: UniverseData; byId: Map<string, Entry> }) {
  const { camera } = useThree();
  const target = useRef(camTarget);
  const bias = useRef({ x: 0 }); // 聚焦时视线右偏，星体落在左侧给卡片让位
  const mouse = useRef({ x: 0, y: 0 });

  const R = useMemo(() => Math.max(...data.cats.map((c) => v3(c.center).length() + c.extent)), [data.cats]);
  const regions = useMemo(() => {
    const m = new Map<string, { c: THREE.Vector3; r: number }>();
    for (const c of data.cats) m.set(c.id, { c: v3(c.center), r: c.extent });
    for (const g of data.groups) if (g.sub) m.set(g.key, { c: v3(g.center), r: g.radius });
    return m;
  }, [data]);

  useEffect(() => {
    const view = (s: { focusedId: string | null; activeGroup: string | null }, instant = false) => {
      const e = s.focusedId ? byId.get(s.focusedId) : null;
      const reg = s.activeGroup ? regions.get(s.activeGroup) : null;
      // 竖屏横向视野窄，全景/区域镜头按宽高比拉远
      const k = Math.max(1, 1.5 / (camera as THREE.PerspectiveCamera).aspect);
      let tgt: THREE.Vector3, pos: THREE.Vector3, b = 0;
      if (e) {
        tgt = v3(e.pos);
        const dir = tgt.lengthSq() > 0.01 ? tgt.clone().normalize() : new THREE.Vector3(0, 0.3, 1).normalize();
        const d = 20 + e.size * 8;
        pos = tgt.clone().addScaledVector(dir, d).add(new THREE.Vector3(0, 2.2, 0));
        b = d * 0.28;
      } else if (reg) {
        tgt = reg.c.clone();
        const dir = tgt.lengthSq() > 1 ? tgt.clone().normalize() : new THREE.Vector3(0, 0, 1);
        const d = (reg.r * 2.3 + 14) * k;
        pos = tgt.clone().addScaledVector(dir, d * 0.75).add(new THREE.Vector3(0, d * 0.5, 0)).addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), d * 0.3);
      } else {
        tgt = new THREE.Vector3();
        pos = new THREE.Vector3(R * 0.1, R * 0.6, R * 1.45).multiplyScalar(k);
      }
      const o = { duration: instant ? 0 : 1.8, ease: 'power3.inOut', overwrite: true };
      gsap.to(camera.position, { x: pos.x, y: pos.y, z: pos.z, ...o });
      gsap.to(target.current, { x: tgt.x, y: tgt.y, z: tgt.z, ...o });
      gsap.to(bias.current, { x: b, ...o });
    };
    const key = (s: ReturnType<typeof getState>) => `${s.focusedId}|${s.activeGroup}`;
    let last = key(getState());
    view(getState(), true); // 首帧直接就位，不做飞行
    const run = (s: ReturnType<typeof getState>) => { if (key(s) !== last) { last = key(s); view(s); } };
    const onMove = (ev: MouseEvent) => { mouse.current.x = (ev.clientX / innerWidth) * 2 - 1; mouse.current.y = (ev.clientY / innerHeight) * 2 - 1; };
    addEventListener('mousemove', onMove);
    const un = subscribe(run);
    return () => { un(); removeEventListener('mousemove', onMove); };
  }, [camera, byId, regions, R]);

  useFrame((st) => {
    const focused = !!getState().focusedId;
    const k = focused ? 0.25 : camera.position.distanceTo(target.current) * 0.02;
    const t = st.clock.elapsedTime;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    camera.lookAt(
      target.current.clone()
        .add(new THREE.Vector3(mouse.current.x * k + (focused ? 0 : Math.sin(t * 0.06) * k), -mouse.current.y * k * 0.6, 0))
        .addScaledVector(right, bias.current.x),
    );
  });
  return null;
}

/** 把聚焦星体的屏幕坐标写进 runtime，给 DOM 引线用 */
function FocusProjector({ byId }: { byId: Map<string, Entry> }) {
  const { camera, size } = useThree();
  const p = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const id = getState().focusedId;
    const e = id ? byId.get(id) : null;
    if (!e) { runtime.focusedScreen.visible = false; return; }
    p.set(...e.pos).project(camera);
    runtime.focusedScreen.x = (p.x * 0.5 + 0.5) * size.width;
    runtime.focusedScreen.y = (-p.y * 0.5 + 0.5) * size.height;
    runtime.focusedScreen.visible = p.z > -1 && p.z < 1;
  });
  // 菜单悬停引线的终点
  useFrame(() => {
    const a = runtime.hoverAnchor;
    if (!a) { runtime.hoverScreen.visible = false; return; }
    p.set(...a.world).project(camera);
    runtime.hoverScreen.x = (p.x * 0.5 + 0.5) * size.width;
    runtime.hoverScreen.y = (-p.y * 0.5 + 0.5) * size.height;
    runtime.hoverScreen.visible = p.z > -1 && p.z < 1;
  });
  return null;
}

/** 景深：始终对焦镜头注视点，焦内范围随距离缩放（远景宽、特写窄） */
function DofSync({ dof }: { dof: React.RefObject<any> }) {
  useFrame(({ camera }) => {
    const fx = dof.current;
    if (!fx) return;
    fx.target = camTarget;
    // 全景时焦内放宽到整个宇宙（只虚化远星），特写时收窄出明显景深
    const d = camera.position.distanceTo(camTarget);
    const focused = !!getState().focusedId;
    fx.cocMaterial.focusRange = d * (focused ? 0.5 : 1.1);
    fx.bokehScale = focused ? 1.1 : 1.8;
  });
  return null;
}

/* ---------- 装配 ---------- */
export default function GalaxyScene({ data, onSelect }: { data: UniverseData; onSelect: (id: string) => void }) {
  const byId = useMemo(() => new Map(data.entries.map((e) => [e.id, e])), [data.entries]);
  const adj = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [a, b] of data.edges) { (m.get(a) ?? m.set(a, []).get(a)!).push(b); (m.get(b) ?? m.set(b, []).get(b)!).push(a); }
    return m;
  }, [data.edges]);
  const byCat = useMemo(() => data.cats.map((c) => ({ cat: c.id, items: data.entries.filter((e) => e.cat === c.id) })), [data]);
  const origin = data.entries.find((e) => e.origin);
  const dof = useRef<any>(null);

  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ fov: 50, near: 0.1, far: 2000 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0 }}
      onPointerMissed={() => setState({ hoveredId: null })}
    >
      <color attach="background" args={[C_INK]} />
      {/* 漩涡是光源：星体朝原点一侧亮、背面暗 */}
      {/* three 的 Lambert 会把环境光除以 π，1.1 实际约 0.35：背光面保持可见 */}
      <ambientLight intensity={1.1} />
      <pointLight position={[0, 4, 0]} color="#ffe2b0" intensity={3} distance={0} decay={0} />
      <directionalLight position={[60, 120, 80]} intensity={0.5} />
      <Nebula />
      <StarField />
      <OrbitLines groups={data.groups} />
      <Edges data={data} byId={byId} adj={adj} />
      {origin && <OriginCore e={origin} />}
      <StoryTrail entries={data.entries} />
      {byCat.map((c) => <Planets key={c.cat} cat={c.cat} items={c.items} onSelect={onSelect} />)}
      <Highlights byId={byId} />
      <HoverLabel byId={byId} />
      <CatLabels cats={data.cats} />
      <CameraRig data={data} byId={byId} />
      <FocusProjector byId={byId} />
      <DofSync dof={dof} />
      <EffectComposer multisampling={0}>
        <DepthOfField ref={dof} bokehScale={1.8} focusRange={60} resolutionScale={0.5} />
        <Bloom intensity={0.45} luminanceThreshold={0.5} luminanceSmoothing={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.32} darkness={0.72} />
      </EffectComposer>
    </Canvas>
  );
}
