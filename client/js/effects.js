// Hệ thống hiệu ứng: particle GPU (1 draw call), shader năng lượng, vòng phép, tia, lốc xoáy...
// Tất cả đều là hình khối + shader tự sinh => không cần tải texture/asset.
import * as THREE from 'three';
import { hitsObstacle, rainPoints } from '/shared/config.js';
import { initSteer, steerStep } from '/shared/steer.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const col = c => new THREE.Color(c);

// ======================= Texture tự vẽ =======================
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TEX = {};
function glowTex() {
  return TEX.glow ||= canvasTex(128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
}
function magicCircleTex() {
  return TEX.circle ||= canvasTex(512, (g, s) => {
    const c = s / 2;
    g.strokeStyle = '#fff'; g.fillStyle = '#fff';
    g.shadowColor = '#fff'; g.shadowBlur = 8;
    const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); };
    ring(246, 6); ring(226, 3); ring(150, 4); ring(70, 3);
    // ngôi sao 2 tam giác
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = (i / 3) * Math.PI * 2 + k * Math.PI / 3 - Math.PI / 2;
        const x = c + Math.cos(a) * 222, y = c + Math.sin(a) * 222;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.lineWidth = 3; g.stroke();
    }
    // ký tự rune dọc vòng
    g.font = 'bold 22px serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      g.save();
      g.translate(c + Math.cos(a) * 236, c + Math.sin(a) * 236);
      g.rotate(a + Math.PI / 2);
      g.fillText(runes[i % runes.length], 0, 0);
      g.restore();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath(); g.arc(c + Math.cos(a) * 188, c + Math.sin(a) * 188, 10, 0, Math.PI * 2); g.stroke();
    }
  });
}

// ======================= Shader =======================
const NOISE_GLSL = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }`;

// Quả cầu năng lượng: viền sáng (fresnel) + nhiễu chuyển động
function energyMat(color, core = 0xffffff, opacity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: col(color) }, uCore: { value: col(core) }, uTime: { value: 0 }, uOpacity: { value: opacity } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      varying float vD;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position;
      vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uCore; uniform float uTime; uniform float uOpacity;
      varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vD; ${NOISE_GLSL}
      void main(){ float f = 1.0 - abs(dot(normalize(vN), vV));
        float n = fbm(vP.xy*3.0 + vec2(uTime*2.0, -uTime*1.3) + vP.z*2.0);
        vec3 c = mix(uCore, uColor, smoothstep(0.0, 0.75, f));
        float a = (0.22 + pow(f, 1.5) * 0.9 + n*0.25) * uOpacity * smoothstep(1.0, 4.5, vD);
        gl_FragColor = vec4(c * (0.85 + n*0.5), a); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

// Bề mặt chảy (dùng cho tia, lốc xoáy, cột lửa, cánh phượng hoàng)
function flowMat(color, core = 0xffffff, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: col(color) }, uCore: { value: col(core) }, uTime: { value: 0 }, uOpacity: { value: 1 },
      uSpeed: { value: opts.speed ?? 2 }, uScale: { value: new THREE.Vector2(opts.sx ?? 4, opts.sy ?? 3) },
      uEdge: { value: opts.edge ?? 0.15 },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vD;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz);
      vD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uCore; uniform float uTime; uniform float uOpacity; uniform float uSpeed;
      uniform vec2 uScale; uniform float uEdge; varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vD; ${NOISE_GLSL}
      void main(){ vec2 p = vec2(vUv.x*uScale.x, vUv.y*uScale.y - uTime*uSpeed);
        float n = fbm(p + vec2(uTime*0.3, 0.0));
        float streak = pow(n, 2.0) * 1.6;
        float edge = smoothstep(0.0, uEdge, vUv.y) * smoothstep(1.0, 1.0-uEdge, vUv.y);
        float rim = 1.0 - abs(dot(normalize(vN), vV));
        vec3 c = mix(uColor, uCore, smoothstep(0.45, 0.95, n));
        float a = clamp((0.3 + streak) * edge * (0.65 + rim*0.5), 0.0, 1.0) * uOpacity * smoothstep(1.0, 5.0, vD);
        gl_FragColor = vec4(c, a); }`,
    transparent: true, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}

// Vệt chém hình vòng cung (alpha theo góc => vệt mờ dần ở đuôi)
function arcMat(color, core = 0xffffff) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: col(color) }, uCore: { value: col(core) }, uOpacity: { value: 1 }, uHead: { value: 1 } },
    vertexShader: `varying vec2 vUv; varying float vD; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uCore; uniform float uOpacity; uniform float uHead; varying vec2 vUv; varying float vD;
      void main(){ float along = vUv.x; float across = vUv.y;
        float tail = smoothstep(uHead-0.9, uHead, along) * step(along, uHead);
        float band = smoothstep(0.0, 0.5, across) * smoothstep(1.0, 0.75, across);
        vec3 c = mix(uColor, uCore, smoothstep(0.55, 0.9, across));
        gl_FragColor = vec4(c, tail*band*uOpacity*smoothstep(0.8, 3.0, vD)); }`,
    transparent: true, blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}

