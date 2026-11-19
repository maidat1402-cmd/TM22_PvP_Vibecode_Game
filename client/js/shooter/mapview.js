// Dựng hình ảnh map bắn súng từ dữ liệu khối trong shared/maps.js.
// Các khối cùng loại được gộp thành 1 mesh => rất ít draw call, chạy tốt trên điện thoại.
// Mỗi map có một "theme" (màu trời, texture, trang trí): lantern = phố lồng đèn, snow = đền tuyết.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon } from '../chibi.js';

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const noiseFill = (g, s, n, cols, w = 3, h = 3) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[i % cols.length];
    g.fillRect(Math.random() * s, Math.random() * s, w + Math.random() * w, h + Math.random() * h);
  }
};

// ---------- Texture ----------
const paving = (base, hue, sat, light) => canvasTex(256, (g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  const n = 4, cs = s / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const off = y % 2 ? cs / 2 : 0;
    g.fillStyle = `hsl(${hue + Math.random() * 10},${sat + Math.random() * 10}%,${light + Math.random() * 10}%)`;
    g.fillRect(x * cs + off + 3, y * cs + 3, cs - 6, cs - 6);
    g.fillRect(x * cs + off + 3 - s, y * cs + 3, cs - 6, cs - 6);
  }
  noiseFill(g, s, 300, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.06)']);
});

const TEXTURES = {
  lantern: {
    floor: () => paving('#b9a48a', 30, 18, 58),
    wall: () => canvasTex(256, (g, s) => {
      g.fillStyle = '#efe0c2'; g.fillRect(0, 0, s, s);
      noiseFill(g, s, 500, ['rgba(160,120,80,0.08)', 'rgba(255,255,255,0.15)'], 6, 6);
      g.fillStyle = '#8c5a3c'; g.fillRect(0, s * 0.82, s, s * 0.18);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, s * 0.82, s, 3);
    }),
    house: () => canvasTex(256, (g, s) => {
      g.fillStyle = '#a63d40'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#5c2a2c';
      for (let x = 0; x < s; x += 64) g.fillRect(x, 0, 8, s);
      g.fillRect(0, 0, s, 10); g.fillRect(0, s - 30, s, 30);
      g.fillStyle = '#ffd57e';
      g.fillRect(22, 70, 30, 40); g.fillRect(150, 70, 30, 40);
      g.strokeStyle = '#5c2a2c'; g.lineWidth = 4;
      for (const x of [22, 150]) { g.strokeRect(x, 70, 30, 40); g.beginPath(); g.moveTo(x + 15, 70); g.lineTo(x + 15, 110); g.stroke(); }
    }),
  },
  snow: {
    floor: () => canvasTex(256, (g, s) => {
      g.fillStyle = '#eef3f8'; g.fillRect(0, 0, s, s);
      // vài viên đá lát lộ ra dưới tuyết
      for (let i = 0; i < 6; i++) {
        g.fillStyle = `rgba(${150 + Math.random() * 30},${165 + Math.random() * 30},${190 + Math.random() * 30},0.16)`;
        g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 10 + Math.random() * 12, 6 + Math.random() * 8, Math.random() * 3, 0, Math.PI * 2); g.fill();
      }
      noiseFill(g, s, 400, ['rgba(160,180,210,0.12)', 'rgba(255,255,255,0.5)'], 4, 4);
    }),
    wall: () => canvasTex(256, (g, s) => {
      g.fillStyle = '#8d939e'; g.fillRect(0, 0, s, s);
      // tường đá xếp
      for (let y = 0; y < s; y += 32) for (let x = (y / 32) % 2 ? -32 : 0; x < s; x += 64) {
        g.fillStyle = `hsl(215,${8 + Math.random() * 6}%,${50 + Math.random() * 12}%)`;
        g.fillRect(x + 2, y + 2, 60, 28);
      }
      g.fillStyle = '#f4f8fb'; g.fillRect(0, 0, s, 14);       // tuyết đọng trên đỉnh
    }),
    house: () => canvasTex(256, (g, s) => {
      g.fillStyle = '#5b3a29'; g.fillRect(0, 0, s, s);        // gỗ tối
      g.fillStyle = '#3d2618';
      for (let x = 0; x < s; x += 64) g.fillRect(x, 0, 10, s);
      g.fillRect(0, s - 26, s, 26);
      g.fillStyle = '#f7ecd2';                                  // cửa giấy
      for (const x of [16, 144]) {
        g.fillRect(x, 50, 48, 90);
        g.strokeStyle = '#3d2618'; g.lineWidth = 3;
        for (let k = 1; k < 3; k++) { g.beginPath(); g.moveTo(x + k * 16, 50); g.lineTo(x + k * 16, 140); g.stroke(); }
        for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x, 50 + k * 22); g.lineTo(x + 48, 50 + k * 22); g.stroke(); }
      }
    }),
  },
};
const COMMON_TEX = {
  crate: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#c08b4f'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#9c6b38';
    for (let y = 0; y < s; y += 21) g.fillRect(0, y, s, 2);
    g.strokeStyle = '#7a4f24'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
    g.lineWidth = 8; g.beginPath(); g.moveTo(8, 8); g.lineTo(s - 8, s - 8); g.stroke();
  }),
  pillar: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#c1121f'; g.fillRect(0, 0, s, s);
    noiseFill(g, s, 200, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.08)']);
    g.fillStyle = '#ffd166'; g.fillRect(0, 10, s, 8); g.fillRect(0, s - 18, s, 8);
  }),
  stone: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#a7adb7'; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(60,65,80,0.5)'; g.lineWidth = 3;
    g.strokeRect(2, 2, s / 2 - 2, s / 2 - 2); g.strokeRect(s / 2, s / 2, s / 2 - 2, s / 2 - 2);
    noiseFill(g, s, 200, ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.12)']);
  }),
};
const TILE = { wall: 3, house: 4, crate: 1.2, pillar: 2, stone: 1.5 };

