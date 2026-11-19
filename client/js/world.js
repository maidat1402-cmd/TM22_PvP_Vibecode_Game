// Đấu trường chế độ đối kháng. Mỗi map (shared/arenas.js) có một theme ở đây:
// trời, ánh sáng, mặt sàn, chướng ngại vật, cảnh trang trí, hạt bay. Toàn bộ là hình khối sinh bằng code.
import * as THREE from 'three';
import { toon } from './chibi.js';

function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat !== 1) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}

function seeded(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Vết loang màu ngẫu nhiên trên texture
function blotches(g, s, n, rgb, alpha, rMin = 10, rMax = 40) {
  for (let i = 0; i < n; i++) {
    const [r, gg, b] = rgb();
    g.fillStyle = `rgba(${r},${gg},${b},${alpha})`;
    g.beginPath(); g.arc(Math.random() * s, Math.random() * s, rMin + Math.random() * (rMax - rMin), 0, Math.PI * 2); g.fill();
  }
}

export function buildWorld(scene, arena) {
  const root = new THREE.Group();
  scene.add(root);
  const own = [];   // material/texture riêng của map (toon() là dùng chung, không được dispose)
  const mat = m => { own.push(m); return m; };
  const tex = t => { own.push(t); return t; };
  const R = arena.radius;
  const theme = THEMES[arena.theme] || THEMES.shrine;
  const updaters = [];
  const ctx = {
    root, arena, R, mat, tex, rnd: seeded(7),
    add: (...o) => { root.add(...o); return o[0]; },
    onUpdate: fn => updaters.push(fn),
  };

  // ---------- Trời + sương mù + ánh sáng ----------
  const S = theme.sky;
  ctx.add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(S.top) }, mid: { value: new THREE.Color(S.mid) }, bot: { value: new THREE.Color(S.bot) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
      void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bot, pow(-h, 0.5));
      gl_FragColor = vec4(c, 1.0); }`,
  }))));
  scene.fog = new THREE.Fog(S.fog, S.near ?? 60, S.far ?? 170);
  const sun = ctx.add(new THREE.Mesh(new THREE.SphereGeometry(S.sunSize || 10, 16, 12), mat(new THREE.MeshBasicMaterial({ color: S.sun || 0xfff6d5, fog: false }))));
  sun.position.set(...(S.sunPos || [120, 140, -260]));
  const L = theme.light || {};
  ctx.add(new THREE.HemisphereLight(L.sky ?? 0xe6f4ff, L.ground ?? 0x7a6a8a, L.hemi ?? 1.35));
  const dir = ctx.add(new THREE.DirectionalLight(L.sun ?? 0xffffff, L.dir ?? 2.2));
  dir.position.set(30, 50, 20);

  // ---------- Sàn đấu ----------
  const floorTex = tex(canvasTex(1024, theme.floor));
  const floor = ctx.add(new THREE.Mesh(new THREE.CircleGeometry(R, 64),
    mat(new THREE.MeshToonMaterial({ map: floorTex, gradientMap: toon(0).gradientMap }))));
  floor.rotation.x = -Math.PI / 2;
  if (theme.rim !== false) {
    const rim = ctx.add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.6, R + 1.2, 1.4, 64, 1, true), toon(theme.rim?.side ?? 0x9c8b7a)));
    rim.position.y = -0.69;
    const lip = ctx.add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.3, 0.35, 6, 64), toon(theme.rim?.lip ?? 0xc9b79c)));
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.05;
  }

  // ---------- Chướng ngại vật ----------
  for (const o of arena.obstacles) theme.obstacle(ctx, ...o);
  for (const b of arena.boxes || []) theme.box(ctx, ...b);

  // ---------- Cảnh xung quanh ----------
  theme.decor(ctx);

  // ---------- Hạt bay (hoa anh đào / bụi / lá) ----------
  if (theme.particles) particles(ctx, theme.particles);

  return {
    arena,
    update(dt, t) { for (const fn of updaters) fn(dt, t); },
    dispose() {
      scene.remove(root);
      root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      for (const m of own) m.dispose();
    },
  };
}

// Hạt bay quanh sân: rơi xuống (fall) hoặc trôi ngang (drift)
function particles(ctx, P) {
  const N = P.count, area = P.area || ctx.R * 2.5;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  const reset = (i, top) => {
    pos[i * 3] = (Math.random() - 0.5) * area;
    pos[i * 3 + 1] = top ? P.top + Math.random() * 4 : Math.random() * P.top;
    pos[i * 3 + 2] = (Math.random() - 0.5) * area;
  };
  for (let i = 0; i < N; i++) { reset(i, false); seed[i] = Math.random() * 10; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = ctx.add(new THREE.Points(g, ctx.mat(new THREE.PointsMaterial({ color: P.color, size: P.size, transparent: true, opacity: P.opacity ?? 0.85, depthWrite: false }))));
  pts.frustumCulled = false;
  const half = area / 2;
  ctx.onUpdate((dt, t) => {
    for (let i = 0; i < N; i++) {
      const s = seed[i];
      pos[i * 3] += (Math.sin(t * 0.7 + s) * P.sway + P.wind) * dt;
      pos[i * 3 + 1] -= (P.fall + Math.sin(s) * P.fall * 0.3) * dt;
      pos[i * 3 + 2] += Math.cos(t * 0.5 + s) * P.sway * 0.75 * dt;
      if (pos[i * 3 + 1] < 0) reset(i, true);
      if (pos[i * 3] > half) pos[i * 3] -= area;
      if (pos[i * 3 + 1] > P.top + 6) pos[i * 3 + 1] = 0.2;
    }
    g.attributes.position.needsUpdate = true;
  });
}

// Núi/đồi xa quanh sân
function farRing(ctx, n, rMin, rSpread, hMin, hSpread, mats, opts = {}) {
  const { rnd } = ctx;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.2;
    const r = rMin + rnd() * rSpread, h = hMin + rnd() * hSpread;
    const geo = opts.flat ? new THREE.CylinderGeometry(opts.top * (0.7 + rnd() * 0.6), opts.top * (1 + rnd() * 0.8), h, 7)
      : new THREE.ConeGeometry((opts.base || 30) + rnd() * (opts.base || 30) * 0.66, h, 6);
    const m = ctx.add(new THREE.Mesh(geo, mats[i % mats.length]));
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    m.rotation.y = rnd() * 3;
    if (opts.snow && h > 70) {
      const snow = ctx.add(new THREE.Mesh(new THREE.ConeGeometry(9, 14, 6), toon(0xffffff)));
      snow.position.set(m.position.x, h - 8, m.position.z);
    }
  }
}

// Mặt đất ngoài sân
function outerGround(ctx, color, y = -1.4, draw) {
  const t = draw ? ctx.tex(canvasTex(256, draw, 40)) : null;
  const m = ctx.add(new THREE.Mesh(new THREE.CircleGeometry(300, 48),
    t ? ctx.mat(new THREE.MeshToonMaterial({ map: t, gradientMap: toon(0).gradientMap })) : toon(color)));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

// Đặt nhiều bản sao của một hình (InstancedMesh: 1 lần vẽ)
function instanced(ctx, geo, material, list) {
  const im = ctx.add(new THREE.InstancedMesh(geo, material, list.length));
  const o = new THREE.Object3D();
  list.forEach(([x, y, z, sx = 1, sy = 1, sz = 1, ry = 0], i) => {
    o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(0, ry, 0);
    o.updateMatrix(); im.setMatrixAt(i, o.matrix);
  });
  return im;
}

// ======================= Các theme =======================
const THEMES = {
  // ---------- Đền Anh Đào (map gốc) ----------
  shrine: {
    sky: { top: 0x3f8cf0, mid: 0xa9d4ff, bot: 0xffd6e8, fog: 0xb9dcff },
    floor(g, s) {
      const c = s / 2;
      g.fillStyle = '#c9b496'; g.fillRect(0, 0, s, s);
      for (let r = 1; r <= 10; r++) {
        const rad = (r / 10) * c;
        g.strokeStyle = 'rgba(120,95,70,0.35)'; g.lineWidth = 3;
        g.beginPath(); g.arc(c, c, rad, 0, Math.PI * 2); g.stroke();
        const n = r * 8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + r;
          g.beginPath();
          g.moveTo(c + Math.cos(a) * (rad - c / 10), c + Math.sin(a) * (rad - c / 10));
          g.lineTo(c + Math.cos(a) * rad, c + Math.sin(a) * rad);
          g.stroke();
        }
      }
      blotches(g, s, 400, () => [150 + Math.random() * 60, 120 + Math.random() * 50, 90 + Math.random() * 40], 0.08);
      g.strokeStyle = 'rgba(200,60,60,0.55)'; g.lineWidth = 10;
      g.beginPath(); g.arc(c, c, c * 0.32, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 4;
      g.beginPath(); g.arc(c, c, c * 0.27, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(200,60,60,0.4)'; g.lineWidth = 14;
      g.beginPath(); g.arc(c, c, c * 0.97, 0, Math.PI * 2); g.stroke();
    },
    obstacle(ctx, x, z, r, h) {
      const stone = toon(0xb8a99a), stoneDark = toon(0x8a7b70), moss = toon(0x7fb069);
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      if (h >= 3) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 10), stone);
        col.position.y = h / 2;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 1.1, 0.35, 10), stoneDark);
        cap.position.y = h;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.2, 0.4, 10), stoneDark);
        base.position.y = 0.2;
        const rope = new THREE.Mesh(new THREE.TorusGeometry(r * 0.9, 0.08, 6, 20), toon(0xf4e3b2));
        rope.rotation.x = Math.PI / 2;
        rope.position.y = h * 0.7;
        g.add(col, cap, base, rope);
      } else {
        const rock = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r, h, 8), stone);
        rock.position.y = h / 2;
        const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.15, 8), moss);
        top.position.y = h + 0.02;
        g.add(rock, top);
      }
      g.rotation.y = ctx.rnd() * Math.PI;
      ctx.add(g);
    },
    box(ctx, x, z, hw, hd, h) {
      const m = ctx.add(new THREE.Mesh(new THREE.BoxGeometry(hw * 2, h, hd * 2), toon(0xb8a99a)));
      m.position.set(x, h / 2, z);
    },
    decor(ctx) {
      const { R, rnd } = ctx;
      outerGround(ctx, 0, -1.4, (g, s) => {
        g.fillStyle = '#8fd07a'; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 900; i++) {
          g.fillStyle = Math.random() < 0.5 ? 'rgba(70,150,70,0.35)' : 'rgba(180,230,140,0.35)';
          g.fillRect(Math.random() * s, Math.random() * s, 2, 5);
        }
      });
      const trunk = toon(0x7a5235);
      const blossoms = [toon(0xffb7d5), toon(0xff9ec7), toon(0xffd1e3)];
      const pine = toon(0x3f8f5a);
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * Math.PI * 2 + rnd() * 0.1;
        const r = R + 8 + rnd() * 30;
        const g = new THREE.Group();
        g.position.set(Math.cos(a) * r, -1.4, Math.sin(a) * r);
        g.scale.setScalar(0.8 + rnd() * 0.8);
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 4, 6), trunk);
        t.position.y = 2;
        g.add(t);
        if (rnd() < 0.55) {
          for (let k = 0; k < 5; k++) {
            const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6 + rnd(), 0), blossoms[k % 3]);
            b.position.set((rnd() - 0.5) * 3, 4.5 + rnd() * 1.8, (rnd() - 0.5) * 3);
            g.add(b);
          }
        } else {
          for (let k = 0; k < 3; k++) {
            const c = new THREE.Mesh(new THREE.ConeGeometry(2.4 - k * 0.6, 2.6, 7), pine);
            c.position.y = 3.6 + k * 1.5;
            g.add(c);
          }
        }
        ctx.add(g);
      }
      // cổng đền
      const red = toon(0xd62828), black = toon(0x22223b);
      const gate = (x, z, rotY) => {
        const g = new THREE.Group();
        g.position.set(x, -1.4, z);
        g.rotation.y = rotY;
        for (const sx of [-1, 1]) {
          const p = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 9, 10), red);
          p.position.set(sx * 4, 4.5, 0);
          g.add(p);
        }
        const top = new THREE.Mesh(new THREE.BoxGeometry(11, 0.7, 1), black);
        top.position.y = 9.2;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.5, 0.7), red);
        beam.position.y = 7.6;
        g.add(top, beam);
        ctx.add(g);
      };
      gate(0, -(R + 6), 0); gate(0, R + 6, 0); gate(R + 6, 0, Math.PI / 2); gate(-(R + 6), 0, Math.PI / 2);
      // đèn lồng quanh viền
      const lanternMat = ctx.mat(new THREE.MeshBasicMaterial({ color: 0xffc26b }));
      const stoneDark = toon(0x8a7b70);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
        const g = new THREE.Group();
        g.position.set(Math.cos(a) * (R + 2), -1.4, Math.sin(a) * (R + 2));
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 2.6, 6), stoneDark);
        post.position.y = 1.3;
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), lanternMat);
        lamp.position.y = 3;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.6, 4), stoneDark);
        roof.position.y = 3.7;
        roof.rotation.y = Math.PI / 4;
        g.add(post, lamp, roof);
        ctx.add(g);
      }
      farRing(ctx, 18, 170, 40, 40, 50, [toon(0x9fb7d9), toon(0xb4c8e6), toon(0x8aa3c8)], { snow: true });
    },
    particles: { count: 260, color: 0xffb7d5, size: 0.28, top: 22, fall: 0.8, sway: 0.8, wind: 0.6, area: 100 },
  },

  // ---------- Đảo Đại Hội Võ Thuật ----------
  tournament: {
    sky: { top: 0x2f7fe8, mid: 0x9fd3ff, bot: 0xd9f3ff, fog: 0xc4e6ff, near: 80, far: 230, sunPos: [-140, 150, -220] },
    light: { sky: 0xeaf6ff, ground: 0x6f8fa8, hemi: 1.4, dir: 2.3 },
    rim: { side: 0xa39a8a, lip: 0xe4dccb },
    floor(g, s) {
      // gạch đá vuông lớn, mạch vữa, vòng tròn trung tâm
      g.fillStyle = '#c9c1b0'; g.fillRect(0, 0, s, s);
      const n = 16, w = s / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const v = 172 + Math.random() * 26;
        g.fillStyle = `rgb(${v + 10},${v + 4},${v - 12})`;
        g.fillRect(i * w + 2, j * w + 2, w - 4, w - 4);
      }
      blotches(g, s, 250, () => [150, 140, 120], 0.05, 6, 30);
      g.strokeStyle = 'rgba(120,110,95,0.5)'; g.lineWidth = 3;
      for (let i = 0; i <= n; i++) {
        g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, s); g.stroke();
        g.beginPath(); g.moveTo(0, i * w); g.lineTo(s, i * w); g.stroke();
      }
      const c = s / 2;
      g.strokeStyle = 'rgba(40,90,170,0.5)'; g.lineWidth = 12;
      g.beginPath(); g.arc(c, c, c * 0.62, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(220,150,40,0.55)'; g.lineWidth = 16;
      g.beginPath(); g.arc(c, c, c * 0.96, 0, Math.PI * 2); g.stroke();
    },
    obstacle(ctx, x, z, r, h) {
      // đèn đá: chân, thân, hộp đèn phát sáng, mái
      const stone = toon(0xcfc6b4), dark = toon(0x8f8676);
      const glow = ctx.mat(new THREE.MeshBasicMaterial({ color: 0xffd98a }));
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 1.2, 0.5, 6), dark); base.position.y = 0.25;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.55, h - 1.6, 6), stone); post.position.y = 0.5 + (h - 1.6) / 2;
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, 0.8, r * 1.2), glow); lamp.position.y = h - 0.75;
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r * 1.25, 0.45, 6), dark); roof.position.y = h - 0.15;
      g.add(base, post, lamp, roof);
      ctx.add(g);
    },
    box(ctx, x, z, hw, hd, h) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const body = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, h, hd * 2), toon(0xd8cfbd)); body.position.y = h / 2;
      const top = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.3, 0.18, hd * 2 + 0.3), toon(0xb3a88f)); top.position.y = h - 0.06;
      g.add(body, top);
      if (hw > 2 && hd > 2) {
        // bục giữa: viền xanh trang trọng
        const trim = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.1, 0.25, hd * 2 + 0.1), toon(0x2f5fa8)); trim.position.y = h * 0.45;
        g.add(trim);
      }
      ctx.add(g);
    },
    decor(ctx) {
      const { R, rnd } = ctx;
      // biển: mặt nước có sóng trôi + bãi cát
      const waterTex = ctx.tex(canvasTex(256, (g, s) => {
        g.fillStyle = '#3aa3d8'; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 160; i++) {
          g.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(30,110,170,0.4)';
          g.lineWidth = 2;
          const x = Math.random() * s, y = Math.random() * s;
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 4, x + 16, y); g.stroke();
        }
      }, 60));
      const sea = outerGround(ctx, 0, -1.6);
      sea.material = ctx.mat(new THREE.MeshToonMaterial({ map: waterTex, gradientMap: toon(0).gradientMap }));
      ctx.onUpdate((dt, t) => { waterTex.offset.set(t * 0.01, t * 0.006); });
      const sand = ctx.add(new THREE.Mesh(new THREE.RingGeometry(R + 1, R + 9, 64), toon(0xf1dcae)));
      sand.rotation.x = -Math.PI / 2; sand.position.y = -1.45;
      // khán đài 4 hướng chéo, khán giả là các khối màu (1 lần vẽ)
      const tierMat = toon(0xbdb4a4), crowd = [];
      const crowdColors = [0xe63946, 0xf4a261, 0x2a9d8f, 0x457b9d, 0xffd166, 0x9b5de5, 0xffffff];
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + k * Math.PI / 2;
        const g = new THREE.Group();
        g.position.set(Math.cos(a) * (R + 14), -1.4, Math.sin(a) * (R + 14));
        g.rotation.y = -a + Math.PI / 2;
        for (let tier = 0; tier < 4; tier++) {
          const step = new THREE.Mesh(new THREE.BoxGeometry(22, 1.2, 2.4), tierMat);
          step.position.set(0, 0.6 + tier * 1.2, tier * 2.4);
          g.add(step);
        }
        const roof = new THREE.Mesh(new THREE.BoxGeometry(23, 0.4, 10.5), toon(0xd62828));
        roof.position.set(0, 7.4, 3.6); roof.rotation.x = -0.12;
        g.add(roof);
        for (const sx of [-11, 11]) {
          const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 7.4, 6), toon(0xf1e9d8));
          p.position.set(sx, 3.7, 8.6);
          g.add(p);
        }
        ctx.add(g);
        g.updateMatrixWorld(true);
        for (let tier = 0; tier < 4; tier++) for (let i = 0; i < 18; i++) {
          if (rnd() < 0.15) continue;
          const v = new THREE.Vector3(-10 + i * 1.18 + (rnd() - 0.5) * 0.3, 1.2 + tier * 1.2 + 0.5, tier * 2.4 + (rnd() - 0.5) * 0.6).applyMatrix4(g.matrixWorld);
          crowd.push([v.x, v.y, v.z, crowdColors[(rnd() * crowdColors.length) | 0]]);
        }
      }
      const crowdMesh = instanced(ctx, new THREE.BoxGeometry(0.7, 0.9, 0.6), ctx.mat(new THREE.MeshToonMaterial({ gradientMap: toon(0).gradientMap })),
        crowd.map(([x, y, z]) => [x, y, z]));
      crowd.forEach((c, i) => crowdMesh.setColorAt(i, new THREE.Color(c[3])));
      // khán giả nhún nhảy
      const o = new THREE.Object3D();
      ctx.onUpdate((dt, t) => {
        for (let i = 0; i < crowd.length; i += 3) {
          const [x, y, z] = crowd[i];
          o.position.set(x, y + Math.max(0, Math.sin(t * 6 + i)) * 0.25, z); o.updateMatrix();
          crowdMesh.setMatrixAt(i, o.matrix);
        }
        crowdMesh.instanceMatrix.needsUpdate = true;
      });
      // cột cờ
      const flagColors = [0xe63946, 0xffd166, 0x2a9d8f, 0x457b9d];
      const flags = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const pole = ctx.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 10, 6), toon(0xf1e9d8)));
        pole.position.set(Math.cos(a) * (R + 4), 3.6, Math.sin(a) * (R + 4));
        const flag = ctx.add(new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.5), ctx.mat(new THREE.MeshToonMaterial({ color: flagColors[i % 4], side: THREE.DoubleSide, gradientMap: toon(0).gradientMap }))));
        flag.geometry.translate(1.3, 0, 0);
        flag.position.set(pole.position.x, 7.8, pole.position.z);
        flags.push(flag);
      }
      ctx.onUpdate((dt, t) => flags.forEach((f, i) => { f.rotation.y = t * 0.6 + i + Math.sin(t * 3 + i) * 0.4; }));
      // cây dừa trên bãi cát
      const trunk = toon(0xa47148), leaf = toon(0x3fa34d);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + 0.2;
        if (Math.abs(((a - Math.PI / 4) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2) - Math.PI / 4) < 0.35) continue;   // chừa chỗ khán đài
        const g = new THREE.Group();
        g.position.set(Math.cos(a) * (R + 6), -1.45, Math.sin(a) * (R + 6));
        let y = 0, lean = 0;
        for (let k = 0; k < 5; k++) {
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.6, 6), trunk);
          lean += 0.06; seg.position.set(lean * 3, y + 0.8, 0); seg.rotation.z = -lean;
          g.add(seg); y += 1.5;
        }
        for (let k = 0; k < 6; k++) {
          // tàu lá: hình nón dẹt chĩa ra ngoài và rủ xuống
          const l = new THREE.Mesh(new THREE.ConeGeometry(0.7, 4, 4), leaf);
          l.scale.set(1, 1, 0.25);
          l.position.set(1.6, 0, 0);
          l.rotation.set(0, 0, -1.2);
          const holder = new THREE.Group();
          holder.add(l);
          holder.rotation.y = k * Math.PI / 3;
          holder.position.set(lean * 3, y, 0);
          g.add(holder);
        }
        g.rotation.y = -a;
        ctx.add(g);
      }
      // đảo xa + mây
      farRing(ctx, 9, 150, 60, 10, 16, [toon(0x5fae6a), toon(0x7cc276)], { base: 16 });
      const cloud = toon(0xffffff);
      for (let i = 0; i < 12; i++) {
        const g = new THREE.Group();
        const a = rnd() * Math.PI * 2, r = 120 + rnd() * 100;
        g.position.set(Math.cos(a) * r, 45 + rnd() * 30, Math.sin(a) * r);
        for (let k = 0; k < 4; k++) {
          const b = new THREE.Mesh(new THREE.IcosahedronGeometry(6 + rnd() * 5, 1), cloud);
          b.position.set((k - 1.5) * 7, rnd() * 3, rnd() * 4);
          g.add(b);
        }
        ctx.add(g);
      }
    },
    particles: null,
  },

  // ---------- Hoang Mạc Đá Đỏ ----------
  wasteland: {
    sky: { top: 0x6f93cf, mid: 0xf2c08c, bot: 0xe08052, fog: 0xe9b48b, near: 55, far: 175, sun: 0xffe2b0, sunSize: 14, sunPos: [200, 60, -230] },
    light: { sky: 0xffe6c9, ground: 0x8a4f3a, hemi: 1.3, sun: 0xffd6a8, dir: 2.4 },
    rim: { side: 0x8f553a, lip: 0xb97a55 },
    floor(g, s) {
      g.fillStyle = '#cf8a5a'; g.fillRect(0, 0, s, s);
      blotches(g, s, 500, () => Math.random() < 0.5 ? [180, 100, 60] : [225, 160, 110], 0.12, 8, 50);
      // vết nứt
      g.strokeStyle = 'rgba(110,55,30,0.45)'; g.lineWidth = 2;
      for (let i = 0; i < 70; i++) {
        let x = Math.random() * s, y = Math.random() * s;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; g.lineTo(x, y); }
        g.stroke();
      }
      // hố va chạm do những trận chiến trước
      for (let i = 0; i < 9; i++) {
        const x = s * 0.15 + Math.random() * s * 0.7, y = s * 0.15 + Math.random() * s * 0.7, r = 20 + Math.random() * 45;
        const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r);
        gr.addColorStop(0, 'rgba(110,55,30,0.55)'); gr.addColorStop(0.75, 'rgba(140,70,40,0.25)'); gr.addColorStop(1, 'rgba(240,180,130,0.35)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    },
    obstacle(ctx, x, z, r, h) {
      const { rnd } = ctx;
      const bands = [toon(0xb5603a), toon(0xc97a4c), toon(0x9e4f30), toon(0xd89062)];
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      if (h >= 4) {
        // cột đá phân tầng, hơi phình ở chân
        const layers = Math.max(3, Math.round(h / 2.2));
        for (let k = 0; k < layers; k++) {
          const y0 = (k / layers) * h, y1 = ((k + 1) / layers) * h;
          const rr = r * (1.15 - (k / layers) * 0.25) * (0.95 + rnd() * 0.1);
          const m = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.97, rr, y1 - y0, 7), bands[(k + (rnd() * 4 | 0)) % 4]);
          m.position.y = (y0 + y1) / 2; m.rotation.y = rnd() * 3;
          g.add(m);
        }
        const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.9, 0.3, 7), toon(0xe2a274));
        top.position.y = h - 0.1;
        g.add(top);
        // đá vụn dưới chân
        for (let k = 0; k < 4; k++) {
          const a = rnd() * Math.PI * 2;
          const rb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + rnd() * 0.5, 0), bands[k % 4]);
          rb.position.set(Math.cos(a) * (r + 0.4), 0.2, Math.sin(a) * (r + 0.4));
          g.add(rb);
        }
      } else {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), bands[rnd() * 4 | 0]);
        rock.scale.set(r, h, r);
        rock.position.y = h * 0.5;
        g.add(rock);
      }
      ctx.add(g);
    },
    box(ctx, x, z, hw, hd, h) {
      const m = ctx.add(new THREE.Mesh(new THREE.BoxGeometry(hw * 2, h, hd * 2), toon(0xb5603a)));
      m.position.set(x, h / 2, z);
    },
    decor(ctx) {
      const { R, rnd } = ctx;
      outerGround(ctx, 0, -1.4, (g, s) => {
        g.fillStyle = '#c47b4c'; g.fillRect(0, 0, s, s);
        blotches(g, s, 120, () => [205, 140, 95], 0.25, 4, 18);
      });
      // núi đá đỉnh bằng xa xa
      farRing(ctx, 16, 110, 90, 25, 45, [toon(0xb0613d), toon(0xc4774d), toon(0x99523a)], { flat: true, top: 22 });
      // đá rải rác ngoài sân
      const rockMats = [toon(0xa85a38), toon(0xc07048)];
      for (let i = 0; i < 40; i++) {
        const a = rnd() * Math.PI * 2, r = R + 4 + rnd() * 45;
        const m = ctx.add(new THREE.Mesh(new THREE.DodecahedronGeometry(1 + rnd() * 2.5, 0), rockMats[i % 2]));
        m.position.set(Math.cos(a) * r, -1.2, Math.sin(a) * r);
        m.rotation.set(rnd() * 3, rnd() * 3, 0);
      }
      // vài cột đá lớn bên ngoài
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + rnd() * 0.3, r = R + 18 + rnd() * 30, h = 14 + rnd() * 20;
        const m = ctx.add(new THREE.Mesh(new THREE.CylinderGeometry(3 + rnd() * 2, 4 + rnd() * 3, h, 7), rockMats[i % 2]));
        m.position.set(Math.cos(a) * r, h / 2 - 1.4, Math.sin(a) * r);
      }
    },
    particles: { count: 220, color: 0xf6d2a8, size: 0.22, top: 14, fall: 0.15, sway: 0.4, wind: 3.2, opacity: 0.6, area: 110 },
  },

  // ---------- Làng Ninja Rừng Trúc ----------
  village: {
    sky: { top: 0x4a90d9, mid: 0xc4e3f2, bot: 0xffe1bd, fog: 0xd3e8da, near: 50, far: 160, sunPos: [160, 90, -230] },
    light: { sky: 0xf0f8ff, ground: 0x6b7f55, hemi: 1.35, dir: 2.2 },
    rim: { side: 0x7d6a50, lip: 0x9c8466 },
    floor(g, s) {
      // nền đất nện, đường lát đá hình chữ thập + quảng trường tròn
      g.fillStyle = '#b89a6c'; g.fillRect(0, 0, s, s);
      blotches(g, s, 450, () => Math.random() < 0.5 ? [150, 120, 80] : [205, 180, 135], 0.1, 6, 35);
      const c = s / 2, path = s * 0.07;
      const stones = (x0, y0, w, h) => {
        for (let i = 0; i < (w * h) / 900; i++) {
          const v = 150 + Math.random() * 40;
          g.fillStyle = `rgb(${v},${v - 5},${v - 18})`;
          const x = x0 + Math.random() * w, y = y0 + Math.random() * h, r = 10 + Math.random() * 9;
          g.beginPath(); g.ellipse(x, y, r, r * 0.75, Math.random() * 3, 0, Math.PI * 2); g.fill();
        }
      };
      stones(c - path / 2, 0, path, s);
      stones(0, c - path / 2, s, path);
      g.fillStyle = 'rgba(160,150,130,0.9)';
      g.beginPath(); g.arc(c, c, s * 0.12, 0, Math.PI * 2); g.fill();
      stones(c - s * 0.11, c - s * 0.11, s * 0.22, s * 0.22);
      // biểu tượng xoáy lá trên quảng trường (tự thiết kế)
      g.strokeStyle = 'rgba(70,110,60,0.6)'; g.lineWidth = 7;
      g.beginPath();
      for (let a = 0; a < Math.PI * 4; a += 0.1) {
        const r = a * s * 0.007;
        const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
        a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    },
    obstacle(ctx, x, z, r, h) {
      const wood = toon(0x8a5a3b), woodDark = toon(0x5e3d28);
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      if (h >= 5) {
        // tháp nước: 4 chân gỗ + bồn tròn nắp phẳng
        for (let k = 0; k < 4; k++) {
          const a = k * Math.PI / 2 + Math.PI / 4;
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, h * 0.55, 6), woodDark);
          leg.position.set(Math.cos(a) * r * 0.75, h * 0.275, Math.sin(a) * r * 0.75);
          g.add(leg);
        }
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * 0.45, 12), wood);
        tank.position.y = h * 0.55 + h * 0.225;
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.2, 12), woodDark);
        lid.position.y = h - 0.1;
        g.add(tank, lid);
        for (const yy of [0.62, 0.88]) {
          const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.01, 0.06, 4, 16), toon(0x444444));
          band.rotation.x = Math.PI / 2; band.position.y = h * yy;
          g.add(band);
        }
      } else if (r < 0.6) {
        // cọc gỗ tập luyện quấn dây
        const log = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 8), wood);
        log.position.y = h / 2;
        g.add(log);
        for (const yy of [0.45, 0.75]) {
          const rope = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.05, 4, 12), toon(0xe9d8a6));
          rope.rotation.x = Math.PI / 2; rope.position.y = h * yy;
          g.add(rope);
        }
      } else {
        // giếng đá
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 12, 1, true), toon(0x9a958a));
        ring.position.y = h / 2;
        const water = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 12), toon(0x3c6e91));
        water.rotation.x = -Math.PI / 2; water.position.y = h * 0.7;
        const lip = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 4, 16), toon(0x7c776c));
        lip.rotation.x = Math.PI / 2; lip.position.y = h;
        g.add(ring, water, lip);
      }
      ctx.add(g);
    },
    box(ctx, x, z, hw, hd, h) {
      // nhà gỗ tường vữa, mái phẳng lợp ngói (đứng được trên nóc ở độ cao h)
      const { rnd } = ctx;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const roofH = 0.4, wallH = h - roofH;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, wallH, hd * 2), toon(0xf0e2c4));
      wall.position.y = wallH / 2;
      g.add(wall);
      const beam = toon(0x5e3d28);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, wallH, 0.3), beam);
        p.position.set(sx * (hw - 0.1), wallH / 2, sz * (hd - 0.1));
        g.add(p);
      }
      const belt = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.05, 0.22, hd * 2 + 0.05), beam);
      belt.position.y = wallH * 0.55;
      g.add(belt);
      const roofCol = [0xb5452f, 0x3d5a80, 0x6a994e][(rnd() * 3) | 0];
      const roof = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 1.2, roofH, hd * 2 + 1.2), toon(roofCol));
      roof.position.y = h - roofH / 2;
      const eave = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 1.5, 0.12, hd * 2 + 1.5), toon(0x3b2a1e));
      eave.position.y = h - roofH - 0.02;
      g.add(roof, eave);
      // cửa + cửa sổ giấy
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.3, Math.min(2.2, wallH * 0.7)), toon(0x4a3426));
      door.position.set(0, Math.min(2.2, wallH * 0.7) / 2, hd + 0.01);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), toon(0xfff3d6));
      win.position.set(hw * 0.5, wallH * 0.72, hd + 0.01);
      const win2 = win.clone(); win2.position.x = -hw * 0.5;
      g.add(door, win, win2);
      // đèn lồng đỏ treo hiên
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), ctx.mat(new THREE.MeshBasicMaterial({ color: 0xff6b4a })));
      lantern.scale.y = 1.3;
      lantern.position.set(hw * 0.85, wallH - 0.5, hd + 0.45);
      g.add(lantern);
      // cửa quay về phía giữa sân (chỉ xoay 180° để khớp hộp va chạm)
      g.rotation.y = z > 0 ? Math.PI : 0;
      ctx.add(g);
    },
    decor(ctx) {
      const { R, rnd } = ctx;
      outerGround(ctx, 0, -1.4, (g, s) => {
        g.fillStyle = '#7cb85f'; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 900; i++) {
          g.fillStyle = Math.random() < 0.5 ? 'rgba(60,130,60,0.35)' : 'rgba(170,220,130,0.35)';
          g.fillRect(Math.random() * s, Math.random() * s, 2, 5);
        }
      });
      // hàng rào gỗ quanh làng
      const posts = [];
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        posts.push([Math.cos(a) * (R + 1.6), -0.6, Math.sin(a) * (R + 1.6), 1, 1, 1, -a]);
      }
      instanced(ctx, new THREE.BoxGeometry(0.25, 2.2, 0.25), toon(0x6b4a33), posts);
      const rail = ctx.add(new THREE.Mesh(new THREE.TorusGeometry(R + 1.6, 0.08, 4, 96), toon(0x6b4a33)));
      rail.rotation.x = Math.PI / 2; rail.position.y = 0.2;
      // rừng trúc dày quanh làng (2 lần vẽ cho hàng trăm cây)
      const stalks = [], tops = [];
      for (let i = 0; i < 320; i++) {
        const a = rnd() * Math.PI * 2, r = R + 5 + Math.pow(rnd(), 0.7) * 40;
        if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) + Math.PI / 2) < 0.12 && r < R + 30) continue;   // lối vào làng
        const h = 10 + rnd() * 9, x = Math.cos(a) * r, z = Math.sin(a) * r;
        stalks.push([x, h / 2 - 1.4, z, 1, h, 1, rnd() * 3]);
        tops.push([x, h - 1.4, z, 1 + rnd() * 0.6, 1 + rnd() * 0.5, 1 + rnd() * 0.6, rnd() * 3]);
      }
      instanced(ctx, new THREE.CylinderGeometry(0.16, 0.2, 1, 6), toon(0x7fae4a), stalks);
      instanced(ctx, new THREE.IcosahedronGeometry(1.6, 0), toon(0x5c9a3a), tops);
      // cổng làng
      const wood = toon(0x6b4a33);
      const gate = new THREE.Group();
      gate.position.set(0, -1.4, -(R + 4));
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), wood);
        p.position.set(sx * 3.6, 4, 0);
        gate.add(p);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.8, 1.4), toon(0x3d5a80));
      top.position.y = 8.2;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 0.3), toon(0xe9d8a6));
      sign.position.y = 6.6;
      gate.add(top, sign);
      ctx.add(gate);
      // vách núi xanh phía xa
      farRing(ctx, 16, 150, 50, 50, 50, [toon(0x6f9e78), toon(0x83b08a), toon(0x5d8a69)]);
    },
    particles: { count: 200, color: 0x8fd16a, size: 0.3, top: 20, fall: 1.1, sway: 1.2, wind: 0.8, area: 100 },
  },
};
