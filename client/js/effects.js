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
  }

  add(e) { this.list.push(e); return e; }

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
    const build = SKILL_FX[s.type];
    if (!build) return null;
    // chiêu cuối điều hướng theo tâm: trạng thái chung, game.js cập nhật st.aim
    ctx.steer = s.steer ? initSteer(s, [ctx.p.x, ctx.p.y, ctx.p.z], [ctx.d.x, ctx.d.y, ctx.d.z], [ctx.h.x, ctx.h.z]) : null;
    const e = this.add(build(this, ctx));
    if (e) e.steer = ctx.steer;
    return e;
  }
}

// ======================= Từng loại chiêu =======================
function vec(a) { return new THREE.Vector3(a[0], a[1], a[2]); }

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
        if (kind === 'slash') {
          m = arcMat(color, 0xffffff);
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
      if (arc) {
        const f = (el - s.delay * 0.6) / 0.22;
        m.uniforms.uHead.value = Math.min(1.9, f * 2.4);
        m.uniforms.uOpacity.value = Math.max(0, 1 - Math.max(0, f - 0.4) * 1.6);
        const p = caster.pos();
        arc.position.set(p.x, p.y + 0.85, p.z);
        return f < 1;
      }
      return el < s.delay + 0.1;
    });
    return e;
  },

  // ---------- Đạn ----------
  projectile(fx, ctx) {
    const { skill: s, caster } = ctx;
    const kind = s.fx.kind;
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
        body = new THREE.Mesh(arcGeo(0.4, s.radius * 1.5, 2.6), mm);
        body.rotation.y = Math.PI;      // mặt lõm hướng về sau
        const holder = new THREE.Group();
        holder.add(body);
        holder.rotation.z = 0.35;
        g.add(holder, sprite(color, 2.5, 0.7));
      } else if (kind === 'iceShard') {
        const mm = e.mat(new THREE.MeshBasicMaterial({ color: core, transparent: true, opacity: 0.95 }));
        body = new THREE.Mesh(GEO.crystal, mm);
        body.scale.set(0.12, 0.12, 0.5);
        g.add(body, sprite(color, 1.1, 0.8));
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
        if (st) {
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
        else if (kind === 'iceShard') sub.body.rotation.z += dt * 10;
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
        if (sub.dist >= s.range || hitsObstacle(x, y, z, s.radius)) {
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
    let orb, orbMat, wings = [], body;
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
        body.scale.setScalar(grow * (moving ? 1.3 : 1));
        const n = (moving ? 14 : 5) * fx.quality;
        for (let i = 0; i < n; i++) {
          P.emit(p.x + (Math.random() - 0.5) * 2.5, p.y + 0.3 + Math.random() * 2, p.z + (Math.random() - 0.5) * 2.5,
            -h.x * 6 + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, -h.z * 6 + (Math.random() - 0.5) * 2,
            Math.random() < 0.2 ? core : color, 0.55, 0.5, { drag: 1.5 });
        }
        if (tf > s.dur + 0.1) return false;
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
    e.update = (dt, el) => {
      const tf = el - s.delay;
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
    const kind = s.fx.kind;
    const color = col(s.fx.color), core = col(s.fx.core || 0xffffff);
    const e = new Effect(fx);
    const P = fx.parts;
    const center = () => ctx.steer ? tmpV2.set(ctx.steer.c[0], 0, ctx.steer.c[2])
      : s.at === 'front' ? tmpV2.set(ctx.p.x + h.x * s.offset, 0, ctx.p.z + h.z * s.offset)
      : caster.pos();
    const active = s.delay + Math.max(0.3, (s.ticks - 1) * s.tickInt);

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
      e.update = (dt, el) => {
        const c = caster.pos();
        g.position.set(c.x, c.y, c.z);
        g.rotation.y -= dt * 18;
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
        const cm = e.mat(new THREE.MeshToonMaterial({ color: 0xbdf0ff, emissive: 0x3aa0d0, transparent: true, opacity: 0.85 }));
        const m = e.add(new THREE.Mesh(GEO.cone, cm));
        m.userData.a = (i / 12) * Math.PI * 2;
        m.userData.h = 1 + Math.random() * 1.2;
        m.scale.setScalar(0.01);
        crystals.push(m);
      }
      let fired = false;
      const groundM = e.mat(new THREE.MeshBasicMaterial({ map: magicCircleTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const ground = e.add(new THREE.Mesh(GEO.plane, groundM));
      ground.rotation.x = -Math.PI / 2;
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
    const kind = s.fx.kind;
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
        const cm = e.mat(new THREE.MeshToonMaterial({ color: 0xbdf0ff, emissive: 0x2f8ac0, transparent: true, opacity: 0.9 }));
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
    const im = e.mat(new THREE.MeshToonMaterial({ color: 0xd8f6ff, emissive: 0x3a8fc0 }));
    const drops = pts.map(([ox, oz], i) => {
      const m = e.add(new THREE.Mesh(GEO.cone, im));
      m.scale.set(0.35, 1.6, 0.35);
      m.rotation.x = Math.PI;
      m.visible = false;
      return { m, ox, oz, x: c.x + ox, z: c.z + oz, t0: s.delay + i * s.interval, landed: false };
    });
    const total = s.delay + s.count * s.interval + s.fall + 0.6;
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
        if (tf < s.fall) {
          d.m.visible = true;
          d.m.position.set(d.x, skyY - (skyY - 0.8) * (tf / s.fall), d.z);
          P.emit(d.m.position.x, d.m.position.y + 1, d.m.position.z, 0, 4, 0, color, 0.3, 0.2);
        } else if (!d.landed) {
          d.landed = true;
          d.m.visible = false;
          const at = tmpV.set(d.x, 0.3, d.z);
          P.burst(at, 14, color, { speed: 6, size: 0.3, life: 0.5, up: 1, grav: 12 });
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