const THEMES = {
  lantern: {
    sky: [0x2b4c7e, 0xf7b267, 0x7d5a7a], fog: [0xe8b98a, 50, 160],
    hemi: [0xffe6c7, 0x6b5a7a, 1.5], sun: [0xffd4a3, 2.0], roof: 0x3d405b, cap: 0x6d4c41, edge: 0x2b1d1f,
    lanterns: true,
  },
  snow: {
    sky: [0x6f95c7, 0xdfe9f5, 0xb7c6da], fog: [0xdfe9f5, 40, 140],
    hemi: [0xeaf4ff, 0x8a93a8, 1.55], sun: [0xffffff, 1.6], roof: 0x2f3e46, cap: 0xf4f8fb, edge: 0x2a3140,
    snow: true,
  },
};

// BoxGeometry với UV tính theo mét (texture lặp đều trên mọi kích thước khối)
function worldBox(b, tile) {
  const g = new THREE.BoxGeometry(b.w, b.h, b.d);
  const uv = g.attributes.uv;
  const sizes = [[b.d, b.h], [b.d, b.h], [b.w, b.d], [b.w, b.d], [b.w, b.h], [b.w, b.h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * sizes[f][0] / tile, uv.getY(k) * sizes[f][1] / tile);
    }
  }
  g.translate(b.x, b.y + b.h / 2, b.z);
  return g;
}

function letterTex(ch, color) {
  return canvasTex(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = color; g.lineWidth = 14;
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 14, 0, Math.PI * 2); g.stroke();
    g.fillStyle = color;
    g.font = 'bold 170px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, s / 2, s / 2 + 8);
  });
}