// Hình cánh cung (UV: x dọc cung, y theo bán kính)
function arcGeo(rIn, rOut, arc, seg = 32) {
  const g = new THREE.BufferGeometry();
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, a = -arc / 2 + arc * t;
    for (let j = 0; j < 2; j++) {
      const r = j ? rOut : rIn;
      pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
      uv.push(t, j);
    }
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ======================= Particle GPU =======================
class Particles {
  constructor(scene, max = 6000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA;
        uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); vA = alpha * smoothstep(0.6, 3.0, -mv.z);
          gl_PointSize = alpha > 0.0 ? size * uScale / max(0.1, -mv.z) : 0.0; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
          float a = pow(1.0 - d, 1.3); float core = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(mix(vC, vec3(1.0), core * 0.3) * 1.1, a * vA * 0.9); }`,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, color, size, life, opts = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    const c = color.isColor ? color : TMP_COLOR.set(color);
    const j = opts.jitter ?? 0.12;
    this.col[i3] = c.r * (1 - j + Math.random() * j * 2);
    this.col[i3 + 1] = c.g * (1 - j + Math.random() * j * 2);
    this.col[i3 + 2] = c.b * (1 - j + Math.random() * j * 2);
    this.life[i] = this.maxLife[i] = life;
    this.s0[i] = size; this.s1[i] = opts.size1 ?? size * 0.2;
    this.drag[i] = opts.drag ?? 1.5;
    this.grav[i] = opts.grav ?? 0;
    this.size[i] = size; this.alpha[i] = 1;
  }

  // nổ tung ra mọi hướng
  burst(p, n, color, o = {}) {
    const sp = o.speed ?? 6, size = o.size ?? 0.35, life = o.life ?? 0.6;
    const v = BURST_V;
    for (let k = 0; k < n; k++) {
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      if (o.flat) v.y *= 0.15;
      if (o.up) v.y = Math.abs(v.y) * o.up;
      const s = sp * (0.35 + Math.random() * 0.65);
      const r = o.r ?? 0;
      this.emit(p.x + v.x * r, p.y + v.y * r, p.z + v.z * r, v.x * s, v.y * s, v.z * s,
        color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), o);
    }
  }

  update(dt) {
    const { pos, vel, life, maxLife, size, alpha, s0, s1, drag, grav } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) alpha[i] = 0; continue; }
      life[i] -= dt;
      const i3 = i * 3;
      const dr = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= dr; vel[i3 + 1] = vel[i3 + 1] * dr - grav[i] * dt; vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const f = Math.max(0, life[i] / maxLife[i]);
      size[i] = s1[i] + (s0[i] - s1[i]) * f;
      alpha[i] = life[i] <= 0 ? 0 : Math.min(1, f * 2.2);
    }
    const g = this.geo.attributes;
    g.position.needsUpdate = g.size.needsUpdate = g.alpha.needsUpdate = g.color.needsUpdate = true;
  }
}
const TMP_COLOR = new THREE.Color();
const BURST_V = new THREE.Vector3();

// ======================= Effect cơ sở =======================
class Effect {
  constructor(fx) { this.fx = fx; this.objs = []; this.mats = []; this.el = 0; this.done = false; }
  add(o, parent) { (parent || this.fx.scene).add(o); this.objs.push(o); return o; }
  mat(m) { this.mats.push(m); return m; }
  tick(dt) {
    this.el += dt;
    for (const m of this.mats) if (m.uniforms?.uTime) m.uniforms.uTime.value += dt;
    return this.update(dt, this.el) !== false && !this.done;
  }
  update() { return false; }
  dispose() {
    for (const o of this.objs) o.removeFromParent();
    for (const m of this.mats) m.dispose();
    this.objs.length = 0;
  }
  // tắt dần opacity cho mọi material
  setOpacity(a) {
    for (const m of this.mats) {
      if (m.uniforms?.uOpacity) m.uniforms.uOpacity.value = a;
      else if ('opacity' in m) m.opacity = a;
    }
  }
}

// Tạo hàm cập nhật nhanh
class FnEffect extends Effect {
  constructor(fx, fn) { super(fx); this.fn = fn; }
  update(dt, el) { return this.fn(dt, el, this); }
}

function sprite(color, scale, opacity = 1) {
  const m = new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(scale);
  s.renderOrder = 11;
  return s;
}

const GEO = {
  sphere: new THREE.SphereGeometry(1, 24, 16),
  sphereLo: new THREE.SphereGeometry(1, 12, 8),
  ring: new THREE.RingGeometry(0.85, 1, 48),
  torus: new THREE.TorusGeometry(1, 0.06, 6, 48),
  plane: new THREE.PlaneGeometry(1, 1),
  cylOpen: new THREE.CylinderGeometry(1, 1, 1, 24, 1, true),
  funnel: new THREE.CylinderGeometry(1, 0.25, 1, 24, 8, true),
  cone: new THREE.ConeGeometry(1, 1, 6),
  crystal: new THREE.OctahedronGeometry(1, 0),
  rock: new THREE.DodecahedronGeometry(1, 0),
  cylSeg: new THREE.CylinderGeometry(1, 1, 1, 5, 1, true),
  pillar: new THREE.CylinderGeometry(0.85, 1.05, 1, 8),     // cột đá (scale theo r, h)
  rod: new THREE.CylinderGeometry(1, 1, 1, 6),             // cán thương cọc sét
  shuriken: (() => {
    const s = new THREE.Shape();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = i % 2 ? 0.14 : 0.5;
      i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    return new THREE.ShapeGeometry(s);
  })(),
  wing: (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.6, 0.6, 1.6, 1.1, 2.8, 1.0);
    s.lineTo(2.3, 0.6); s.lineTo(2.9, 0.45); s.lineTo(2.2, 0.15); s.lineTo(2.6, -0.1);
    s.bezierCurveTo(1.6, -0.2, 0.8, -0.3, 0, 0);
    const g = new THREE.ShapeGeometry(s, 16);
    // UV đơn giản theo bounding box
    g.computeBoundingBox();
    const b = g.boundingBox, uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - b.min.x) / (b.max.x - b.min.x), (p.getY(i) - b.min.y) / (b.max.y - b.min.y));
    return g;
  })(),
};

// ======================= Quản lý FX =======================
export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.parts = new Particles(scene);
    this.list = [];
    this.shakeAmt = 0;
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 14, 1.6);
      L.userData.life = 0;
      scene.add(L);
      this.lights.push(L);
    }
    this.lightIdx = 0;
    this.quality = 1;
    this.dynObs = [];   // chướng ngại vật tạm thời { x, z, r, h } (cây thần, cột đá) — dùng cho va chạm phía client
  }

  // Dịch chuyển bóng tối / sét: bóng mờ ở chỗ cũ, vệt nối, bùng nổ ở chỗ mới
  blinkFx(from, to, color, core = 0xffffff) {
    const P = this.parts;
    for (let i = 0; i < 26; i++) {
      P.emit(from.x + (Math.random() - 0.5) * 0.8, from.y + Math.random() * 1.8, from.z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 2, 0.5 + Math.random(), (Math.random() - 0.5) * 2, Math.random() < 0.3 ? core : color, 0.7, 0.55, { drag: 2 });
    }
    const n = Math.max(4, Math.round(from.distanceTo(to) * 1.5));
    for (let i = 0; i < n; i++) {
      const k = i / n;
      P.emit(from.x + (to.x - from.x) * k, 1 + from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k, 0, 0.3, 0, color, 0.45, 0.35);
    }
    P.burst(tmpV.set(to.x, to.y + 1, to.z), 22, core, { speed: 6, size: 0.35, life: 0.4 });
    this.shockwave(to, color, 2.6, 0.35);
  }

  // Vòng đánh dấu trên mặt đất trong dur giây (dấu phi đao...)
  groundMarker(pos, color, dur) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const e = new FnEffect(this, (dt, el) => {
      ring.rotation.z += dt * 3;
      ring.scale.setScalar(0.9 + Math.sin(el * 8) * 0.12);
      m.opacity = el > dur - 0.5 ? Math.max(0, (dur - el) / 0.5) * 0.8 : 0.8;
      if (Math.random() < 0.3) this.parts.emit(pos.x, pos.y + 0.1, pos.z, (Math.random() - 0.5), 1.5, (Math.random() - 0.5), color, 0.3, 0.4);
      return el < dur;
    });
    e.mats.push(m);
    const ring = e.add(new THREE.Mesh(GEO.ring, m));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos);
    return this.add(e);
  }

  add(e) { this.list.push(e); return e; }

  // ---------- Công trình: cọc sét (rod), cột đá (pillar) ----------
  // pr: { k, p: [x, y, z], r, h }. Hiệu ứng trả về có hit() (nháy khi bị đánh) và end(why)
  // why: 'time' (lún xuống), 'break' / 'quake' (vỡ tung), 'rip' (bị nhổ lên ném)
  prop(pr) {
    const P = this.parts;
    const x = pr.p[0], y = pr.p[1], z = pr.p[2];
    let flash = 0, gone = 0, why = null, obs = null;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    let m, glowM = null;
    if (pr.k === 'rod') {
      // thương sét cắm nghiêng xuống đất, mũi phát sáng, sét nhỏ lách tách
      m = new THREE.MeshToonMaterial({ color: 0x3c1a78, emissive: 0x2a0f5a });
      const shaft = new THREE.Mesh(GEO.rod, m);
      shaft.scale.set(0.07, pr.h, 0.07);
      shaft.position.y = pr.h / 2;
      const tip = new THREE.Mesh(GEO.cone, m);
      tip.scale.set(0.16, 0.5, 0.16);
      tip.position.y = pr.h + 0.2;
      const holder = new THREE.Group();
      holder.add(shaft, tip);
      holder.rotation.set(0.12, Math.random() * 6, 0.1);
      const sp = sprite(0xc77dff, 1.4, 0.8);
      sp.position.y = pr.h + 0.1;
      glowM = new THREE.MeshBasicMaterial({ color: 0xb388ff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(GEO.ring, glowM);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      ring.scale.setScalar(0.9);
      g.add(holder, sp, ring);
      P.burst(tmpV.set(x, y + 0.3, z), 18, 0xfff3a0, { speed: 6, size: 0.25, life: 0.35 });
      this.shockwave(tmpV.set(x, y, z), 0xb388ff, 1.8, 0.3);
    } else {
      // cột đá trồi lên: chặn đường, chặn đạn, đứng lên nóc được
      m = new THREE.MeshToonMaterial({ color: 0x8d6e53, emissive: 0x1f140b });
      const col1 = new THREE.Mesh(GEO.pillar, m);
      col1.scale.set(pr.r, pr.h, pr.r);
      col1.position.y = pr.h / 2;
      col1.rotation.y = Math.random() * 3;
      const cap = new THREE.Mesh(GEO.rock, m);
      cap.scale.set(pr.r * 0.9, 0.35, pr.r * 0.9);
      cap.position.y = pr.h;
      g.add(col1, cap);
      obs = this.addObstacle({ x, z, r: pr.r, h: y + pr.h });
      this.dust(tmpV.set(x, y, z), 26);
      this.shockwave(tmpV.set(x, y, z), 0xd4a373, pr.r * 3, 0.4);
      P.burst(tmpV.set(x, y + 0.5, z), Math.round(24 * this.quality), 0x9c6644, { speed: 8, size: 0.45, life: 0.7, up: 2, grav: 14 });
      this.shake(0.2, tmpV.set(x, y, z));
    }
    const e = new FnEffect(this, (dt, el) => {
      if (gone) {
        const f = (el - gone) / (why === 'time' ? 0.5 : 0.15);
        if (why === 'time') g.position.y = y - pr.h * Math.min(1, f);
        else g.scale.setScalar(Math.max(0.01, 1 - f));
        return f < 1;
      }
      // trồi lên trong 0.18 giây
      const up = Math.min(1, el / 0.18);
      if (pr.k === 'pillar') g.position.y = y - pr.h * (1 - up);
      else g.scale.setScalar(0.3 + up * 0.7);
      flash = Math.max(0, flash - dt * 5);
      m.emissive.setHex(flash > 0 ? 0x6b4a2a : pr.k === 'rod' ? 0x2a0f5a : 0x1f140b);
      if (pr.k === 'rod') {
        if (glowM) glowM.opacity = 0.3 + Math.sin(el * 6) * 0.15;
        if (Math.random() < dt * 8 * this.quality) P.emit(x + (Math.random() - 0.5) * 0.4, y + pr.h * Math.random(), z + (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, Math.random() < 0.5 ? 0xfff3a0 : 0xc77dff, 0.2, 0.15);
      }
      return true;
    });
    e.add(g);
    e.mats.push(m);
    if (glowM) e.mats.push(glowM);
    e.hit = () => { flash = 1; P.burst(tmpV.set(x, y + pr.h * 0.6, z), 8, pr.k === 'rod' ? 0xc77dff : 0x9c6644, { speed: 4, size: 0.3, life: 0.35 }); };
    e.end = w => {
      if (gone) return;
      gone = e.el || 0.001; why = w;
      if (obs) { this.removeObstacle(obs); obs = null; }
      const c = pr.k === 'rod' ? 0xc77dff : 0x9c6644;
      if (w === 'break' || w === 'quake') {
        P.burst(tmpV.set(x, y + pr.h * 0.5, z), Math.round((pr.k === 'rod' ? 16 : 40) * this.quality), c, { speed: 9, size: 0.5, life: 0.8, up: 1.5, grav: 14 });
        this.dust(tmpV.set(x, y, z), 20);
      } else if (w === 'rip') {
        this.dust(tmpV.set(x, y, z), 30);
        P.burst(tmpV.set(x, y + 0.3, z), 20, 0x9c6644, { speed: 6, size: 0.45, life: 0.6, up: 2, grav: 12 });
      }
    };
    const dispose = e.dispose.bind(e);
    e.dispose = () => { if (obs) { this.removeObstacle(obs); obs = null; } dispose(); };
    return this.add(e);
  }

  // Hàng rào điện giữa các cặp cọc sét. pairs: [{ key, a: [x,y,z], b: [x,y,z], c }] — gọi mỗi khung hình
  fences(pairs, dt) {
    const F = this.fenceMap ||= new Map(), seen = new Set();
    for (const q of pairs) {
      seen.add(q.key);
      let f = F.get(q.key);
      if (!f) {
        const fm = flowMat(q.c, 0xfff3a0, { speed: 7, sx: 8, sy: 1.5, edge: 0.25 });
        const mesh = new THREE.Mesh(GEO.plane, fm);
        mesh.renderOrder = 4;
        this.scene.add(mesh);
        f = { mesh, fm };
        F.set(q.key, f);
      }
      const ax = q.a[0], az = q.a[2], bx = q.b[0], bz = q.b[2], L = Math.hypot(bx - ax, bz - az), h = q.h || 2.2;
      f.mesh.position.set((ax + bx) / 2, Math.max(q.a[1], q.b[1]) + h / 2 + 0.2, (az + bz) / 2);
      f.mesh.rotation.set(0, Math.atan2(-(bz - az), bx - ax), 0);
      f.mesh.scale.set(L, h, 1);
      f.fm.uniforms.uTime.value += dt;
      f.fm.uniforms.uOpacity.value = 0.8 + Math.random() * 0.2;   // hàng rào phải nhìn thấy rõ để đối thủ né
      // thỉnh thoảng một tia sét chạy dọc hàng rào (không bật đèn để khỏi trắng xoá)
      if (Math.random() < dt * 3 * this.quality) {
        const y0 = Math.max(q.a[1], q.b[1]) + 0.4 + Math.random() * h;
        this.bolt(new THREE.Vector3(ax, y0, az), new THREE.Vector3(bx, y0, bz), q.c, 0xfff3a0, 0.05, false);
      }
    }
    for (const [k, f] of F) if (!seen.has(k)) { f.mesh.removeFromParent(); f.fm.dispose(); F.delete(k); }
  }

  // Phân thân gió (dị biến Kaze): bóng mờ hiện ra chém một nhát rồi tan
  windClone(p, color) {
    const P = this.parts;
    const bm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false });
    const am = arcMat(color, 0xffffff);
    const e = new FnEffect(this, (dt, el) => {
      const f = el / 0.4;
      bm.opacity = 0.5 * (1 - f);
      am.uniforms.uHead.value = Math.min(1.6, f * 3);
      am.uniforms.uOpacity.value = 1 - f;
      slash.rotation.y += dt * 14;
      return f < 1;
    });
    e.mats.push(bm, am);
    const g = e.add(new THREE.Group());
    g.position.set(p.x, p.y - 1, p.z);
    const body = new THREE.Mesh(GEO.sphereLo, bm);
    body.scale.set(0.42, 0.55, 0.34); body.position.y = 0.75;
    const head = new THREE.Mesh(GEO.sphereLo, bm);
    head.scale.setScalar(0.42); head.position.y = 1.55;
    g.add(body, head);
    g.rotation.y = Math.random() * 6;
    const slash = e.add(new THREE.Mesh(arcGeo(1.2, 2.4, 2.4), am));
    slash.position.copy(p);
    slash.rotation.set(0.4, Math.random() * 6, 0.2);
    P.burst(tmpV.copy(p), Math.round(22 * this.quality), color, { speed: 8, size: 0.32, life: 0.4 });
    P.burst(tmpV.copy(p), 8, 0xffffff, { speed: 5, size: 0.25, life: 0.3 });
    const dispose = e.dispose.bind(e);
    e.dispose = () => { slash.geometry.dispose(); dispose(); };
    return this.add(e);
  }

  // Mảnh đá văng ra khi cột đá vỡ
  rockBurst(p, color, r) {
    this.shockwave(tmpV.set(p.x, 0, p.z), color, r * 1.3, 0.45);
    this.dust(tmpV.set(p.x, 0, p.z), 26);
    this.parts.burst(tmpV.copy(p), Math.round(40 * this.quality), 0x9c6644, { speed: 12, size: 0.55, life: 0.9, up: 1.2, grav: 14 });
    this.parts.burst(tmpV.copy(p), Math.round(12 * this.quality), color, { speed: 7, size: 0.4, life: 0.5 });
    this.shake(0.3, p);
  }

  // Vòng sét phóng ra từ một cọc sét
  zapRing(p, color, r) {
    this.shockwave(tmpV.set(p.x, Math.max(0, p.y - 1.2), p.z), color, r * 1.2, 0.35);
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      this.bolt(new THREE.Vector3(p.x, p.y + 1, p.z), new THREE.Vector3(p.x + Math.cos(a) * r, Math.max(0.1, p.y - 1.1), p.z + Math.sin(a) * r), color, 0xfff3a0, 0.05, false);
    }
    this.parts.burst(tmpV.copy(p), Math.round(14 * this.quality), 0xfff3a0, { speed: 6, size: 0.25, life: 0.3 });
  }

  // ---------- Dị biến ----------
  // Biến hình: năng lượng hút vào người + cột sáng (hoà màu thường để không trắng xoá) rồi bùng nổ
  awakenBurst(getPos, color, core, dur) {
    const P = this.parts, c = col(color);
    const fm = flowMat(color, core, { speed: 5, sx: 4, sy: 3, edge: 0.08 });
    let boom = false;
    const e = new FnEffect(this, (dt, el) => {
      const p = getPos();
      const f = Math.min(1, el / dur);
      pillar.position.set(p.x, p.y + 4, p.z);
      pillar.rotation.y += dt * 6;
      const w = el < dur ? 0.4 + f * 0.9 : Math.max(0, 1.3 - (el - dur) * 3);
      pillar.scale.set(w, 8, w);
      fm.uniforms.uOpacity.value = el < dur ? 0.25 + f * 0.3 : Math.max(0, 0.55 - (el - dur) * 2.5);
      if (el < dur) {
        // hạt năng lượng xoáy hút vào người
        for (let i = 0; i < 6 * this.quality; i++) {
          const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 2, y = Math.random() * 3;
          P.emit(p.x + Math.cos(a) * r, p.y + y, p.z + Math.sin(a) * r, -Math.cos(a) * r * 2.6 - Math.sin(a) * 3, 1.5 - y * 0.6, -Math.sin(a) * r * 2.6 + Math.cos(a) * 3,
            Math.random() < 0.3 ? core : color, 0.35, 0.38, { drag: 0 });
        }
        if (Math.random() < dt * 6) this.shockwave(p, color, 1.6, 0.3);
      } else if (!boom) {
        boom = true;
        // bùng nổ vừa phải: ít hạt trắng, đèn chớp yếu để không trắng xoá màn hình
        this.shockwave(p, color, 6.5, 0.6);
        this.shockwave(p, color, 4, 0.45);
        P.burst(tmpV.set(p.x, p.y + 1, p.z), Math.round(40 * this.quality), c, { speed: 14, size: 0.4, life: 0.6, drag: 2.5 });
        P.burst(tmpV.set(p.x, p.y + 1, p.z), Math.round(10 * this.quality), core, { speed: 6, size: 0.3, life: 0.7, up: 1.5, drag: 1 });
        this.dust(p, 24);
        this.flash(tmpV.set(p.x, p.y + 2, p.z), color, 12, 0.4);
        this.shake(0.5, p);
      }
      return el < dur + 0.45;
    });
    e.mats.push(fm);
    const pillar = e.add(new THREE.Mesh(GEO.cylOpen, fm));
    this.magicCircle(getPos, color, dur + 0.4, 3.6);
    return this.add(e);
  }

  // Tuyệt kỹ dị biến tụ lực lâu: vòng năng lượng xoay quanh người dâng lên, hạt hút vào tâm
  chargeUp(getPos, color, core, dur) {
    const P = this.parts;
    const rm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    const rings = [];
    const e = new FnEffect(this, (dt, el) => {
      const p = getPos(), f = Math.min(1, el / dur);
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i], k = (f * 1.6 + i / rings.length) % 1;
        r.position.set(p.x, p.y + 0.2 + k * 2.6, p.z);
        r.scale.setScalar((1.6 - k * 0.9) * (0.6 + f * 0.6));
        r.rotation.z += dt * (3 + i);
      }
      rm.opacity = (el < dur ? 0.2 + f * 0.35 : Math.max(0, 0.55 - (el - dur) * 4));
      if (el < dur) {
        const n = Math.ceil((2 + f * 6) * this.quality);
        for (let i = 0; i < n; i++) {
          tmpV.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(3.5 + Math.random() * 2);
          P.emit(p.x + tmpV.x, p.y + 1 + tmpV.y, p.z + tmpV.z, -tmpV.x * 2.6, -tmpV.y * 2.6, -tmpV.z * 2.6, Math.random() < 0.35 ? core : color, 0.3, 0.38, { drag: 0 });
        }
        // nhịp tim: sóng xung kích nhỏ dồn dập dần
        if (Math.random() < dt * (2 + f * 8)) this.shockwave(p, color, 1.4 + f * 1.4, 0.3);
        if (f > 0.6) this.shake(0.05 + f * 0.08, p);
      }
      return el < dur + 0.2;
    });
    e.mats.push(rm);
    for (let i = 0; i < 3; i++) {
      const r = e.add(new THREE.Mesh(GEO.ring, rm));
      r.rotation.x = -Math.PI / 2;
      rings.push(r);
    }
    return this.add(e);
  }

  // Sét giáng từ trời xuống một điểm (Thiên Lôi Phán Quyết)
  judgement(pos, color, light = true) {
    const top = new THREE.Vector3(pos.x + (Math.random() - 0.5) * 2, pos.y + 16, pos.z + (Math.random() - 0.5) * 2);
    this.bolt(top, new THREE.Vector3(pos.x, Math.max(0.1, pos.y - 1), pos.z), color, 0xfff7c2, 0.16, light);
    this.bolt(top, new THREE.Vector3(pos.x + (Math.random() - 0.5), pos.y, pos.z + (Math.random() - 0.5)), color, 0xffffff, 0.07, false);
    this.shockwave(tmpV2.set(pos.x, Math.max(0, pos.y - 1), pos.z), color, 3.2, 0.45);
    this.parts.burst(pos, Math.round(30 * this.quality), color, { speed: 9, size: 0.35, life: 0.45 });
    this.shake(0.25, pos);
  }

  // Khối băng bao quanh người bị đóng băng trong dur giây
  iceBlock(getPos, dur) {
    const m = new THREE.MeshToonMaterial({ color: 0xbdf0ff, emissive: 0x2f8ac0, transparent: true, opacity: 0.55, depthWrite: false });
    const e = new FnEffect(this, (dt, el) => {
      const p = getPos();
      if (!p) return false;
      const grow = Math.min(1, el * 8), fade = el > dur - 0.25 ? Math.max(0, (dur - el) / 0.25) : 1;
      g.position.set(p.x, p.y, p.z);
      g.scale.set(grow * (0.6 + 0.4 * fade), grow, grow * (0.6 + 0.4 * fade));
      m.opacity = 0.55 * fade;
      if (el >= dur) { this.parts.burst(tmpV.set(p.x, p.y + 1, p.z), 24, 0xe0f7ff, { speed: 5, size: 0.35, life: 0.6, grav: 8 }); return false; }
      return true;
    });
    e.mats.push(m);
    const g = e.add(new THREE.Group());
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(GEO.crystal, m);
      const a = (i / 6) * Math.PI * 2;
      c.position.set(Math.cos(a) * 0.45, 0.9 + (i % 2) * 0.3, Math.sin(a) * 0.45);
      c.scale.set(0.45, 1.1, 0.45);
      c.rotation.set(Math.sin(a) * 0.3, a, Math.cos(a) * 0.3);
      g.add(c);
    }
    return this.add(e);
  }

  // Vòng cột đá trồi lên quanh center, tồn tại W.dur giây (chặn đường + chặn đạn)
  stoneWalls(center, W, seed) {
    const rockM = new THREE.MeshToonMaterial({ color: 0x8d6e53, emissive: 0x1f140b });
    const pillars = [], obs = [];
    const e = new FnEffect(this, (dt, el) => {
      for (const m of pillars) {
        const up = Math.min(1, el * 6), down = el > W.dur - 0.5 ? Math.max(0, (W.dur - el) / 0.5) : 1;
        m.position.y = -W.h / 2 + W.h * up * down;
      }
      if (el >= W.dur) { for (const o of obs) this.removeObstacle(o); obs.length = 0; return false; }
      return true;
    });
    e.mats.push(rockM);
    for (let i = 0; i < W.count; i++) {
      const a = (i / W.count) * Math.PI * 2 + seed % 7;
      const x = center.x + Math.cos(a) * W.ring, z = center.z + Math.sin(a) * W.ring;
      const m = e.add(new THREE.Mesh(new THREE.CylinderGeometry(W.r * 0.8, W.r * 1.1, W.h, 7), rockM));
      m.position.set(x, -W.h / 2, z);
      m.rotation.y = Math.random() * 3;
      pillars.push(m);
      obs.push(this.addObstacle({ x, z, r: W.r, h: W.h }));
    }
    const dispose = e.dispose.bind(e);
    e.dispose = () => { for (const o of obs) this.removeObstacle(o); obs.length = 0; for (const m of pillars) m.geometry.dispose(); dispose(); };
    this.dust(center, 20);
    return this.add(e);
  }

  // Tạo sẵn 1 bản mỗi loại vật liệu rồi compile => tránh khựng hình lần đầu tung chiêu
  warmup(renderer) {
    const g = new THREE.Group();
    const mats = [energyMat(0xffffff), flowMat(0xffffff), flowMat(0xffffff, 0xffffff, { additive: true }), arcMat(0xffffff),
      new THREE.MeshBasicMaterial({ map: magicCircleTex(), transparent: true, blending: THREE.AdditiveBlending }),
      new THREE.MeshToonMaterial({ color: 0xbdf0ff, emissive: 0x3aa0d0, transparent: true }),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide })];
    for (const m of mats) g.add(new THREE.Mesh(GEO.sphereLo, m));
    g.add(sprite(0xffffff, 1));
    g.position.set(0, -50, 0);
    this.scene.add(g);
    try { renderer.compile(this.scene, this.camera); } catch { /* bỏ qua */ }
    this.scene.remove(g);
  }

  update(dt) {
    this.parts.update(dt);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.tick(dt)) { e.dispose(); this.list.splice(i, 1); }
    }
    for (const L of this.lights) {
      if (L.userData.life > 0) {
        L.userData.life -= dt;
        L.intensity = Math.max(0, L.userData.peak * (L.userData.life / L.userData.dur));
      } else L.intensity = 0;
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
  }

  flash(p, color, intensity = 30, dur = 0.3) {
    const L = this.lights[this.lightIdx++ % this.lights.length];
    L.position.copy(p);
    L.color.set(color);
    L.userData.peak = intensity; L.userData.life = dur; L.userData.dur = dur;
  }

  shake(amount, from) {
    if (from) {
      const d = from.distanceTo(this.camera.position);
      amount *= Math.max(0, 1 - d / 40);
    }
    this.shakeAmt = Math.min(1.2, Math.max(this.shakeAmt, amount));
  }

  // Vòng sóng xung kích trên mặt đất
  shockwave(p, color, radius, dur = 0.45, y = 0.06) {
    const m = this.mat2(new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const e = new FnEffect(this, (dt, el) => {
      const f = el / dur;
      ring.scale.setScalar(0.2 + radius * Math.pow(f, 0.6));
      m.opacity = 1 - f;
      return f < 1;
    });
    e.mats.push(m);
    const ring = e.add(new THREE.Mesh(GEO.ring, m));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, p.y + y, p.z);
    return this.add(e);
  }
  mat2(m) { return m; }

  // Tia sét gấp khúc từ a tới b, chớp tắt trong ~0.3 giây
  // light=false: không bật đèn chớp (nhiều tia cùng lúc dễ làm trắng xoá màn hình)
  bolt(a, b, color, core = 0xffffff, width = 0.07, light = true) {
    const e = new Effect(this);
    const mCore = e.mat(new THREE.MeshBasicMaterial({ color: core, transparent: true, depthWrite: false }));
    const mGlow = e.mat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }));
    const n = 7, len = a.distanceTo(b);
    let prev = a.clone();
    for (let i = 1; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      if (i < n) p.add(new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).multiplyScalar(len * 0.13));
      placeSeg(e.add(new THREE.Mesh(GEO.cylSeg, mCore)), prev, p, width);
      placeSeg(e.add(new THREE.Mesh(GEO.cylSeg, mGlow)), prev, p, width * 2.4);
      prev = p;
    }
    e.update = (dt, el) => {
      const f = 1 - el / 0.3;
      const flick = 0.55 + Math.random() * 0.45;
      mCore.opacity = Math.max(0, f * flick);
      mGlow.opacity = Math.max(0, f * 0.3 * flick);
      return f > 0;
    };
    if (light) this.flash(b, color, 14, 0.2);
    this.parts.burst(b, 8, core, { speed: 6, size: 0.22, life: 0.3 });
    return this.add(e);
  }

  // Vòng phép thuật dưới chân khi tung chiêu lớn
  magicCircle(getPos, color, dur, size = 2.6) {
    const m = new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const e = new FnEffect(this, (dt, el) => {
      const f = el / dur;
      const p = getPos();
      mesh.position.set(p.x, p.y + 0.05, p.z);
      mesh.rotation.z += dt * 1.5;
      const grow = Math.min(1, el * 6);
      mesh.scale.setScalar(size * (0.5 + 0.5 * grow));
      m.opacity = Math.min(1, el * 5) * (f > 0.75 ? (1 - f) / 0.25 : 1) * 0.9;
      if (Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2, r = size * 0.9;
        this.parts.emit(p.x + Math.cos(a) * r, p.y + 0.1, p.z + Math.sin(a) * r, 0, 2 + Math.random() * 2, 0, color, 0.25, 0.7, { drag: 0.5 });
      }
      return f < 1;
    });
    e.mats.push(m);
    const mesh = e.add(new THREE.Mesh(GEO.plane, m));
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(0.01);
    return this.add(e);
  }

  // Vụ nổ lớn
  explosion(p, color, radius = 3, core = 0xffffff) {
    p = p.clone();
    const P = this.parts;
    P.burst(p, Math.round(60 * this.quality * Math.min(2, radius / 3)), color, { speed: radius * 4, size: 0.7, life: 0.8, drag: 2.2 });
    P.burst(p, Math.round(14 * this.quality), core, { speed: radius * 2.5, size: 0.45, life: 0.4, drag: 3 });
    P.burst(p, 20, 0x554433, { speed: radius * 2, size: 0.6, life: 1.2, up: 1, grav: 6, drag: 1, jitter: 0.3 });
    const m1 = energyMat(color, color);
    const e = new FnEffect(this, (dt, el) => {
      const f = el / 0.55;
      ball.scale.setScalar(radius * (0.25 + 0.7 * Math.pow(Math.min(1, f), 0.4)));
      m1.uniforms.uOpacity.value = Math.max(0, 0.6 - f * 0.8);
      fl.material.opacity = Math.max(0, 0.75 - f * 1.4);
      fl.scale.setScalar(radius * 2.6 * (1 + f));
      return f < 1;
    });
    e.mats.push(m1);
    const ball = e.add(new THREE.Mesh(GEO.sphere, m1));
    ball.position.copy(p);
    const fl = e.add(sprite(color, radius * 5));
    e.mats.push(fl.material);
    fl.position.copy(p);
    this.add(e);
    this.shockwave(tmpV2.set(p.x, Math.max(0, p.y - 1.5), p.z), color, radius * 1.6, 0.6);
    this.shockwave(tmpV2.set(p.x, Math.max(0, p.y - 1.5), p.z), core, radius * 1.1, 0.4);
    this.flash(p, color, 60, 0.45);
    this.shake(0.25 + radius * 0.08, p);
  }

  // Tia lửa khi trúng đòn
  hitSpark(p, color, big = false) {
    p = p.clone();
    const P = this.parts;
    P.burst(p, big ? 28 : 16, color, { speed: big ? 10 : 7, size: 0.32, life: 0.35, drag: 4 });
    P.burst(p, 6, 0xffffff, { speed: 4, size: 0.5, life: 0.18, drag: 5 });
    const s = sprite(color, big ? 2.6 : 1.8);
    s.position.copy(p);
    const e = new FnEffect(this, (dt, el) => {
      s.material.opacity = 1 - el / 0.18;
      s.scale.setScalar((big ? 2.6 : 1.8) * (1 + el * 4));
      return el < 0.18;
    });
    e.add(s); e.mats.push(s.material);
    this.add(e);
  }

  // Hào quang khi vận khí (gọi mỗi frame)
  aura(p, color, dt) {
    const n = Math.ceil(dt * 90 * this.quality);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.5;
      this.parts.emit(p.x + Math.cos(a) * r, p.y + Math.random() * 0.5, p.z + Math.sin(a) * r,
        -Math.cos(a) * 0.6, 3.5 + Math.random() * 3, -Math.sin(a) * 0.6, color, 0.45, 0.55, { drag: 0.6, size1: 0.05 });
    }
    if (Math.random() < dt * 4) this.shockwave(p, color, 2.2, 0.5);
  }

  // Hiệu ứng hồi máu bám theo nhân vật
  healFx(getPos, dur) {
    const color = 0x7dff9b;
    const m = new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const e = new FnEffect(this, (dt, el) => {
      const p = getPos();
      if (!p) return false;
      circle.position.set(p.x, p.y + 0.06, p.z);
      circle.rotation.z -= dt;
      m.opacity = Math.min(1, el * 4) * Math.min(1, (dur - el) * 3) * 0.8;
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.1;
        this.parts.emit(p.x + Math.cos(a) * r, p.y + 0.1, p.z + Math.sin(a) * r, 0, 2 + Math.random() * 2, 0,
          Math.random() < 0.3 ? 0xffffff : color, 0.3, 0.9, { drag: 0.3 });
      }
      return el < dur;
    });
    e.mats.push(m);
    const circle = e.add(new THREE.Mesh(GEO.plane, m));
    circle.rotation.x = -Math.PI / 2;
    circle.scale.setScalar(2.4);
    return this.add(e);
  }

  // Vệt gió khi lướt (dash)
  dashTrail(p, dir, color = 0xffffff) {
    for (let i = 0; i < 3; i++) {
      this.parts.emit(p.x + (Math.random() - 0.5) * 0.6, p.y + 0.3 + Math.random() * 1.1, p.z + (Math.random() - 0.5) * 0.6,
        -dir.x * 4, 0, -dir.z * 4, color, 0.3, 0.3, { drag: 3 });
    }
  }

  dust(p, n = 10) {
    this.parts.burst(tmpV.set(p.x, p.y + 0.1, p.z), n, 0xc8b89a, { speed: 3, size: 0.45, life: 0.5, flat: true, drag: 3, jitter: 0.05 });
  }

  deathBurst(p, color) {
    this.explosion(tmpV.set(p.x, p.y + 0.8, p.z), color, 2);
    this.parts.burst(tmpV.set(p.x, p.y + 0.8, p.z), 40, 0xffffff, { speed: 5, size: 0.3, life: 1.2, up: 1, drag: 1, grav: -1 });
  }

  // =========================================================
  //   Hiệu ứng chiêu thức. ctx = { skill, p, d, h, seed, caster }
  //   caster: { pos(): Vector3, hand(): Vector3, yaw }
  // =========================================================
  castSkill(ctx) {
    const s = ctx.skill;
    if (s.mana >= 25) this.magicCircle(() => ctx.caster.pos(), s.fx.color, s.lock + 0.2, s.mana >= 55 ? 3.4 : 2.4);
    // tuyệt kỹ dị biến: tụ lực lâu với hiệu ứng tích lũy lớn
    if (s.bigCharge) this.chargeUp(() => ctx.caster.pos(), s.fx.color, s.fx.core || 0xffffff, s.delay);
    const build = SKILL_FX[s.type];
    if (!build) return null;
    // chiêu cuối điều hướng theo tâm: trạng thái chung, game.js cập nhật st.aim
    ctx.steer = s.steer ? initSteer(s, [ctx.p.x, ctx.p.y, ctx.p.z], [ctx.d.x, ctx.d.y, ctx.d.z], [ctx.h.x, ctx.h.z]) : null;
    const e = this.add(build(this, ctx));
    if (e) e.steer = ctx.steer;
    return e;
  }

  // cập nhật chướng ngại vật tạm thời (hiệu ứng gọi khi mọc lên / biến mất)
  addObstacle(o) { this.dynObs.push(o); return o; }
  removeObstacle(o) { const i = this.dynObs.indexOf(o); if (i >= 0) this.dynObs.splice(i, 1);
  }
}

// Kiểu hiệu ứng mượn hình của kiểu có sẵn, chỉ đổi màu (fx.crystal / fx.spike...)
const FX_ALIAS = { thorn: 'iceShard', vineSpike: 'iceSpike', bloom: 'frostNova', quake: 'frostNova', kunaiThrow: 'bolt',
  iceTomb: 'frostNova', iceLance: 'iceShard', windBlade: 'crescent', judgement: 'thunderRing', spearRod: 'bolt', pillarThrow: 'rock' };
const kindOf = s => FX_ALIAS[s.fx.kind] || s.fx.kind;

// Thảm hoa hồi xuân: hoa nở khắp vòng tròn, cánh hoa bay lên (vùng hồi máu)
function flowerField(fx, e, s, pos, color, core) {
  const P = fx.parts;
  const R = s.aura?.radius || s.radius;
  const g = e.add(new THREE.Group());
  g.position.copy(pos);
  const stemM = e.mat(new THREE.MeshToonMaterial({ color: 0x40916c }));
  const petalMs = [0xff8fab, 0xffc8dd, 0xfff3b0, 0xcdb4db].map(c => e.mat(new THREE.MeshToonMaterial({ color: c, emissive: 0x301018 })));
  const flowers = [];
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R * 0.95;
    const f = new THREE.Group();
    f.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    const stem = new THREE.Mesh(GEO.cylSeg, stemM);
    stem.scale.set(0.04, 0.4, 0.04); stem.position.y = 0.2;
    f.add(stem);
    const pm = petalMs[i % petalMs.length];
    for (let k = 0; k < 5; k++) {
      const pt = new THREE.Mesh(GEO.sphereLo, pm);
      const b = (k / 5) * Math.PI * 2;
      pt.scale.set(0.13, 0.04, 0.08);
      pt.position.set(Math.cos(b) * 0.1, 0.42, Math.sin(b) * 0.1);
      pt.rotation.y = -b;
      f.add(pt);
    }
    f.scale.setScalar(0.01);
    f.userData.t = Math.random() * 0.4;
    g.add(f);
    flowers.push(f);
  }
  const am = e.mat(new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  const aura = e.add(new THREE.Mesh(GEO.plane, am));
  aura.rotation.x = -Math.PI / 2;
  aura.position.set(pos.x, 0.06, pos.z);
  aura.scale.setScalar(R * 2);
  e.retarget = tg => { pos.set(tg[0], 0, tg[1]); g.position.copy(pos); aura.position.set(pos.x, 0.06, pos.z); };
  const end = s.delay + s.dur;
  let bloomed = false;
  e.update = (dt, el) => {
    if (el >= s.delay && !bloomed) {
      bloomed = true;
      fx.shockwave(pos, color, s.radius * 1.3, 0.5);
      P.burst(tmpV.set(pos.x, 0.5, pos.z), Math.round(40 * fx.quality), color, { speed: 7, size: 0.4, life: 0.8, up: 1.5 });
    }
    const fade = el > end - 0.5 ? Math.max(0.01, (end - el) / 0.5) : 1;
    for (const f of flowers) {
      const k = Math.min(1, Math.max(0.01, (el - s.delay * 0.5 - f.userData.t) * 4));
      f.scale.setScalar(k * fade * 1.4);
      f.rotation.y += dt * 0.5;
    }
    am.opacity = 0.35 * Math.min(1, el * 3) * fade;
    aura.rotation.z += dt * 0.4;
    if (Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * R;
      P.emit(pos.x + Math.cos(a) * r, 0.3, pos.z + Math.sin(a) * r, (Math.random() - 0.5), 1.2 + Math.random(), (Math.random() - 0.5), Math.random() < 0.5 ? core : color, 0.3, 1.2, { drag: 0.4 });
    }
    return el < end;
  };
  return e;
}

// Đặt một đoạn trụ nối 2 điểm a → b (dùng vẽ tia sét)
const SEG_UP = new THREE.Vector3(0, 1, 0), SEG_DIR = new THREE.Vector3();
function placeSeg(m, a, b, w) {
  SEG_DIR.subVectors(b, a);
  const L = SEG_DIR.length() || 1e-3;
  m.position.copy(a).addScaledVector(SEG_DIR, 0.5);
  m.quaternion.setFromUnitVectors(SEG_UP, SEG_DIR.multiplyScalar(1 / L));
  m.scale.set(w, L, w);
}

// ======================= Từng loại chiêu =======================
function vec(a) { return new THREE.Vector3(a[0], a[1], a[2]); }
const v3c = (x, y, z) => new THREE.Vector3(x, y, z);

const SKILL_FX = {
  // ---------- Cận chiến ----------
  melee(fx, { skill: s, caster, h }) {
    const kind = s.fx.kind;
    const color = s.fx.color;
    let fired = false;
    let arc, m;
    const e = new FnEffect(fx, (dt, el) => {
      if (!fired && el >= s.delay * 0.6) {
        fired = true;
        const p = caster.pos();
        if (kind === 'flameSlash') {
          // vệt lửa cháy trên sàn theo cung chém
          for (let i = 0; i < 16 * fx.quality; i++) {
            const a = Math.atan2(h.x, h.z) + (Math.random() - 0.5) * s.arc * 2, r = s.range * (0.4 + Math.random() * 0.6);
            fx.parts.emit(p.x + Math.sin(a) * r, p.y + 0.15, p.z + Math.cos(a) * r, 0, 2 + Math.random() * 2.5, 0, Math.random() < 0.3 ? 0xffd60a : color, 0.5, 0.7, { drag: 1 });
          }
        }
        if (kind === 'quakePunch') {
          // sóng chấn động hình nón: đá vụn bắn tung theo hướng đấm
          const a0 = Math.atan2(h.x, h.z);
          for (let i = 0; i < 26 * fx.quality; i++) {
            const a = a0 + (Math.random() - 0.5) * s.arc * 2, sp = 6 + Math.random() * 8;
            fx.parts.emit(p.x + h.x, p.y + 0.3, p.z + h.z, Math.sin(a) * sp, 2 + Math.random() * 4, Math.cos(a) * sp, Math.random() < 0.5 ? 0xb08968 : 0x7f5539, 0.45, 0.55, { drag: 2, grav: 12 });
          }
          fx.shockwave(tmpV2.set(p.x + h.x * 2, p.y, p.z + h.z * 2), color, 2.6, 0.35);
          fx.shake(0.15, p);
        }
        if (kind === 'slash' || kind === 'flameSlash') {
          m = arcMat(color, kind === 'flameSlash' ? 0xffd60a : 0xffffff);
          e.mats.push(m);
          arc = e.add(new THREE.Mesh(arcGeo(s.range * 0.35, s.range, s.arc * 2.1), m));
          arc.position.set(p.x, p.y + 0.85, p.z);
          arc.rotation.order = 'YXZ';
          arc.rotation.y = Math.atan2(h.x, h.z);
          arc.rotation.z = (Math.random() - 0.5) * 0.9;
        } else {
          const hp = tmpV.set(p.x + h.x * 1.1, p.y + 0.9, p.z + h.z * 1.1);
          fx.hitSpark(hp, color);
          fx.parts.burst(hp, 10, color, { speed: 5, size: 0.25, life: 0.25 });
        }
      }
      // phân thân bóng chém theo (dị biến Kage): vệt chém tím đậm lệch hai bên
      if (s.echo) {
        const n = Math.min(s.echo.n, Math.floor((el - s.delay * 0.6) / s.echo.gap));
        while (echoes.length < n) {
          const i = echoes.length, side = i % 2 ? 1 : -1, p = caster.pos();
          const em = arcMat(0x3c096c, s.fx.color);
          e.mats.push(em);
          const a2 = e.add(new THREE.Mesh(arcGeo(s.range * 0.3, s.range * 0.95, s.arc * 2), em));
          a2.position.set(p.x - h.z * side * 0.9 - h.x * 0.6, p.y + 0.7 + i * 0.25, p.z + h.x * side * 0.9 - h.z * 0.6);
          a2.rotation.order = 'YXZ';
          a2.rotation.y = Math.atan2(h.x, h.z) + side * 0.25;
          a2.rotation.z = side * 0.7;
          echoes.push({ a2, em, t0: el });
          fx.parts.burst(a2.position, 10, 0x240046, { speed: 3, size: 0.5, life: 0.4 });
        }
        for (const q of echoes) {
          const f = (el - q.t0) / 0.2;
          q.em.uniforms.uHead.value = Math.min(1.9, f * 2.4);
          q.em.uniforms.uOpacity.value = Math.max(0, 1 - Math.max(0, f - 0.4) * 1.6);
        }
      }
      const echoEnd = s.echo ? s.delay * 0.6 + s.echo.n * s.echo.gap + 0.25 : 0;
      if (arc) {
        const f = (el - s.delay * 0.6) / 0.22;
        m.uniforms.uHead.value = Math.min(1.9, f * 2.4);
        m.uniforms.uOpacity.value = Math.max(0, 1 - Math.max(0, f - 0.4) * 1.6);
        const p = caster.pos();
        arc.position.set(p.x, p.y + 0.85, p.z);
        return f < 1 || el < echoEnd;
      }
      return el < Math.max(s.delay + 0.1, echoEnd);
    });
    const echoes = [];
    return e;
  },

  // ---------- Đạn ----------
  projectile(fx, ctx) {
    const { skill: s, caster } = ctx;
    const kind = kindOf(s);
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const subs = [];
    const dy = ctx.d.y;
    for (let k = 0; k < s.count; k++) {
      const a = (k - (s.count - 1) / 2) * s.spread;
      const c = Math.cos(a), sn = Math.sin(a);
      const d = new THREE.Vector3(ctx.d.x * c - ctx.d.z * sn, dy, ctx.d.x * sn + ctx.d.z * c);
      const start = new THREE.Vector3(ctx.p.x + d.x * 0.6, ctx.p.y + 0.85 + d.y * 0.6, ctx.p.z + d.z * 0.6);
      const g = e.add(new THREE.Group());
      g.visible = false;
      let body;
      if (kind === 'shuriken') {
        const mm = e.mat(new THREE.MeshBasicMaterial({ color: core, side: THREE.DoubleSide }));
        body = new THREE.Mesh(GEO.shuriken, mm);
        body.rotation.x = -Math.PI / 2;
        g.add(body, sprite(color, 1.6, 0.9));
      } else if (kind === 'crescent') {
        const mm = e.mat(arcMat(s.fx.color, s.fx.core));
        mm.uniforms.uHead.value = 1.4;
        // lưỡi gió (windBlade): mỏng và rộng hơn trăng lửa
        body = new THREE.Mesh(s.fx.kind === 'windBlade' ? arcGeo(s.radius * 0.9, s.radius * 1.9, 2.2) : arcGeo(0.4, s.radius * 1.5, 2.6), mm);
        body.rotation.y = Math.PI;      // mặt lõm hướng về sau
        const holder = new THREE.Group();
        holder.add(body);
        holder.rotation.z = 0.35;
        g.add(holder, sprite(color, 2.5, 0.7));
      } else if (kind === 'iceShard') {
        const mm = e.mat(new THREE.MeshBasicMaterial({ color: core, transparent: true, opacity: 0.95 }));
        body = new THREE.Mesh(GEO.crystal, mm);
        const k = Math.max(1, s.radius / 0.4);   // băng thương to hơn mảnh băng thường
        body.scale.set(0.12 * k, 0.12 * k, 0.5 * k * (s.fx.kind === 'iceLance' ? 1.8 : 1));
        g.add(body, sprite(color, 1.1 * k, 0.8));
      } else if (kind === 'bolt') {
        // lôi tiễn: tia năng lượng dài
        const em = e.mat(energyMat(s.fx.color, s.fx.core));
        body = new THREE.Mesh(GEO.sphere, em);
        body.scale.set(s.radius * 0.55, s.radius * 0.55, s.radius * 3.2);
        g.add(body, sprite(color, 2.2, 0.8));
      } else if (kind === 'rock') {
        // đá tảng xoay tròn
        const rm = e.mat(new THREE.MeshToonMaterial({ color: s.fx.color, emissive: 0x2a1a0e }));
        if (s.fx.kind === 'pillarThrow') {
          // cột đá bị nhổ lên: khối trụ dài lộn vòng
          body = new THREE.Mesh(GEO.pillar, rm);
          body.scale.set(s.radius * 0.6, s.radius * 2, s.radius * 0.6);
          body.userData.spin = new THREE.Vector3(9, 0, 0);
        } else {
          body = new THREE.Mesh(GEO.rock, rm);
          body.scale.setScalar(s.radius);
          body.userData.spin = new THREE.Vector3(7, 4, 0);
        }
        g.add(body);
      } else if (kind === 'kiFist') {
        // khí quyền: nắm đấm năng lượng dẹt dài
        const em = e.mat(energyMat(s.fx.color, s.fx.core));
        body = new THREE.Mesh(GEO.sphere, em);
        body.scale.set(s.radius * 0.9, s.radius * 0.9, s.radius * 1.6);
        g.add(body, sprite(color, s.radius * 3, 0.6));
      } else {
        const big = kind === 'bigBomb';
        const em = e.mat(energyMat(s.fx.color, s.fx.core));
        body = new THREE.Mesh(GEO.sphere, em);
        body.scale.setScalar(s.radius * (big ? 1 : 0.8));
        g.add(body, sprite(color, s.radius * (big ? 2.4 : 3.2), big ? 0.45 : 0.7));
        if (big) {
          for (let r = 0; r < 3; r++) {
            const rm = e.mat(new THREE.MeshBasicMaterial({ color: core, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
            const ring = new THREE.Mesh(GEO.torus, rm);
            ring.scale.setScalar(s.radius * 1.35);
            ring.rotation.set(Math.random() * 3, Math.random() * 3, 0);
            ring.userData.spin = new THREE.Vector3(Math.random() * 3, Math.random() * 3, 0);
            g.add(ring);
          }
        }
      }
      g.lookAt(tmpV.copy(start).add(d));
      subs.push({ k, d, start, g, body, alive: true, dist: 0, pos: start.clone() });
    }
    const big = kind === 'bigBomb';
    e.update = (dt, el) => {
      let any = false;
      const tf = el - s.delay;
      // chiêu lớn: tụ năng lượng trên đầu trước khi phóng
      const st = ctx.steer;
      if (st && tf < 0) { const s0 = subs[0]; steerStep(st, s, dt, el, [s0.start.x, s0.start.y, s0.start.z]); s0.d.set(st.d[0], st.d[1], st.d[2]); }
      if (big && tf < 0) {
        const p = caster.pos();
        const sub = subs[0];
        sub.g.visible = true;
        sub.g.position.set(p.x, p.y + 3.2, p.z);
        const grow = Math.min(1, el / s.delay);
        sub.g.scale.setScalar(0.15 + grow * 0.85);
        for (let i = 0; i < 4; i++) {
          tmpV.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(5);
          fx.parts.emit(p.x + tmpV.x, p.y + 3.2 + tmpV.y, p.z + tmpV.z, -tmpV.x * 2.2, -tmpV.y * 2.2, -tmpV.z * 2.2, color, 0.35, 0.45, { drag: 0 });
        }
        for (const ch of sub.g.children) if (ch.userData.spin) ch.rotation.x += dt * 4;
        return true;
      }
      for (const sub of subs) {
        if (!sub.alive) continue;
        if (tf < 0) { any = true; continue; }
        let x, y, z;
        if (s.seek && ctx.seekTargets) {
          // đạn tự tìm (chỉ để vẽ, server tính trúng): bẻ dần về đối thủ gần nhất phía trước
          const P0 = sub.pos;
          let best = null, bd = 12;
          for (const q of (sub.tgs ||= ctx.seekTargets())) {
            tmpV2.set(q[0] - P0.x, q[1] - P0.y, q[2] - P0.z);
            const d = tmpV2.length();
            if (d > bd || d < 0.3 || tmpV2.dot(sub.d) / d < 0.5) continue;
            bd = d; best = tmpV2.clone().multiplyScalar(1 / d);
          }
          if (best) sub.d.lerp(best, Math.min(1, s.seek * dt)).normalize();
          const want = Math.min(s.range, tf * s.speed), step = Math.max(0, want - sub.dist);
          sub.dist = want;
          P0.addScaledVector(sub.d, step);
          x = P0.x; y = P0.y; z = P0.z;
        } else if (st) {
          // đạn được lái: tiến từng bước theo hướng hiện tại
          const P0 = sub.pos;
          steerStep(st, s, dt, el, [P0.x, P0.y, P0.z]);
          sub.d.set(st.d[0], st.d[1], st.d[2]);
          const want = Math.min(s.range, tf * s.speed), step = Math.max(0, want - sub.dist);
          sub.dist = want;
          P0.addScaledVector(sub.d, step);
          x = P0.x; y = P0.y; z = P0.z;
        } else {
          sub.dist = Math.min(s.range, tf * s.speed);
          x = sub.start.x + sub.d.x * sub.dist; y = sub.start.y + sub.d.y * sub.dist; z = sub.start.z + sub.d.z * sub.dist;
        }
        if (big && tf < 0.2) {
          const p = caster.pos();
          const q = tf / 0.2;
          sub.g.position.set(p.x + (x - p.x) * q, (p.y + 3.2) * (1 - q) + y * q, p.z + (z - p.z) * q);
        } else sub.g.position.set(x, y, z);
        sub.g.scale.setScalar(1);
        sub.g.visible = true;
        // chuyển động riêng
        if (kind === 'shuriken') sub.body.rotation.z += dt * 30;
        else if (kind === 'bolt') {
          sub.body.scale.x = sub.body.scale.y = s.radius * (0.4 + Math.random() * 0.3);
          if (Math.random() < 0.5) {
            const gp = sub.g.position;
            fx.parts.burst(tmpV.set(gp.x, gp.y, gp.z), 2, core, { speed: 5, size: 0.18, life: 0.18 });
          }
        }
        else if (kind === 'iceShard') sub.body.rotation.z += dt * 10;
        else if (kind === 'crescent' && s.fx.kind === 'windBlade') sub.g.rotation.z += dt * 2;
        for (const ch of sub.g.children) if (ch.userData.spin) { ch.rotation.x += ch.userData.spin.x * dt; ch.rotation.y += ch.userData.spin.y * dt; }
        // vệt đuôi
        const P = fx.parts, gp = sub.g.position;
        const tn = big ? 6 : kind === 'crescent' ? 5 : 2;
        for (let i = 0; i < tn * fx.quality; i++) {
          const r = big ? s.radius : kind === 'crescent' ? 1.2 : 0.15;
          P.emit(gp.x + (Math.random() - 0.5) * r, gp.y + (Math.random() - 0.5) * r, gp.z + (Math.random() - 0.5) * r,
            -sub.d.x * 2 + (Math.random() - 0.5), (kind === 'crescent' ? 1.5 : 0) + (Math.random() - 0.5), -sub.d.z * 2 + (Math.random() - 0.5),
            Math.random() < 0.3 ? core : color, big ? 0.9 : kind === 'crescent' ? 0.55 : 0.28, big ? 0.5 : 0.3, { drag: 2 });
        }
        if (sub.dist >= s.range || hitsObstacle(x, y, z, s.radius, fx.arena, fx.dynObs, ctx.owner, ctx.team)) {
          // máy chủ sẽ gửi 'pend'/'boom' — nhưng tự kết thúc để không bị trễ
          endSub(sub, gp, !s.explode);
        } else any = true;
      }
      return any;
    };
    const endSub = (sub, at, burst) => {
      if (!sub.alive) return;
      sub.alive = false;
      sub.g.visible = false;
      if (burst) {
        fx.parts.burst(at, kind === 'crescent' ? 24 : 12, color, { speed: 6, size: 0.35, life: 0.4, drag: 3 });
        if (kind === 'iceShard') fx.parts.burst(at, 6, 0xffffff, { speed: 4, size: 0.2, life: 0.5, grav: 8 });
      }
    };
    e.endSub = (k, at) => { const sub = subs[k]; if (sub) endSub(sub, at ? vec(at) : sub.g.position, true); };
    e.endAll = () => subs.forEach(sub => endSub(sub, sub.g.position, false));
    // lúc phóng: chớp sáng tay
    const hp = caster.hand();
    fx.parts.burst(hp, 8, color, { speed: 3, size: 0.3, life: 0.25 });
    return e;
  },

  // ---------- Lao tới ----------
  dash(fx, ctx) {
    const { skill: s, caster, h } = ctx;
    const kind = s.fx.kind;
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    let orb, orbMat, wings = [], body, boulder = null, boltAcc = 0, prevP = null;
    if (kind === 'spiralOrb') {
      orbMat = e.mat(energyMat(s.fx.color, s.fx.core));
      orb = e.add(new THREE.Mesh(GEO.sphere, orbMat));
      orb.scale.setScalar(0.01);
      for (let r = 0; r < 3; r++) {
        const rm = e.mat(new THREE.MeshBasicMaterial({ color: core, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
        const ring = new THREE.Mesh(GEO.torus, rm);
        ring.scale.setScalar(1.25);
        ring.rotation.set(r * 1.05, r * 0.7, 0);
        orb.add(ring);
      }
      orb.add(sprite(color, 4, 0.8));
    } else if (kind === 'phoenix') {
      body = e.add(new THREE.Group());
      const wm = e.mat(flowMat(s.fx.color, s.fx.core, { speed: 3, sx: 3, sy: 2, edge: 0.05 }));
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(GEO.wing, wm);
        w.scale.set(sx * 1.4, 1.4, 1.4);
        const holder = new THREE.Group();
        holder.add(w);
        holder.position.set(0, 1.2, -0.2);
        body.add(holder);
        wings.push(holder);
      }
      const em = e.mat(energyMat(s.fx.color, s.fx.core));
      const glow = new THREE.Mesh(GEO.sphere, em);
      glow.scale.set(1.0, 1.0, 1.8);
      glow.position.y = 1;
      body.add(glow, sprite(color, 6, 0.7));
      body.visible = false;
    }
    if (kind === 'rockRoll') {
      // tảng đá lăn bao quanh người
      const rm = e.mat(new THREE.MeshToonMaterial({ color: 0x8d6e53, emissive: 0x2a1a0e }));
      boulder = e.add(new THREE.Mesh(GEO.rock, rm));
      boulder.scale.setScalar(0.01);
    }
    let funnel = null, fmA = null, fmB = null;
    if (kind === 'dragonTornado') {
      // rồng lốc: phễu gió bao quanh người + dải gió xoắn
      fmA = e.mat(flowMat(s.fx.color, s.fx.core, { speed: 3, sx: 6, sy: 3, edge: 0.1 }));
      fmB = e.mat(flowMat(s.fx.color, 0xffffff, { speed: 5, sx: 8, sy: 4, edge: 0.15 }));
      funnel = e.add(new THREE.Group());
      const f1 = new THREE.Mesh(GEO.funnel, fmA), f2 = new THREE.Mesh(GEO.funnel, fmB);
      f1.scale.set(s.radius, 7, s.radius); f1.position.y = 3.5;
      f2.scale.set(s.radius * 0.7, 7.5, s.radius * 0.7); f2.position.y = 3.75;
      funnel.add(f1, f2);
      funnel.scale.setScalar(0.01);
    }
    if (s.fx.scale && body) body.userData.k = s.fx.scale;
    let lastPos = null;
    const st = ctx.steer;
    e.update = (dt, el) => {
      const p = caster.pos();
      const tf = el - s.delay;
      const moving = tf >= 0 && tf <= s.dur;
      if (st) { steerStep(st, s, dt, el, [p.x, p.y, p.z]); h.set(st.h[0], 0, st.h[1]); }
      if (kind === 'spiralOrb') {
        const hp = caster.hand();
        orb.position.copy(hp).addScaledVector(h, 0.3);
        const grow = Math.min(1, el / Math.max(0.05, s.delay));
        orb.scale.setScalar(0.65 * grow + (moving ? Math.sin(el * 40) * 0.05 : 0));
        orb.rotation.y += dt * 12; orb.rotation.x += dt * 7;
        for (let i = 0; i < 4; i++) {
          const a = el * 25 + i * Math.PI / 2;
          P.emit(orb.position.x + Math.cos(a) * 0.9, orb.position.y + Math.sin(a) * 0.9, orb.position.z,
            -Math.cos(a) * 3, -Math.sin(a) * 3, 0, i % 2 ? core : color, 0.25, 0.25, { drag: 0 });
        }
        if (tf > s.dur) {
          if (!e.state) { e.state = 1; fx.explosion(orb.position.clone(), s.fx.color, 1.8, s.fx.core); }
          return false;
        }
      } else if (kind === 'phoenix') {
        body.visible = true;
        body.position.set(p.x, p.y, p.z);
        body.rotation.y = Math.atan2(h.x, h.z);
        const flap = Math.sin(el * (moving ? 22 : 8)) * 0.5;
        wings[0].rotation.set(0, 0.5, 0.3 + flap);
        wings[1].rotation.set(0, -0.5, -0.3 - flap);
        const grow = Math.min(1, el / Math.max(0.05, s.delay));
        body.scale.setScalar(grow * (moving ? 1.3 : 1) * (s.fx.scale || 1));
        const n = (moving ? 14 : 5) * fx.quality;
        for (let i = 0; i < n; i++) {
          P.emit(p.x + (Math.random() - 0.5) * 2.5, p.y + 0.3 + Math.random() * 2, p.z + (Math.random() - 0.5) * 2.5,
            -h.x * 6 + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, -h.z * 6 + (Math.random() - 0.5) * 2,
            Math.random() < 0.2 ? core : color, 0.55, 0.5, { drag: 1.5 });
        }
        if (tf > s.dur + 0.1) return false;
      } else if (kind === 'thunderDash') {
        // lướt sét: tia sét nối các điểm đi qua + tia lửa điện
        if (moving) {
          boltAcc += dt;
          const cur = v3c(p.x, p.y + 1, p.z);
          if (prevP && boltAcc > 0.04) { fx.bolt(prevP, cur, s.fx.color, s.fx.core || 0xffffff, 0.06, false); boltAcc = 0; prevP = cur; }
          if (!prevP) prevP = cur;
          for (let i = 0; i < 6 * fx.quality; i++) {
            P.emit(p.x + (Math.random() - 0.5), p.y + 0.3 + Math.random() * 1.4, p.z + (Math.random() - 0.5), (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6,
              Math.random() < 0.4 ? core : color, 0.25, 0.25);
          }
        }
        if (tf > s.dur) {
          if (!e.state) { e.state = 1; fx.shockwave(p, color, 2.5); fx.bolt(v3c(p.x, p.y + 8, p.z), v3c(p.x, p.y + 0.1, p.z), s.fx.color, s.fx.core, 0.08, true); }
          return false;
        }
      } else if (kind === 'rockRoll') {
        // đá lăn: tảng đá xoay theo hướng lao, bụi đất phía sau
        const grow = Math.min(1, el / Math.max(0.05, s.delay));
        boulder.position.set(p.x, p.y + 0.9 * (s.fx.scale || 1), p.z);
        boulder.scale.setScalar(1.15 * (s.fx.scale || 1) * grow * (tf > s.dur ? Math.max(0, 1 - (tf - s.dur) * 6) : 1));
        if (moving) {
          boulder.rotateOnWorldAxis(tmpV.set(h.z, 0, -h.x).normalize(), dt * 18);
          for (let i = 0; i < 5 * fx.quality; i++) {
            P.emit(p.x - h.x + (Math.random() - 0.5), p.y + 0.2, p.z - h.z + (Math.random() - 0.5), -h.x * 3 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, -h.z * 3 + (Math.random() - 0.5) * 2,
              Math.random() < 0.5 ? 0xb08968 : 0x7f5539, 0.55, 0.5, { drag: 2, grav: 4 });
          }
        }
        if (tf > s.dur + 0.15) {
          if (!e.state) { e.state = 1; fx.dust(p, 20); fx.shockwave(p, color, 3); }
          return false;
        }
      } else if (kind === 'dragonTornado') {
        const grow = tf < 0 ? Math.max(0.01, el / s.delay) * 0.5 : Math.min(1, 0.5 + tf * 3);
        const fade = tf > s.dur ? Math.max(0, 1 - (tf - s.dur) * 4) : 1;
        funnel.position.set(p.x, p.y - 0.3, p.z);
        funnel.scale.set(grow * fade, grow, grow * fade);
        funnel.children[0].rotation.y += dt * 9; funnel.children[1].rotation.y -= dt * 13;
        fmA.uniforms.uOpacity.value = fmB.uniforms.uOpacity.value = 0.85 * fade;
        if (moving) {
          // dải gió xoắn như thân rồng quanh phễu
          for (let i = 0; i < 2; i++) {
            const a = el * 9 + i * Math.PI, yy = 1 + ((el * 3 + i * 0.5) % 1) * 5;
            P.emit(p.x + Math.cos(a) * s.radius * 0.9, p.y + yy, p.z + Math.sin(a) * s.radius * 0.9, -h.x * 3, 1, -h.z * 3, i ? core : color, 0.8, 0.5, { drag: 1.5 });
          }
          for (let i = 0; i < 6 * fx.quality; i++) {
            const a = Math.random() * Math.PI * 2, y = Math.random() * 6, r = (0.3 + y / 7) * s.radius;
            P.emit(p.x + Math.cos(a) * r, p.y + y, p.z + Math.sin(a) * r, -Math.sin(a) * 9, 2, Math.cos(a) * 9, Math.random() < 0.3 ? 0xd9c9a8 : color, 0.4, 0.35, { drag: 1 });
          }
          fx.shake(0.05, p);
        }
        if (tf > s.dur + 0.3) return false;
      } else if (kind === 'windDash' || kind === 'iceSkate') {
        // lướt gió: vòng gió xoắn quanh thân; trượt băng: để lại vệt băng trên sàn
        if (moving) {
          for (let i = 0; i < 6 * fx.quality; i++) {
            const a = el * 30 + i, r = 0.9;
            if (kind === 'windDash') P.emit(p.x + Math.cos(a) * r, p.y + 0.3 + Math.random() * 1.5, p.z + Math.sin(a) * r, -h.x * 6 - Math.sin(a) * 3, 1, -h.z * 6 + Math.cos(a) * 3, i % 2 ? core : color, 0.35, 0.35, { drag: 2 });
            else P.emit(p.x + (Math.random() - 0.5) * 1.4, p.y + 0.1, p.z + (Math.random() - 0.5) * 1.4, 0, 0.3, 0, i % 2 ? 0xffffff : color, 0.5, 1.4, { drag: 3 });
          }
          if (kind === 'iceSkate' && Math.random() < 0.5) P.burst(tmpV.set(p.x, p.y + 0.3, p.z), 4, 0xffffff, { speed: 4, size: 0.2, life: 0.5, up: 1, grav: 10 });
        }
        if (tf > s.dur) {
          if (!e.state) { e.state = 1; fx.shockwave(p, color, 3); P.burst(tmpV.set(p.x, p.y + 1, p.z), 20, core, { speed: 7, size: 0.35, life: 0.4 }); }
          return false;
        }
      } else if (kind === 'flurry') {
        // liên hoàn quyền: nhiều nắm đấm tàn ảnh dồn dập quanh hướng lao
        const big = s.fx.big;
        if (moving || (tf < 0 && big && Math.random() < 0.3)) {
          for (let i = 0; i < (big ? 3 : 2); i++) {
            const ox = (Math.random() - 0.5) * 1.6, oy = 0.5 + Math.random() * 1.1;
            const hp = tmpV.set(p.x + h.x * (1 + Math.random()) - h.z * ox, p.y + oy, p.z + h.z * (1 + Math.random()) + h.x * ox);
            P.emit(hp.x, hp.y, hp.z, h.x * 6, 0, h.z * 6, Math.random() < 0.4 ? core : color, big ? 0.9 : 0.6, 0.18, { drag: 6 });
          }
          if (moving && Math.random() < 0.35) fx.hitSpark(tmpV2.set(p.x + h.x * 1.6, p.y + 1, p.z + h.z * 1.6), s.fx.color, big);
        }
        if (tf > s.dur) {
          if (!e.state) { e.state = 1; fx.shockwave(p, color, big ? 5 : 3); }
          return false;
        }
      } else {
        // dashPunch: nắm đấm phát sáng + vệt tàn ảnh
        const hp = caster.hand();
        for (let i = 0; i < 3; i++) P.emit(hp.x, hp.y, hp.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, i ? color : core, 0.45, 0.2);
        if (moving) {
          for (let i = 0; i < 8 * fx.quality; i++) {
            P.emit(p.x + (Math.random() - 0.5) * 1.2, p.y + 0.2 + Math.random() * 1.4, p.z + (Math.random() - 0.5) * 1.2,
              -h.x * 10, 0, -h.z * 10, color, 0.35, 0.3, { drag: 4 });
          }
        }
        if (tf > s.dur) {
          if (!e.state) { e.state = 1; fx.shockwave(p, color, 3); fx.hitSpark(hp, s.fx.color, true); }
          return false;
        }
      }
      if (moving && lastPos && lastPos.distanceTo(p) > 0.01) fx.shake(0.08);
      lastPos = (lastPos || new THREE.Vector3()).copy(p);
      return true;
    };
    return e;
  },

  // ---------- Bẫy hạt giống ----------
  trap(fx, ctx) {
    const { skill: s } = ctx;
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    const pos = new THREE.Vector3(...(ctx.tg ? [ctx.tg[0], 0, ctx.tg[1]] : [ctx.p.x + ctx.h.x * s.offset, 0, ctx.p.z + ctx.h.z * s.offset]));
    const g = e.add(new THREE.Group());
    g.position.copy(pos);
    const leaf = e.mat(new THREE.MeshToonMaterial({ color: 0x40916c }));
    const bud = new THREE.Mesh(GEO.sphereLo, e.mat(new THREE.MeshToonMaterial({ color: s.fx.core || 0xffafcc, emissive: 0x401020 })));
    bud.scale.set(0.22, 0.3, 0.22); bud.position.y = 0.35;
    g.add(bud);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(GEO.sphereLo, leaf);
      l.scale.set(0.32, 0.05, 0.14);
      const a = i * Math.PI / 2;
      l.position.set(Math.cos(a) * 0.28, 0.08, Math.sin(a) * 0.28);
      l.rotation.y = -a;
      g.add(l);
    }
    const rm = e.mat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    const ring = e.add(new THREE.Mesh(GEO.ring, rm));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.06, pos.z);
    ring.scale.setScalar(s.radius);
    g.scale.setScalar(0.01);
    let gone = 0, fired = false;
    e.retarget = tg => { pos.set(tg[0], 0, tg[1]); g.position.copy(pos); ring.position.set(pos.x, 0.06, pos.z); };
    e.endSub = (k, at, fire) => {
      if (gone) return;
      gone = e.el;
      if (fire) {
        // sập bẫy: dây leo bật lên quấn chặt
        fired = true;
        for (let i = 0; i < 7; i++) {
          const sp = new THREE.Mesh(GEO.cone, leaf);
          const a = (i / 7) * Math.PI * 2;
          sp.position.set(pos.x + Math.cos(a) * 0.7, 0.6, pos.z + Math.sin(a) * 0.7);
          sp.rotation.set(Math.sin(a) * -0.5, 0, Math.cos(a) * 0.5);
          sp.scale.set(0.18, 1.3, 0.18);
          e.add(sp);
        }
        P.burst(tmpV.set(pos.x, 0.6, pos.z), 30, color, { speed: 6, size: 0.35, life: 0.6, up: 1.5 });
        P.burst(tmpV.set(pos.x, 0.8, pos.z), 16, core, { speed: 3, size: 0.4, life: 0.8, up: 1 });
        fx.shockwave(pos, color, s.radius * 1.3, 0.4);
      }
    };
    e.endAll = () => e.endSub(0, null, false);
    e.update = (dt, el) => {
      const armed = el >= s.delay + s.arm;
      g.scale.setScalar(Math.min(1, el * 4) * (1 + (armed ? Math.sin(el * 4) * 0.06 : 0)));
      rm.opacity = armed && !gone ? 0.25 + Math.sin(el * 3) * 0.1 : 0;
      if (gone) {
        const f = (el - gone) / (fired ? 0.9 : 0.4);
        g.scale.setScalar(Math.max(0.01, 1 - f));
        for (const o of e.objs) if (o !== g && o !== ring) o.scale.y = Math.max(0.01, (1 - f) * 1.3);
        return f < 1;
      }
      return el < s.delay + s.dur;
    };
    return e;
  },

  // ---------- Triệu hồi: cây thần ----------
  summon(fx, ctx) {
    const { skill: s } = ctx;
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    const pos = new THREE.Vector3(...(ctx.tg ? [ctx.tg[0], 0, ctx.tg[1]] : [ctx.p.x + ctx.h.x * s.offset, 0, ctx.p.z + ctx.h.z * s.offset]));
    if (s.fx.kind === 'flowerField') return flowerField(fx, e, s, pos, color, core);
    const g = e.add(new THREE.Group());
    g.position.copy(pos);
    const bark = e.mat(new THREE.MeshToonMaterial({ color: 0x7f5539 }));
    const leafM = e.mat(new THREE.MeshToonMaterial({ color: s.fx.color, emissive: 0x0b3d20 }));
    const R = s.obstacle?.r || 1.6, H = s.obstacle?.h || 6;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.85, H * 0.7, 9), bark);
    trunk.position.y = H * 0.35;
    g.add(trunk);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const root = new THREE.Mesh(GEO.cone, bark);
      root.scale.set(0.35, 1.6, 0.35);
      root.position.set(Math.cos(a) * R * 0.9, 0.3, Math.sin(a) * R * 0.9);
      root.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
      g.add(root);
    }
    for (const [x, y, z, r] of [[0, H * 0.82, 0, 2.4], [1.3, H * 0.7, 0.4, 1.6], [-1.2, H * 0.72, -0.5, 1.7], [0.2, H * 0.98, -0.9, 1.5]]) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafM);
      c.position.set(x, y, z);
      g.add(c);
    }
    const am = e.mat(new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const aura = e.add(new THREE.Mesh(GEO.plane, am));
    aura.rotation.x = -Math.PI / 2;
    aura.position.set(pos.x, 0.06, pos.z);
    aura.scale.setScalar((s.aura?.radius || 5) * 2);
    g.scale.setScalar(0.01);
    let obs = null, up = false;
    e.retarget = tg => { pos.set(tg[0], 0, tg[1]); g.position.copy(pos); aura.position.set(pos.x, 0.06, pos.z); if (obs) { obs.x = pos.x; obs.z = pos.z; } };
    const end = s.delay + s.dur;
    e.update = (dt, el) => {
      if (el < s.delay) {
        // mầm cây đang trồi lên
        if (Math.random() < 0.7) P.emit(pos.x + (Math.random() - 0.5) * 2, 0.2, pos.z + (Math.random() - 0.5) * 2, 0, 3, 0, 0x9c6644, 0.4, 0.4, { grav: 6 });
        return true;
      }
      if (!up) {
        up = true;
        obs = fx.addObstacle({ x: pos.x, z: pos.z, r: R, h: H });
        fx.shockwave(pos, color, s.radius * 1.3, 0.5);
        fx.dust(pos, 24);
        P.burst(tmpV.set(pos.x, 1, pos.z), 40, color, { speed: 9, size: 0.45, life: 0.7, up: 2 });
        fx.shake(0.3, pos);
      }
      const grow = Math.min(1, (el - s.delay) / 0.35);
      const fade = el > end - 0.6 ? Math.max(0.01, (end - el) / 0.6) : 1;
      g.scale.set(fade, grow * fade, fade);
      g.rotation.y = Math.sin(el * 0.8) * 0.04;
      am.opacity = 0.35 * fade * (0.8 + Math.sin(el * 3) * 0.2);
      aura.rotation.z += dt * 0.3;
      // hạt sáng xanh bay lên quanh cây (vùng hồi máu)
      if (Math.random() < 0.8) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * (s.aura?.radius || 5);
        P.emit(pos.x + Math.cos(a) * r, 0.2, pos.z + Math.sin(a) * r, 0, 1.5 + Math.random(), 0, Math.random() < 0.5 ? core : 0x95d5b2, 0.3, 1);
      }
      if (el >= end) { fx.removeObstacle(obs); return false; }
      return true;
    };
    const dispose = e.dispose.bind(e);
    e.dispose = () => { if (obs) fx.removeObstacle(obs); dispose(); };
    return e;
  },

  // ---------- Nhảy đập đất ----------
  leap(fx, ctx) {
    const { skill: s, caster } = ctx;
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    const to = new THREE.Vector3(...(ctx.tg ? [ctx.tg[0], 0, ctx.tg[1]] : [ctx.p.x + ctx.h.x * 10, 0, ctx.p.z + ctx.h.z * 10]));
    // vòng chỉ điểm đáp
    const tm = e.mat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    const mark = e.add(new THREE.Mesh(GEO.ring, tm));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(to.x, 0.07, to.z);
    e.retarget = tg => { to.set(tg[0], 0, tg[1]); mark.position.set(to.x, 0.07, to.z); };
    const land = s.delay + s.dur;
    const W = s.walls;
    const kind = s.fx.kind;
    const fiery = kind === 'flameDive' || kind === 'meteorDrop';
    // thiên thạch: người hóa tảng đá rực lửa khi rơi
    let shell = null;
    if (kind === 'meteorDrop') {
      shell = e.add(new THREE.Mesh(GEO.rock, e.mat(new THREE.MeshToonMaterial({ color: 0x5c3b28, emissive: 0x8a2b0a }))));
      shell.visible = false;
    }
    let landed = false;
    e.update = (dt, el) => {
      mark.scale.setScalar(s.radius * (0.6 + 0.4 * Math.min(1, el / land)));
      tm.opacity = landed ? 0 : 0.5 + Math.sin(el * 12) * 0.2;
      const p = caster.pos();
      if (!landed && el > s.delay) {
        // vệt bụi đá (hoặc lửa) khi bay
        const n = (fiery ? 9 : 4) * fx.quality;
        for (let i = 0; i < n; i++) P.emit(p.x + (Math.random() - 0.5), p.y + Math.random(), p.z + (Math.random() - 0.5), (Math.random() - 0.5) * 2, fiery ? 2 : -2, (Math.random() - 0.5) * 2,
          fiery ? (Math.random() < 0.3 ? core : color) : (Math.random() < 0.5 ? 0xb08968 : color), fiery ? 0.8 : 0.5, 0.5, { drag: 1 });
        if (shell) {
          const fall = (el - s.delay) / s.dur > 0.5;
          shell.visible = fall;
          shell.position.set(p.x, p.y + 1, p.z);
          shell.scale.setScalar(1.6);
          shell.rotation.x += dt * 8; shell.rotation.z += dt * 5;
        }
      }
      if (!landed && el >= land) {
        landed = true;
        if (shell) shell.visible = false;
        const big = s.radius >= 6;
        fx.shockwave(to, color, s.radius * 1.4, 0.55);
        fx.shockwave(to, core, s.radius * 0.8, 0.35);
        fx.dust(to, big ? 60 : 40);
        P.burst(tmpV.set(to.x, 0.5, to.z), Math.round((big ? 80 : 50) * fx.quality), fiery ? color : 0x9c6644, { speed: big ? 16 : 12, size: 0.6, life: 0.8, up: 2, grav: 14 });
        if (fiery) P.burst(tmpV.set(to.x, 0.5, to.z), Math.round(30 * fx.quality), core, { speed: 8, size: 0.5, life: 0.6, up: 2 });
        fx.flash(tmpV.set(to.x, 2, to.z), s.fx.color, 30, 0.4);
        fx.shake(big ? 0.9 : 0.6, to);
        if (W) fx.stoneWalls(to.clone(), W, ctx.seed);
      }
      return !landed || el < land + 0.1;
    };
    return e;
  },

  // ---------- Dịch chuyển bóng tối: chỉ là làn khói khi bắt đầu, phần dịch chuyển đến từ gói 'tp' ----------
  blink(fx, ctx) {
    const { skill: s, caster } = ctx;
    const e = new Effect(fx);
    const p = caster.pos();
    fx.parts.burst(tmpV.set(p.x, p.y + 1, p.z), 18, s.fx.color, { speed: 3, size: 0.6, life: 0.5 });
    e.update = (dt, el) => el < s.delay + 0.3;
    return e;
  },

  // ---------- Tường gió: chặn đạn đối thủ ----------
  wall(fx, ctx) {
    const { skill: s, h } = ctx;
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    const c = new THREE.Vector3(...(ctx.tg ? [ctx.tg[0], 0, ctx.tg[1]] : [ctx.p.x + h.x * s.offset, 0, ctx.p.z + h.z * s.offset]));
    // màu lõi = màu chính (không dùng trắng) để tường to không bị bloom trắng xoá
    const fm = e.mat(flowMat(s.fx.color, s.fx.color, { speed: 4, sx: 3, sy: 2, edge: 0.15 }));
    const g = e.add(new THREE.Group());
    const pane = new THREE.Mesh(GEO.plane, fm);
    pane.scale.set(s.width, s.height, 1);
    pane.position.y = s.height / 2;
    g.add(pane);
    const pane2 = new THREE.Mesh(GEO.plane, fm);
    pane2.scale.set(s.width * 0.9, s.height * 0.85, 1);
    pane2.position.set(0, s.height * 0.45, 0.25);
    g.add(pane2);
    g.position.copy(c);
    g.rotation.y = Math.atan2(h.x, h.z);
    g.scale.set(0.01, 0.01, 1);
    const obs = [];
    let up = false;
    e.retarget = tg => { c.set(tg[0], 0, tg[1]); g.position.copy(c); };
    const end = s.delay + s.dur;
    e.update = (dt, el) => {
      if (el >= s.delay && !up) {
        up = true;
        const w = s.width / 2;
        for (let i = 0; i < s.segs; i++) {
          const f = s.segs > 1 ? i / (s.segs - 1) * 2 - 1 : 0;
          obs.push(fx.addObstacle({ x: c.x - h.z * f * w, z: c.z + h.x * f * w, r: s.segR, h: s.height, pass: ctx.owner, passTeam: ctx.team || null, noBody: true, lift: s.lift || 0 }));
        }
        fx.shockwave(c, color, s.width * 0.6, 0.4);
        P.burst(tmpV.set(c.x, 1.5, c.z), 30, color, { speed: 8, size: 0.4, life: 0.5 });
      }
      const grow = Math.min(1, Math.max(0.01, (el - s.delay * 0.5) * 6)), fade = el > end - 0.4 ? Math.max(0.01, (end - el) / 0.4) : 1;
      g.scale.set(grow, grow * fade, 1);
      fm.uniforms.uOpacity.value = 0.42 * fade;
      // gió cuộn dọc mặt tường
      for (let i = 0; i < 4 * fx.quality; i++) {
        const f = Math.random() * 2 - 1, y = Math.random() * s.height;
        P.emit(c.x - h.z * f * s.width / 2, y, c.z + h.x * f * s.width / 2, h.x * 2, 3, h.z * 2, Math.random() < 0.4 ? core : color, 0.3, 0.4, { drag: 1 });
      }
      if (el >= end) { for (const o of obs) fx.removeObstacle(o); obs.length = 0; return false; }
      return true;
    };
    const dispose = e.dispose.bind(e);
    e.dispose = () => { for (const o of obs) fx.removeObstacle(o); dispose(); };
    return e;
  },

  // ---------- Dựng Sơn Trụ: vòng chỉ điểm + đất rung; cột đá thật đến từ gói 'prop' của server ----------
  pillar(fx, ctx) {
    const { skill: s } = ctx;
    const color = col(s.fx.color);
    const e = new Effect(fx);
    const at = new THREE.Vector3(...(ctx.tg ? [ctx.tg[0], 0, ctx.tg[1]] : [ctx.p.x + ctx.h.x * 8, 0, ctx.p.z + ctx.h.z * 8]));
    const tm = e.mat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    const mark = e.add(new THREE.Mesh(GEO.ring, tm));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(at.x, 0.07, at.z);
    e.retarget = tg => { at.set(tg[0], 0, tg[1]); mark.position.set(at.x, 0.07, at.z); };
    let pv = null;
    e.update = (dt, el) => {
      mark.scale.setScalar(s.r * 1.6 * (0.6 + 0.4 * Math.min(1, el / s.delay)));
      tm.opacity = el < s.delay ? 0.45 + Math.sin(el * 20) * 0.2 : 0;
      if (el < s.delay && Math.random() < 0.6) fx.parts.emit(at.x + (Math.random() - 0.5) * 2, 0.15, at.z + (Math.random() - 0.5) * 2, 0, 2.5, 0, 0x9c6644, 0.35, 0.4, { grav: 8 });
      // màn xem trước ở menu không có server: tự dựng cột đá giả rồi cho lún xuống
      if (ctx.preview && el >= s.delay && !pv) pv = fx.prop({ k: 'pillar', p: [at.x, 0, at.z], r: s.r, h: s.h });
      if (pv && el > s.delay + 2.4) { pv.end('time'); return false; }
      return ctx.preview ? true : el < s.delay + 0.2;
    };
    return e;
  },

  // ---------- Địa Chấn Toàn Sân: vòng cảnh báo lan rộng khi tụ lực, rồi sóng động đất phủ cả sân ----------
  quake(fx, ctx) {
    const { skill: s, caster } = ctx;
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    const wm = e.mat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    const warn = e.add(new THREE.Mesh(GEO.ring, wm));
    warn.rotation.x = -Math.PI / 2;
    const cm = e.mat(new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    const disc = e.add(new THREE.Mesh(GEO.plane, cm));
    disc.rotation.x = -Math.PI / 2;
    let boomed = false, at = null;
    e.update = (dt, el) => {
      const p = at || caster.pos();
      if (el < s.delay) {
        const f = el / s.delay;
        warn.position.set(p.x, 0.09, p.z);
        warn.scale.setScalar(s.range * (0.15 + 0.85 * f));
        wm.opacity = 0.4 + Math.sin(el * 18) * 0.2;
        disc.position.set(p.x, 0.07, p.z);
        disc.scale.setScalar(s.range * 2 * f);
        disc.rotation.z += dt * 0.6;
        cm.opacity = 0.18 * f;
        // đất đá nảy lên khắp vùng
        for (let i = 0; i < 4 * fx.quality; i++) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s.range * f;
          P.emit(p.x + Math.cos(a) * r, 0.1, p.z + Math.sin(a) * r, 0, 2 + Math.random() * 3, 0, Math.random() < 0.5 ? 0x9c6644 : 0xb08968, 0.35, 0.5, { grav: 12 });
        }
        if (f > 0.4) fx.shake(0.04 + f * 0.08, p);
        return true;
      }
      if (!boomed) {
        boomed = true;
        at = p.clone();
        fx.shockwave(at, color, s.range, 0.8);
        fx.shockwave(at, core, s.range * 0.6, 0.6);
        fx.shockwave(at, 0x9c6644, s.range * 0.35, 0.5);
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2, r = s.range * (0.3 + (i % 3) * 0.3);
          fx.dust(tmpV2.set(at.x + Math.cos(a) * r, 0, at.z + Math.sin(a) * r), 8);
        }
        P.burst(tmpV.set(at.x, 0.5, at.z), Math.round(70 * fx.quality), 0x9c6644, { speed: 18, size: 0.6, life: 1, flat: true, grav: 6 });
        P.burst(tmpV.set(at.x, 0.5, at.z), Math.round(30 * fx.quality), color, { speed: 10, size: 0.5, life: 0.7, up: 2, grav: 10 });
        fx.flash(tmpV.set(at.x, 2, at.z), s.fx.color, 18, 0.4);
        fx.shake(1.1, at);
      }
      const k = (el - s.delay) / 0.6;
      warn.scale.setScalar(s.range);
      wm.opacity = Math.max(0, 0.5 * (1 - k));
      cm.opacity = Math.max(0, 0.25 * (1 - k));
      return k < 1;
    };
    return e;
  },

  // ---------- Thiên Lôi Phán Quyết: vòng sét trên trời, tia sét đến từ gói 'chain' (sky) ----------
  smite(fx, ctx) {
    const { skill: s, caster } = ctx;
    const color = col(s.fx.color);
    const e = new Effect(fx);
    const cm = e.mat(new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const sky = e.add(new THREE.Mesh(GEO.plane, cm));
    sky.rotation.x = -Math.PI / 2;
    e.update = (dt, el) => {
      const p = caster.pos(), f = Math.min(1, el / s.delay);
      sky.position.set(p.x, p.y + 12, p.z);
      sky.scale.setScalar(s.range * 1.2 * (0.3 + f * 0.7));
      sky.rotation.z += dt * (1 + f * 3);
      cm.opacity = el < s.delay ? f * 0.8 : Math.max(0, 0.8 - (el - s.delay) * 2);
      if (el < s.delay && Math.random() < dt * 12) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * s.range * 0.5;
        fx.bolt(new THREE.Vector3(p.x + Math.cos(a) * r, p.y + 12, p.z + Math.sin(a) * r), new THREE.Vector3(p.x + Math.cos(a) * r * 0.6, p.y + 9, p.z + Math.sin(a) * r * 0.6), s.fx.color, s.fx.core, 0.05, false);
      }
      return el < s.delay + 0.5;
    };
    return e;
  },

  // ---------- Vạn Ảnh Táng: khói bóng lúc tụ lực; các cú dịch chuyển đến từ gói 'tp' ----------
  multiblink(fx, ctx) {
    const { skill: s, caster } = ctx;
    const e = new Effect(fx);
    e.update = (dt, el) => {
      const p = caster.pos();
      if (el < s.delay && Math.random() < 0.7) fx.parts.emit(p.x + (Math.random() - 0.5) * 2, p.y + Math.random() * 2, p.z + (Math.random() - 0.5) * 2, 0, 1, 0, Math.random() < 0.2 ? s.fx.core : 0x10002b, 0.9, 0.6, { drag: 1 });
      return el < s.delay + s.strikes * s.interval + 0.3;
    };
    return e;
  },

  // ---------- Tăng chỉ số tạm thời ----------
  buff(fx, ctx) {
    const { skill: s, caster } = ctx;
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    const p0 = caster.pos();
    if (s.fx.kind === 'stealth') {
      // làn khói tím bùng lên rồi tan: nhân vật biến mất
      P.burst(tmpV.set(p0.x, p0.y + 1, p0.z), 40, 0x240046, { speed: 4, size: 0.9, life: 0.8, drag: 2 });
      P.burst(tmpV.set(p0.x, p0.y + 1, p0.z), 16, core, { speed: 6, size: 0.3, life: 0.4 });
      e.update = (dt, el) => el < 0.5;
      return e;
    }
    // giáp đá: các mảnh đá bay quanh người
    const rm = e.mat(new THREE.MeshToonMaterial({ color: 0x9c6644, emissive: 0x2a1a0e }));
    const rocks = [];
    for (let i = 0; i < 7; i++) {
      const m = e.add(new THREE.Mesh(GEO.rock, rm));
      m.scale.setScalar(0.28 + Math.random() * 0.12);
      m.userData.a = (i / 7) * Math.PI * 2;
      m.userData.y = 0.3 + (i % 3) * 0.6;
      rocks.push(m);
    }
    fx.shockwave(p0, color, 2.5, 0.4);
    P.burst(tmpV.set(p0.x, p0.y + 1, p0.z), 24, color, { speed: 5, size: 0.4, life: 0.5 });
    const end = s.delay + s.dur;
    e.update = (dt, el) => {
      const p = caster.pos();
      const grow = Math.min(1, el * 4), fade = el > end - 0.3 ? Math.max(0, (end - el) / 0.3) : 1;
      for (const m of rocks) {
        const a = m.userData.a + el * 2.2;
        m.position.set(p.x + Math.cos(a) * 0.95 * grow, p.y + m.userData.y + Math.sin(el * 3 + a) * 0.08, p.z + Math.sin(a) * 0.95 * grow);
        m.rotation.x += dt * 2; m.rotation.y += dt * 3;
        m.visible = fade > 0.02;
        m.scale.setScalar((0.28 + (m.userData.a % 0.12)) * fade * grow + 0.001);
      }
      return el < end;
    };
    e.buffOf = null;
    return e;
  },

  // ---------- Tia năng lượng ----------
  beam(fx, ctx) {
    const { skill: s, caster } = ctx;
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    const d = ctx.d.clone().normalize();
    const start = new THREE.Vector3(ctx.p.x + d.x * 0.8, ctx.p.y + 0.85 + d.y * 0.8, ctx.p.z + d.z * 0.8);
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, d);
    const outerM = e.mat(flowMat(s.fx.color, s.fx.core, { speed: 6, sx: 3, sy: 10, edge: 0.02 }));
    const innerM = e.mat(flowMat(s.fx.core || 0xffffff, 0xffffff, { speed: 9, sx: 2, sy: 6, edge: 0.01, additive: true }));
    const group = e.add(new THREE.Group());
    group.position.copy(start);
    group.quaternion.copy(quat);
    const outer = new THREE.Mesh(GEO.cylOpen, outerM);
    const inner = new THREE.Mesh(GEO.cylOpen, innerM);
    for (const m of [outer, inner]) { m.position.y = s.length / 2; m.scale.set(1, s.length, 1); }
    group.add(outer, inner);
    const tipM = e.mat(energyMat(s.fx.color, s.fx.core));
    const chargeBall = e.add(new THREE.Mesh(GEO.sphere, tipM));
    const glow = e.add(sprite(color, 3, 0.9));
    e.mats.push(glow.material);
    group.visible = false;
    const st = ctx.steer;
    e.update = (dt, el) => {
      const tf = el - s.delay;
      // chưởng lái theo tâm: xoay tia theo hướng mới
      if (st && st.mode === 'aim') {
        steerStep(st, s, dt, el);
        d.set(st.d[0], st.d[1], st.d[2]);
        quat.setFromUnitVectors(UP, d);
        group.quaternion.copy(quat);
      }
      if (tf < 0) {
        // tụ khí
        const f = el / s.delay;
        chargeBall.position.copy(start);
        chargeBall.scale.setScalar(0.2 + f * 0.7);
        glow.position.copy(start);
        glow.scale.setScalar(1 + f * 4);
        for (let i = 0; i < 5; i++) {
          tmpV.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(3);
          P.emit(start.x + tmpV.x, start.y + tmpV.y, start.z + tmpV.z, -tmpV.x * 3, -tmpV.y * 3, -tmpV.z * 3, color, 0.3, 0.33, { drag: 0 });
        }
        return true;
      }
      if (tf <= s.dur + 0.25) {
        group.visible = true;
        const fade = tf > s.dur ? 1 - (tf - s.dur) / 0.25 : Math.min(1, tf * 10);
        const w = s.width * (0.9 + Math.sin(el * 50) * 0.1) * fade;
        outer.scale.set(w * 1.2, s.length, w * 1.2);
        inner.scale.set(w * 0.45, s.length, w * 0.45);
        outerM.uniforms.uOpacity.value = fade;
        innerM.uniforms.uOpacity.value = fade * 1.5;
        chargeBall.scale.setScalar(s.width * 1.4 * fade);
        glow.scale.setScalar(6 * fade);
        // tia lửa dọc tia + điểm cuối
        const end = tmpV2.copy(start).addScaledVector(d, s.length);
        for (let i = 0; i < 6 * fx.quality; i++) {
          const t = Math.random() * s.length;
          tmpV.copy(start).addScaledVector(d, t);
          P.emit(tmpV.x, tmpV.y, tmpV.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6,
            Math.random() < 0.4 ? core : color, 0.35, 0.3, { drag: 3 });
        }
        P.burst(end, 4, color, { speed: 8, size: 0.6, life: 0.3 });
        if (Math.random() < 0.3) fx.flash(end, s.fx.color, 25, 0.15);
        fx.shake(0.12, start);
        return true;
      }
      return false;
    };
    return e;
  },

  // ---------- Vùng sát thương ----------
  aoe(fx, ctx) {
    const { skill: s, caster, h } = ctx;
    const kind = kindOf(s);
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    const center = () => ctx.steer ? tmpV2.set(ctx.steer.c[0], 0, ctx.steer.c[2])
      : s.at === 'front' ? tmpV2.set(ctx.p.x + h.x * s.offset, 0, ctx.p.z + h.z * s.offset)
      : caster.pos();
    const active = s.delay + Math.max(0.3, (s.ticks - 1) * s.tickInt);

    if (kind === 'flameRing') {
      // vòng cột lửa xoay quanh người
      const fm = e.mat(flowMat(s.fx.color, s.fx.core, { speed: 5, sx: 4, sy: 2, edge: 0.12 }));
      const g = e.add(new THREE.Group());
      const N = 8;
      for (let i = 0; i < N; i++) {
        const m = new THREE.Mesh(GEO.cylOpen, fm);
        const a = (i / N) * Math.PI * 2;
        m.position.set(Math.cos(a) * s.radius * 0.85, 1.5, Math.sin(a) * s.radius * 0.85);
        m.scale.set(0.55, 3, 0.55);
        g.add(m);
      }
      g.scale.setScalar(0.01);
      e.update = (dt, el) => {
        const c = caster.pos();
        g.position.set(c.x, c.y, c.z);
        g.rotation.y += dt * 4;
        const grow = Math.min(1, Math.max(0.01, (el - s.delay * 0.5) * 5)), fade = el > active ? Math.max(0.01, 1 - (el - active) / 0.35) : 1;
        g.scale.set(grow, grow * fade, grow);
        fm.uniforms.uOpacity.value = fade;
        for (let i = 0; i < 5 * fx.quality; i++) {
          const a = Math.random() * Math.PI * 2, r = s.radius * (0.7 + Math.random() * 0.3);
          P.emit(c.x + Math.cos(a) * r, c.y + Math.random() * 2.5, c.z + Math.sin(a) * r, -Math.sin(a) * 3, 3 + Math.random() * 3, Math.cos(a) * 3, Math.random() < 0.3 ? core : color, 0.5, 0.45, { drag: 1 });
        }
        return el < active + 0.35;
      };
      return e;
    }

    if (kind === 'eternalWinter') {
      // bão tuyết lớn bám theo người: tuyết xoáy, sàn đóng băng, vòng phép băng
      const gm = e.mat(new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      const ground = e.add(new THREE.Mesh(GEO.plane, gm));
      ground.rotation.x = -Math.PI / 2;
      const im = e.mat(new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0, depthWrite: false }));
      const ice = e.add(new THREE.Mesh(new THREE.CircleGeometry(1, 40), im));
      ice.rotation.x = -Math.PI / 2;
      let ticked = -1;
      e.update = (dt, el) => {
        const c = caster.pos();
        const on = el >= s.delay && el < active + 0.3;
        ground.position.set(c.x, c.y + 0.05, c.z);
        ice.position.set(c.x, c.y + 0.04, c.z);
        const f = Math.min(1, Math.max(0, (el - s.delay * 0.6) * 3));
        ground.scale.setScalar(s.radius * 2 * f);
        ice.scale.setScalar(s.radius * f);
        ground.rotation.z += dt * 0.8;
        const fade = el > active ? Math.max(0, 1 - (el - active) / 0.6) : 1;
        gm.opacity = 0.6 * f * fade; im.opacity = 0.18 * f * fade;
        if (on) {
          for (let i = 0; i < 14 * fx.quality; i++) {
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s.radius, y = Math.random() * 6;
            P.emit(c.x + Math.cos(a) * r, c.y + y, c.z + Math.sin(a) * r, -Math.sin(a) * 7, -2, Math.cos(a) * 7, Math.random() < 0.6 ? 0xffffff : color, 0.3, 0.6, { drag: 0.5 });
          }
          const n = Math.floor((el - s.delay) / s.tickInt);
          if (n > ticked) { ticked = n; fx.shockwave(c, color, s.radius, 0.5); }
        }
        return el < active + 0.6;
      };
      return e;
    }

    if (kind === 'stoneCage') {
      // đất nứt trồi lên ở điểm phía trước rồi dựng vòng cột đá
      const c0 = center().clone();
      let fired = false;
      e.update = (dt, el) => {
        if (el < s.delay) {
          if (Math.random() < 0.8) P.emit(c0.x + (Math.random() - 0.5) * s.radius * 2, 0.2, c0.z + (Math.random() - 0.5) * s.radius * 2, 0, 3, 0, 0x9c6644, 0.4, 0.4, { grav: 6 });
          return true;
        }
        if (!fired) {
          fired = true;
          fx.shockwave(c0, color, s.radius * 1.4, 0.45);
          P.burst(tmpV.set(c0.x, 0.5, c0.z), Math.round(40 * fx.quality), 0x9c6644, { speed: 10, size: 0.55, life: 0.7, up: 2, grav: 14 });
          fx.shake(0.35, c0);
          if (s.walls) fx.stoneWalls(c0, s.walls, ctx.seed);
        }
        return false;
      };
      return e;
    }

    if (kind === 'tornado') {
      const fm = e.mat(flowMat(s.fx.color, s.fx.core, { speed: 2.5, sx: 6, sy: 3, edge: 0.1 }));
      const fm2 = e.mat(flowMat(s.fx.color, 0xffffff, { speed: 4, sx: 8, sy: 4, edge: 0.15 }));
      const g = e.add(new THREE.Group());
      const f1 = new THREE.Mesh(GEO.funnel, fm);
      const f2 = new THREE.Mesh(GEO.funnel, fm2);
      f1.scale.set(s.radius, 9, s.radius); f1.position.y = 4.5;
      f2.scale.set(s.radius * 0.7, 9.5, s.radius * 0.7); f2.position.y = 4.75;
      g.add(f1, f2);
      g.scale.setScalar(0.01);
      e.update = (dt, el) => {
        if (ctx.steer) steerStep(ctx.steer, s, dt, el);
        const c = center();
        g.position.set(c.x, 0, c.z);
        const grow = Math.min(1, Math.max(0, (el - s.delay * 0.4) / (s.delay * 0.8)));
        const fade = el > active ? 1 - (el - active) / 0.5 : 1;
        g.scale.set(grow * (1 + Math.sin(el * 7) * 0.05), grow, grow * (1 + Math.cos(el * 7) * 0.05));
        f1.rotation.y += dt * 8; f2.rotation.y -= dt * 11;
        fm.uniforms.uOpacity.value = fm2.uniforms.uOpacity.value = Math.max(0, fade);
        if (grow > 0.2 && fade > 0) {
          for (let i = 0; i < 10 * fx.quality; i++) {
            const a = Math.random() * Math.PI * 2, y = Math.random() * 9, r = (0.3 + y / 9) * s.radius;
            P.emit(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r, -Math.sin(a) * 9, 3, Math.cos(a) * 9,
              Math.random() < 0.3 ? 0xd9c9a8 : color, 0.4, 0.4, { drag: 1 });
          }
          fx.shake(0.06, c);
        }
        if (Math.random() < dt * 5) fx.shockwave(c, color, s.radius * 1.3, 0.5);
        return el < active + 0.5;
      };
      return e;
    }

    if (kind === 'bladeStorm') {
      const g = e.add(new THREE.Group());
      const m = e.mat(arcMat(s.fx.color, 0xffffff));
      m.uniforms.uHead.value = 1.2;
      for (let i = 0; i < 3; i++) {
        const a = new THREE.Mesh(arcGeo(s.radius * 0.45, s.radius, 1.6), m);
        a.rotation.y = i * Math.PI * 2 / 3;
        a.position.y = 0.4 + i * 0.35;
        g.add(a);
      }
      // vòng xoáy lao đi (at: 'front'): to hơn, thêm phễu xoáy và nhiều tầng lưỡi đao
      let funnel = null, fm = null;
      if (s.at === 'front') {
        g.scale.setScalar(1.3);
        for (let i = 3; i < 6; i++) {
          const a = new THREE.Mesh(arcGeo(s.radius * 0.35, s.radius * 0.9, 1.4), m);
          a.rotation.y = i * Math.PI * 2 / 3 + 0.5;
          a.position.y = 0.6 + i * 0.4;
          g.add(a);
        }
        fm = e.mat(flowMat(s.fx.color, s.fx.core, { speed: 3, sx: 6, sy: 3, edge: 0.12 }));
        funnel = e.add(new THREE.Mesh(GEO.funnel, fm));
        funnel.scale.set(s.radius * 0.9, 4, s.radius * 0.9);
      }
      e.update = (dt, el) => {
        if (ctx.steer) steerStep(ctx.steer, s, dt, el);
        const c = center();
        g.position.set(c.x, c.y, c.z);
        g.rotation.y -= dt * 18;
        if (funnel) {
          const grow = Math.min(1, el / Math.max(0.05, s.delay));
          funnel.position.set(c.x, c.y + 2, c.z);
          funnel.rotation.y += dt * 9;
          funnel.scale.set(s.radius * 0.9 * grow, 4 * grow, s.radius * 0.9 * grow);
          fm.uniforms.uOpacity.value = el > active ? Math.max(0, 1 - (el - active) / 0.3) : 0.85;
          for (let i = 0; i < 6 * fx.quality; i++) {
            const a = Math.random() * Math.PI * 2, r = s.radius * (0.4 + Math.random() * 0.7);
            P.emit(c.x + Math.cos(a) * r, c.y + Math.random() * 3.5, c.z + Math.sin(a) * r, -Math.sin(a) * 10, 1.5, Math.cos(a) * 10,
              Math.random() < 0.3 ? core : 0x240046, 0.45, 0.35, { drag: 2 });
          }
        }
        const tf = el - s.delay;
        const fade = tf < 0 ? Math.max(0, el / s.delay) * 0.4 : el > active ? 1 - (el - active) / 0.3 : 1;
        m.uniforms.uOpacity.value = Math.max(0, fade);
        for (let i = 0; i < 6 * fx.quality; i++) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * s.radius;
          P.emit(c.x + Math.cos(a) * r, c.y + 0.2 + Math.random() * 1.5, c.z + Math.sin(a) * r, -Math.sin(a) * 8, 0.5, Math.cos(a) * 8, color, 0.3, 0.3, { drag: 2 });
        }
        return el < active + 0.3;
      };
      return e;
    }

    if (kind === 'flameRise') {
      const fm = e.mat(flowMat(s.fx.color, s.fx.core, { speed: 4, sx: 5, sy: 2, edge: 0.15 }));
      const col1 = e.add(new THREE.Mesh(GEO.funnel, fm));
      col1.rotation.x = Math.PI;
      let fired = false;
      e.update = (dt, el) => {
        const c = caster.pos();
        const f = el / 0.8;
        col1.position.set(c.x, c.y + 1.5, c.z);
        col1.scale.set(s.radius * (0.6 + f * 0.6), 3.5 + f * 2, s.radius * (0.6 + f * 0.6));
        col1.rotation.y += dt * 10;
        fm.uniforms.uOpacity.value = Math.max(0, 1 - f);
        // rồng lửa xoắn ốc đi lên
        for (let i = 0; i < 3; i++) {
          const a = el * 18 + i * 2.1, r = 1.2 - f * 0.4;
          P.emit(c.x + Math.cos(a) * r, c.y + 0.3 + f * 3 + i * 0.3, c.z + Math.sin(a) * r, 0, 6, 0, i ? color : core, 0.7, 0.5, { drag: 2 });
        }
        if (!fired && el >= s.delay) {
          fired = true;
          fx.shockwave(c, color, s.radius * 1.6, 0.4);
          P.burst(c, 40, color, { speed: 9, size: 0.6, life: 0.6, up: 1.5 });
          fx.flash(c, s.fx.color, 40, 0.4);
        }
        return f < 1;
      };
      return e;
    }

    if (kind === 'frostNova') {
      const crystals = [];
      for (let i = 0; i < 12; i++) {
        const cm = e.mat(new THREE.MeshToonMaterial({ color: s.fx.crystal ?? 0xbdf0ff, emissive: s.fx.crystalGlow ?? 0x3aa0d0, transparent: true, opacity: 0.85 }));
        const m = e.add(new THREE.Mesh(kind === 'frostNova' && s.fx.kind === 'quake' ? GEO.rock : GEO.cone, cm));
        m.userData.a = (i / 12) * Math.PI * 2;
        m.userData.h = 1 + Math.random() * 1.2;
        m.scale.setScalar(0.01);
        crystals.push(m);
      }
      let fired = false;
      const groundM = e.mat(new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const ground = e.add(new THREE.Mesh(GEO.plane, groundM));
      ground.rotation.x = -Math.PI / 2;
      ground.visible = !s.fx.noCircle;
      e.update = (dt, el) => {
        const c = caster.pos();
        ground.position.set(c.x, c.y + 0.04, c.z);
        const tf = el - s.delay;
        ground.scale.setScalar(s.radius * 2 * Math.min(1, el * 3));
        ground.rotation.z += dt * 0.6;
        groundM.opacity = el < 1.2 ? 0.8 : Math.max(0, 0.8 - (el - 1.2) * 1.5);
        if (tf < 0) {
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2, r = s.radius;
            P.emit(c.x + Math.cos(a) * r, c.y + 0.3, c.z + Math.sin(a) * r, -Math.cos(a) * r * 2.5, 1, -Math.sin(a) * r * 2.5, color, 0.3, 0.4, { drag: 0 });
          }
        } else {
          if (!fired) {
            fired = true;
            fx.shockwave(c, color, s.radius * 1.1, 0.5);
            fx.shockwave(c, 0xffffff, s.radius * 0.8, 0.35);
            P.burst(tmpV.set(c.x, c.y + 0.5, c.z), 60, color, { speed: 14, size: 0.4, life: 0.6, flat: true, drag: 3 });
            P.burst(tmpV.set(c.x, c.y + 0.5, c.z), 30, 0xffffff, { speed: 5, size: 0.25, life: 1.2, up: 1, grav: 2 });
            fx.flash(c, s.fx.color, 40, 0.5);
            fx.shake(0.3, c);
          }
          for (const m of crystals) {
            const g = Math.min(1, tf * 8);
            const shrink = tf > 1.1 ? Math.max(0, 1 - (tf - 1.1) * 3) : 1;
            const r = s.radius * 0.75 * g;
            m.position.set(c.x + Math.cos(m.userData.a) * r, c.y + m.userData.h * 0.4, c.z + Math.sin(m.userData.a) * r);
            m.scale.set(0.35 * shrink, m.userData.h * shrink, 0.35 * shrink);
            m.rotation.set(Math.sin(m.userData.a) * 0.5, 0, -Math.cos(m.userData.a) * 0.5);
          }
        }
        return el < s.delay + 1.5;
      };
      return e;
    }

    if (kind === 'thunderRing') {
      // vòng phép tím + sét đánh xuống quanh vòng mỗi nhịp
      const groundM = e.mat(new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const ground = e.add(new THREE.Mesh(GEO.plane, groundM));
      ground.rotation.x = -Math.PI / 2;
      let fired = 0;
      e.update = (dt, el) => {
        const c = center();
        ground.position.set(c.x, c.y + 0.05, c.z);
        ground.scale.setScalar(s.radius * 2.1 * Math.min(1, el * 3));
        ground.rotation.z -= dt * 1.5;
        groundM.opacity = el > active ? Math.max(0, 0.8 - (el - active) * 2) : 0.8;
        // tia điện chạy trên vòng
        if (Math.random() < 0.6) {
          const a = Math.random() * Math.PI * 2;
          P.emit(c.x + Math.cos(a) * s.radius, c.y + 0.2, c.z + Math.sin(a) * s.radius, 0, 2 + Math.random() * 3, 0, core, 0.25, 0.25);
        }
        const n = Math.floor((el - s.delay) / (s.tickInt || 1e9));
        if (el >= s.delay && n >= fired && fired < s.ticks) {
          fired++;
          for (let i = 0; i < 4; i++) {
            const a = Math.random() * Math.PI * 2, r = s.radius * (0.35 + Math.random() * 0.65);
            const to = new THREE.Vector3(c.x + Math.cos(a) * r, c.y + 0.1, c.z + Math.sin(a) * r);
            fx.bolt(new THREE.Vector3(to.x + (Math.random() - 0.5) * 2, to.y + 11, to.z + (Math.random() - 0.5) * 2), to, s.fx.color, s.fx.core, 0.07, i === 0);
          }
          fx.shockwave(c, color, s.radius, 0.35);
          fx.shake(0.15, c);
        }
        return el < active + 0.4;
      };
      return e;
    }

    if (kind === 'shadowMist') {
      // màn sương đen đặc tại chỗ ra chiêu (server tính vùng ở vị trí ra chiêu)
      const c0 = new THREE.Vector3(ctx.p.x, ctx.p.y, ctx.p.z);
      const dm = e.mat(new THREE.MeshBasicMaterial({ color: 0x10002b, transparent: true, opacity: 0, depthWrite: false }));
      const disc = e.add(new THREE.Mesh(new THREE.CircleGeometry(1, 32), dm));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(c0.x, c0.y + 0.05, c0.z);
      disc.scale.setScalar(s.radius);
      e.update = (dt, el) => {
        const on = el < active;
        dm.opacity = on ? Math.min(0.55, el * 3) : Math.max(0, 0.55 - (el - active) * 1.5);
        if (on) {
          for (let i = 0; i < 9 * fx.quality; i++) {
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s.radius;
            P.emit(c0.x + Math.cos(a) * r, c0.y + 0.2 + Math.random() * 1.2, c0.z + Math.sin(a) * r,
              (Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5,
              Math.random() < 0.15 ? core : (Math.random() < 0.5 ? 0x240046 : 0x10002b), 1.1 + Math.random() * 0.9, 0.9, { drag: 1 });
          }
        }
        return el < active + 0.5;
      };
      return e;
    }

    // mặc định: vòng nổ
    let fired = 0;
    e.update = (dt, el) => {
      const n = Math.floor((el - s.delay) / (s.tickInt || 1e9));
      if (el >= s.delay && n >= fired && fired < s.ticks) { fired++; fx.shockwave(center(), color, s.radius); }
      return el < active + 0.3;
    };
    return e;
  },

  // ---------- Chuỗi nổ theo đường thẳng ----------
  line(fx, ctx) {
    const { skill: s, h } = ctx;
    const kind = kindOf(s);
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    const items = [];
    for (let i = 0; i < s.count; i++) {
      const dist = s.start + i * s.spacing;
      const pos = new THREE.Vector3(ctx.p.x + h.x * dist, 0, ctx.p.z + h.z * dist);
      const t0 = s.delay + i * s.interval;
      const g = e.add(new THREE.Group());
      g.position.copy(pos);
      g.visible = false;
      if (kind === 'firePillar') {
        const fm = e.mat(flowMat(s.fx.color, s.fx.core, { speed: 5, sx: 4, sy: 2, edge: 0.12 }));
        const pillar = new THREE.Mesh(GEO.cylOpen, fm);
        pillar.scale.set(s.radius * 0.8, 6, s.radius * 0.8);
        pillar.position.y = 3;
        g.add(pillar);
        g.userData.mat = fm;
      } else {
        // gai băng: cụm hình nón
        const cm = e.mat(new THREE.MeshToonMaterial({ color: s.fx.spike ?? 0xbdf0ff, emissive: s.fx.spikeGlow ?? 0x2f8ac0, transparent: true, opacity: 0.9 }));
        for (let j = 0; j < 4; j++) {
          const sp = new THREE.Mesh(GEO.cone, cm);
          const a = Math.random() * Math.PI * 2, r = j ? 0.45 : 0;
          sp.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
          sp.rotation.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
          sp.userData.h = j ? 1.0 + Math.random() * 0.6 : 2.0;
          g.add(sp);
        }
        g.userData.mat = cm;
      }
      items.push({ g, t0, pos, fired: false });
    }
    const life = kind === 'firePillar' ? 0.65 : 1.3;
    e.update = (dt, el) => {
      let any = false;
      for (const it of items) {
        const tf = el - it.t0;
        if (tf < 0) { any = true; continue; }
        if (tf > life) { it.g.visible = false; continue; }
        any = true;
        it.g.visible = true;
        if (!it.fired) {
          it.fired = true;
          fx.shockwave(it.pos, color, s.radius * 1.5, 0.35);
          P.burst(tmpV.set(it.pos.x, 0.3, it.pos.z), 18, color, { speed: 7, size: 0.5, life: 0.5, up: 2 });
          fx.flash(tmpV.set(it.pos.x, 1.5, it.pos.z), s.fx.color, 20, 0.25);
          fx.shake(0.1, it.pos);
        }
        if (kind === 'firePillar') {
          const up = Math.min(1, tf * 9), fade = tf > life * 0.55 ? 1 - (tf - life * 0.55) / (life * 0.45) : 1;
          it.g.scale.set(fade, up, fade);
          it.g.rotation.y += dt * 6;
          it.g.userData.mat.uniforms.uOpacity.value = fade;
          for (let i = 0; i < 3 * fx.quality; i++) {
            P.emit(it.pos.x + (Math.random() - 0.5) * s.radius, Math.random() * 5 * up, it.pos.z + (Math.random() - 0.5) * s.radius,
              0, 5 + Math.random() * 4, 0, Math.random() < 0.3 ? core : color, 0.6, 0.45, { drag: 1 });
          }
        } else {
          const up = Math.min(1, tf * 12), fade = tf > life * 0.7 ? Math.max(0.01, 1 - (tf - life * 0.7) / (life * 0.3)) : 1;
          for (const sp of it.g.children) {
            sp.scale.set(0.3 * fade, sp.userData.h * up * fade, 0.3 * fade);
            sp.position.y = sp.userData.h * up * fade * 0.5;
          }
          if (tf < 0.05) P.burst(tmpV.set(it.pos.x, 0.5, it.pos.z), 8, 0xffffff, { speed: 5, size: 0.25, life: 0.6, up: 1, grav: 10 });
        }
      }
      return any;
    };
    return e;
  },

  // ---------- Mưa băng ----------
  rain(fx, ctx) {
    const { skill: s, h } = ctx;
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    const c = new THREE.Vector3(ctx.p.x + h.x * s.offset, 0, ctx.p.z + h.z * s.offset);
    const pts = rainPoints(s, ctx.seed);
    const skyY = 11;
    // vòng phép trên trời + dưới đất
    const cm = e.mat(new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const sky = e.add(new THREE.Mesh(GEO.plane, cm));
    sky.rotation.x = -Math.PI / 2;
    sky.position.set(c.x, skyY, c.z);
    const gm = e.mat(new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    const ground = e.add(new THREE.Mesh(GEO.plane, gm));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(c.x, 0.05, c.z);
    const kind = s.fx.kind;
    // hình của mỗi "giọt": băng nhọn (mặc định), thiên thạch, cánh hoa; sét thì không có hình rơi
    const thorn = kind === 'thornForest';   // rừng gai: gai trồi từ dưới đất lên thay vì rơi từ trời
    if (thorn) { sky.visible = false; }
    const im = e.mat(kind === 'meteor' ? new THREE.MeshToonMaterial({ color: 0x5c3b28, emissive: 0x8a2b0a })
      : kind === 'petalRain' ? new THREE.MeshToonMaterial({ color: s.fx.color, emissive: 0x5a1030, side: THREE.DoubleSide })
      : thorn ? new THREE.MeshToonMaterial({ color: 0x2d6a4f, emissive: 0x0b2015 })
      : new THREE.MeshToonMaterial({ color: 0xd8f6ff, emissive: 0x3a8fc0 }));
    const drops = pts.map(([ox, oz], i) => {
      const m = e.add(new THREE.Mesh(kind === 'meteor' ? GEO.rock : kind === 'petalRain' ? GEO.sphereLo : GEO.cone, im));
      if (kind === 'meteor') m.scale.setScalar(s.radius * 0.45);
      else if (kind === 'petalRain') m.scale.set(0.85, 0.08, 0.5);
      else if (thorn) { m.scale.set(0.45, 0.01, 0.45); m.rotation.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5); }
      else { m.scale.set(0.35, 1.6, 0.35); m.rotation.x = Math.PI; }
      m.visible = false;
      return { m, ox, oz, x: c.x + ox, z: c.z + oz, t0: s.delay + i * s.interval, landed: false };
    });
    const total = s.delay + s.count * s.interval + s.fall + (s.fx.kind === 'thornForest' ? 2 : 0.6);
    e.update = (dt, el) => {
      if (ctx.steer) {
        // vùng mưa trôi theo tâm: vòng phép đi theo, băng chưa chạm đất cũng đi theo
        steerStep(ctx.steer, s, dt, el);
        c.set(ctx.steer.c[0], 0, ctx.steer.c[2]);
        sky.position.set(c.x, skyY, c.z);
        ground.position.set(c.x, 0.05, c.z);
        for (const d of drops) if (!d.landed) { d.x = c.x + d.ox; d.z = c.z + d.oz; }
      }
      const f = Math.min(1, el * 2.5);
      const fade = el > total - 0.6 ? Math.max(0, (total - el) / 0.6) : 1;
      sky.scale.setScalar(s.area * 2.4 * f);
      ground.scale.setScalar(s.area * 2.2 * f);
      sky.rotation.z += dt * 0.8; ground.rotation.z -= dt * 0.5;
      cm.opacity = 0.9 * fade; gm.opacity = 0.45 * fade;
      if (Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * s.area;
        P.emit(c.x + Math.cos(a) * r, skyY, c.z + Math.sin(a) * r, 0, -4, 0, 0xffffff, 0.2, 1.5, { drag: 0 });
      }
      for (const d of drops) {
        const tf = el - d.t0;
        if (tf < 0) continue;
        if (thorn) {
          // gai trồi lên khi tới lượt, đứng một lúc rồi thụt xuống
          const k = Math.min(1, tf / Math.max(0.05, s.fall)), down = tf > 1.6 ? Math.max(0.01, 1 - (tf - 1.6) * 3) : 1;
          d.m.visible = tf < 2;
          d.m.position.set(d.x, 0, d.z);
          d.m.scale.set(0.45 * down, Math.max(0.01, 2.6 * k * down), 0.45 * down);
          d.m.position.y = d.m.scale.y * 0.5;
          if (!d.landed && tf >= s.fall) {
            d.landed = true;
            P.burst(tmpV.set(d.x, 0.4, d.z), 10, color, { speed: 5, size: 0.35, life: 0.5, up: 2, grav: 10 });
            P.burst(tmpV.set(d.x, 1, d.z), 4, core, { speed: 3, size: 0.35, life: 0.6 });
            fx.shockwave(tmpV.set(d.x, 0.05, d.z), color, s.radius * 1.1, 0.3);
          }
          continue;
        }
        if (tf < s.fall && kind !== 'lightning') {
          d.m.visible = true;
          const k = tf / s.fall;
          if (kind === 'meteor') {
            // rơi chéo từ trên cao, vệt lửa phía sau
            d.m.position.set(d.x - 6 * (1 - k), skyY + 6 - (skyY + 5.2) * k, d.z - 3 * (1 - k));
            d.m.rotation.x += dt * 6; d.m.rotation.z += dt * 4;
            for (let j = 0; j < 3; j++) P.emit(d.m.position.x, d.m.position.y, d.m.position.z, -4 + Math.random() * 2, 3 + Math.random() * 2, -2 + Math.random(),
              j ? color : core, 0.9, 0.45, { drag: 2 });
          } else if (kind === 'petalRain') {
            // cánh hoa xoay lượn
            d.m.position.set(d.x + Math.sin(tf * 9 + d.t0 * 7) * 0.6 * (1 - k), skyY - (skyY - 0.6) * k, d.z + Math.cos(tf * 7 + d.t0 * 5) * 0.6 * (1 - k));
            d.m.rotation.set(tf * 8, tf * 5 + d.t0, tf * 3);
            if (Math.random() < 0.5) P.emit(d.m.position.x, d.m.position.y, d.m.position.z, 0, 1, 0, core, 0.2, 0.3);
          } else {
            d.m.position.set(d.x, skyY - (skyY - 0.8) * k, d.z);
            P.emit(d.m.position.x, d.m.position.y + 1, d.m.position.z, 0, 4, 0, color, 0.3, 0.2);
          }
        } else if (!d.landed && tf >= s.fall) {
          d.landed = true;
          d.m.visible = false;
          const at = tmpV.set(d.x, 0.3, d.z);
          if (kind === 'lightning') {
            fx.bolt(new THREE.Vector3(d.x + (Math.random() - 0.5) * 3, skyY, d.z + (Math.random() - 0.5) * 3), new THREE.Vector3(d.x, 0.1, d.z), s.fx.color, s.fx.core, 0.09);
          } else if (kind === 'meteor') {
            P.burst(at, 26, color, { speed: 9, size: 0.6, life: 0.6, up: 2, grav: 10 });
            P.burst(at, 12, 0x6b4a33, { speed: 5, size: 0.5, life: 0.9, up: 1.5, grav: 12 });
            fx.flash(tmpV.set(d.x, 1.5, d.z), s.fx.color, 30, 0.3);
            fx.shake(0.18, at);
          }
          P.burst(at, kind === 'petalRain' ? 8 : 14, color, { speed: 6, size: 0.3, life: 0.5, up: 1, grav: 12 });
          P.burst(at, 6, core, { speed: 3, size: 0.4, life: 0.3 });
          fx.shockwave(at, color, s.radius * 1.2, 0.3);
          fx.shake(0.05, at);
        }
      }
      return el < total;
    };
    return e;
  },
};