export function buildMapView(scene, map) {
  const th = THEMES[map.theme] || THEMES.lantern;
  const tex = { ...COMMON_TEX, ...(TEXTURES[map.theme] || TEXTURES.lantern) };
  const root = new THREE.Group();
  scene.add(root);

  // trời
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(th.sky[0]) }, mid: { value: new THREE.Color(th.sky[1]) }, bot: { value: new THREE.Color(th.sky[2]) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
      void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bot, pow(-h, 0.5)); gl_FragColor = vec4(c,1.0); }`,
  }));
  root.add(sky);
  scene.fog = new THREE.Fog(...th.fog);
  root.add(new THREE.HemisphereLight(...th.hemi));
  const sun = new THREE.DirectionalLight(...th.sun);
  sun.position.set(-40, 50, -20);
  root.add(sun);

  // sàn
  const ft = tex.floor();
  ft.repeat.set(map.bounds.x * 2 / 4, map.bounds.z * 2 / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.bounds.x * 2 + 2, map.bounds.z * 2 + 2),
    new THREE.MeshToonMaterial({ map: ft, gradientMap: toon(0).gradientMap }));
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  // khối theo loại
  const groups = {};
  for (const b of map.boxes) (groups[b.k] ||= []).push(b);
  for (const [k, list] of Object.entries(groups)) {
    const geo = mergeGeometries(list.map(b => worldBox(b, TILE[k] || 2)));
    const mat = new THREE.MeshToonMaterial({ map: tex[k] ? tex[k]() : null, gradientMap: toon(0).gradientMap });
    root.add(new THREE.Mesh(geo, mat));
    root.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: th.edge, transparent: true, opacity: 0.45 })));
  }

  // mái ngói cho nhà (mái cong kiểu chùa ở map tuyết)
  const roofs = [];
  for (const b of groups.house || []) {
    const g = new THREE.ConeGeometry(1, 1, 4, 1);
    g.rotateY(Math.PI / 4);
    g.scale(b.w * 0.78, 2.2, b.d * 0.78);
    g.translate(b.x, b.maxY + 1.1, b.z);
    roofs.push(g);
    const eave = new THREE.BoxGeometry(b.w + 1, 0.25, b.d + 1);
    eave.translate(b.x, b.maxY + 0.1, b.z);
    roofs.push(eave);
  }
  // mái nhỏ trên cột (tháp chuông)
  for (const b of groups.pillar || []) {
    if (b.maxY < 5) continue;
    const g = new THREE.ConeGeometry(1, 1, 4, 1);
    g.rotateY(Math.PI / 4);
    g.scale(b.w * 1.3, 1.2, b.d * 1.3);
    g.translate(b.x, b.maxY + 0.6, b.z);
    roofs.push(g);
  }
  if (roofs.length) root.add(new THREE.Mesh(mergeGeometries(roofs), toon(th.roof)));
  if (th.snow && roofs.length) {
    // tuyết phủ mái
    const caps = (groups.house || []).map(b => { const g = new THREE.ConeGeometry(1, 1, 4, 1); g.rotateY(Math.PI / 4); g.scale(b.w * 0.5, 0.9, b.d * 0.5); g.translate(b.x, b.maxY + 1.75, b.z); return g; });
    if (caps.length) root.add(new THREE.Mesh(mergeGeometries(caps), toon(0xf4f8fb)));
  }

  // mép trên tường
  const caps = (groups.wall || []).map(b => { const g = new THREE.BoxGeometry(b.w + 0.2, 0.2, b.d + 0.2); g.translate(b.x, b.maxY, b.z); return g; });
  if (caps.length) root.add(new THREE.Mesh(mergeGeometries(caps), toon(th.cap)));

  // điểm đặt bom A / B
  for (const [k, s] of Object.entries(map.sites)) {
    const color = k === 'A' ? '#ff6b6b' : '#ffd166';
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: letterTex(k, color), transparent: true, depthWrite: false, opacity: 0.85 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(s.cx, 0.03, s.cz);
    root.add(m);
    const pts = [[s.x0, s.z0], [s.x1, s.z0], [s.x1, s.z1], [s.x0, s.z1], [s.x0, s.z0]].map(([x, z]) => new THREE.Vector3(x, 0.05, z));
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color })));
  }

  // khu xuất phát
  for (const [team, z] of Object.entries(map.buyZones)) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(z.r, 32), new THREE.MeshBasicMaterial({
      color: team === 'T' ? 0xe76f51 : 0x4895ef, transparent: true, opacity: 0.12, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(z.x, 0.02, z.z);
    root.add(m);
  }

  // dây lồng đèn (map phố)
  const lanterns = [];
  if (th.lanterns) {
    const lanternMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d });
    const lanternGlow = new THREE.MeshBasicMaterial({ color: 0xffc078 });
    const ropeMat = new THREE.LineBasicMaterial({ color: 0x3b2a20 });
    const strings = [[-8, -14, 8, -14], [-8, -2, 8, -2], [-21, -22, -42, -22], [21, -22, 42, -22], [-12, 10, 12, 10], [-42, 8, -21, 8], [21, 8, 42, 8]];
    const lanGeo = new THREE.SphereGeometry(0.28, 10, 8);
    lanGeo.scale(1, 1.3, 1);
    for (const [x0, z0, x1, z1] of strings) {
      const pts = [];
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push(new THREE.Vector3(x0 + (x1 - x0) * t, 5.6 - Math.sin(t * Math.PI) * 0.8, z0 + (z1 - z0) * t));
      }
      root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ropeMat));
      for (let i = 1; i < n; i += 2) {
        const l = new THREE.Mesh(lanGeo, i % 4 === 1 ? lanternMat : lanternGlow);
        l.position.copy(pts[i]).y -= 0.4;
        root.add(l);
        lanterns.push(l);
      }
    }
  }

  // tuyết rơi + núi tuyết xa (map đền)
  let snowPts = null, snowPos = null;
  if (th.snow) {
    const N = 900;
    snowPos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      snowPos[i * 3] = (Math.random() - 0.5) * map.bounds.x * 2.2;
      snowPos[i * 3 + 1] = Math.random() * 18;
      snowPos[i * 3 + 2] = (Math.random() - 0.5) * map.bounds.z * 2.2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
    snowPts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }));
    snowPts.frustumCulled = false;
    root.add(snowPts);
    const mtn = toon(0xc7d3e3), snowCap = toon(0xffffff);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = 110 + (i % 3) * 20, h = 45 + (i * 37) % 40;
      const m = new THREE.Mesh(new THREE.ConeGeometry(28, h, 6), mtn);
      m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
      root.add(m);
      const c = new THREE.Mesh(new THREE.ConeGeometry(10, h * 0.32, 6), snowCap);
      c.position.set(m.position.x, h - h * 0.16 - 2, m.position.z);
      root.add(c);
    }
  }

  return {
    root,
    update(t, dt = 0.016) {
      for (let i = 0; i < lanterns.length; i++) lanterns[i].rotation.z = Math.sin(t * 1.3 + i) * 0.12;
      if (snowPts) {
        for (let i = 0; i < snowPos.length; i += 3) {
          snowPos[i + 1] -= dt * 1.4;
          snowPos[i] += Math.sin(t + i) * dt * 0.3;
          if (snowPos[i + 1] < 0) snowPos[i + 1] = 18;
        }
        snowPts.geometry.attributes.position.needsUpdate = true;
      }
    },
    dispose() { root.removeFromParent(); },
  };
}
