// Đấu trường: trời, đất, cột đá, cây anh đào, đèn lồng, cánh hoa bay. Toàn bộ là hình khối đơn giản.
import * as THREE from 'three';
import { ARENA } from '/shared/config.js';
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

export function buildWorld(scene) {
  // ---------- Bầu trời gradient ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3f8cf0) }, mid: { value: new THREE.Color(0xa9d4ff) }, bot: { value: new THREE.Color(0xffd6e8) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
      void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bot, pow(-h, 0.5));
      gl_FragColor = vec4(c, 1.0); }`,
  }));
  scene.add(sky);
  scene.fog = new THREE.Fog(0xb9dcff, 60, 170);

  // mặt trời
  const sun = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d5, fog: false }));
  sun.position.set(120, 140, -260);
  scene.add(sun);

  // ---------- Ánh sáng ----------
  scene.add(new THREE.HemisphereLight(0xe6f4ff, 0x7a6a8a, 1.35));
  const dir = new THREE.DirectionalLight(0xffffff, 2.2);
  dir.position.set(30, 50, 20);
  scene.add(dir);

  // ---------- Mặt sàn đấu trường ----------
  const floorTex = canvasTex(1024, (g, s) => {
    const c = s / 2;
    g.fillStyle = '#c9b496'; g.fillRect(0, 0, s, s);
    // các vòng gạch
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
    // loang màu ngẫu nhiên
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${150 + Math.random() * 60},${120 + Math.random() * 50},${90 + Math.random() * 40},0.08)`;
      const x = Math.random() * s, y = Math.random() * s, r = 10 + Math.random() * 40;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // biểu tượng trung tâm
    g.strokeStyle = 'rgba(200,60,60,0.55)'; g.lineWidth = 10;
    g.beginPath(); g.arc(c, c, c * 0.32, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 4;
    g.beginPath(); g.arc(c, c, c * 0.27, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(200,60,60,0.4)'; g.lineWidth = 14;
    g.beginPath(); g.arc(c, c, c * 0.97, 0, Math.PI * 2); g.stroke();
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA.radius, 64),
    new THREE.MeshToonMaterial({ map: floorTex, gradientMap: toon(0).gradientMap }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // bệ đá viền đấu trường
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(ARENA.radius + 0.6, ARENA.radius + 1.2, 1.4, 64, 1, true), toon(0x9c8b7a));
  rim.position.y = -0.69;
  scene.add(rim);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(ARENA.radius + 0.3, 0.35, 6, 64), toon(0xc9b79c));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.05;
  scene.add(lip);

  // mặt cỏ bên ngoài
  const grassTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#8fd07a'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(70,150,70,0.35)' : 'rgba(180,230,140,0.35)';
      g.fillRect(Math.random() * s, Math.random() * s, 2, 5);
    }
  }, 40);
  const grass = new THREE.Mesh(new THREE.CircleGeometry(300, 48),
    new THREE.MeshToonMaterial({ map: grassTex, gradientMap: toon(0).gradientMap }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -1.4;
  scene.add(grass);

  // ---------- Chướng ngại vật ----------
  const stone = toon(0xb8a99a), stoneDark = toon(0x8a7b70), moss = toon(0x7fb069);
  for (const [x, z, r, h] of ARENA.obstacles) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    if (h >= 3) {
      // cột đá có bậc + chóp
      const col = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 10), stone);
      col.position.y = h / 2;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 1.1, 0.35, 10), stoneDark);
      cap.position.y = h;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.2, 0.4, 10), stoneDark);
      base.position.y = 0.2;
      g.add(col, cap, base);
      // dây thừng thần đạo
      const rope = new THREE.Mesh(new THREE.TorusGeometry(r * 0.9, 0.08, 6, 20), toon(0xf4e3b2));
      rope.rotation.x = Math.PI / 2;
      rope.position.y = h * 0.7;
      g.add(rope);
    } else {
      // tảng đá / bệ thấp
      const rock = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r, h, 8), stone);
      rock.position.y = h / 2;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.15, 8), moss);
      top.position.y = h + 0.02;
      g.add(rock, top);
    }
    g.rotation.y = Math.random() * Math.PI;
    scene.add(g);
  }

  // ---------- Trang trí ngoài sân ----------
  const trunk = toon(0x7a5235);
  const blossoms = [toon(0xffb7d5), toon(0xff9ec7), toon(0xffd1e3)];
  const pine = toon(0x3f8f5a);
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rnd() * 0.1;
    const r = ARENA.radius + 8 + rnd() * 30;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * r, -1.4, Math.sin(a) * r);
    const sc = 0.8 + rnd() * 0.8;
    g.scale.setScalar(sc);
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
    scene.add(g);
  }

  // cổng torii
  const red = toon(0xd62828), black = toon(0x22223b);
  const torii = (x, z, rotY) => {
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
    scene.add(g);
  };
  torii(0, -(ARENA.radius + 6), 0);
  torii(0, ARENA.radius + 6, 0);
  torii(ARENA.radius + 6, 0, Math.PI / 2);
  torii(-(ARENA.radius + 6), 0, Math.PI / 2);

  // đèn lồng quanh viền (phát sáng nhẹ)
  const lanternMat = new THREE.MeshBasicMaterial({ color: 0xffc26b });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
    const r = ARENA.radius + 2;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * r, -1.4, Math.sin(a) * r);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 2.6, 6), stoneDark);
    post.position.y = 1.3;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), lanternMat);
    lamp.position.y = 3;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.6, 4), stoneDark);
    roof.position.y = 3.7;
    roof.rotation.y = Math.PI / 4;
    g.add(post, lamp, roof);
    scene.add(g);
  }

  // núi xa
  const mtn = [toon(0x9fb7d9), toon(0xb4c8e6), toon(0x8aa3c8)];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 170 + rnd() * 40;
    const h = 40 + rnd() * 50;
    const m = new THREE.Mesh(new THREE.ConeGeometry(30 + rnd() * 20, h, 6), mtn[i % 3]);
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    scene.add(m);
    if (h > 70) {
      const snow = new THREE.Mesh(new THREE.ConeGeometry(9, 14, 6), toon(0xffffff));
      snow.position.set(m.position.x, h - 8, m.position.z);
      scene.add(snow);
    }
  }

  // ---------- Cánh hoa anh đào bay ----------
  const N = 260;
  const petalPos = new Float32Array(N * 3);
  const petalSeed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    petalPos[i * 3] = (Math.random() - 0.5) * 100;
    petalPos[i * 3 + 1] = Math.random() * 25;
    petalPos[i * 3 + 2] = (Math.random() - 0.5) * 100;
    petalSeed[i] = Math.random() * 10;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
  const petals = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffb7d5, size: 0.28, transparent: true, opacity: 0.85, depthWrite: false }));
  petals.frustumCulled = false;
  scene.add(petals);

  return {
    update(dt, t) {
      for (let i = 0; i < N; i++) {
        const s = petalSeed[i];
        petalPos[i * 3] += (Math.sin(t * 0.7 + s) * 0.8 + 0.6) * dt;
        petalPos[i * 3 + 1] -= (0.8 + Math.sin(s) * 0.3) * dt;
        petalPos[i * 3 + 2] += Math.cos(t * 0.5 + s) * 0.6 * dt;
        if (petalPos[i * 3 + 1] < 0) {
          petalPos[i * 3] = (Math.random() - 0.5) * 100;
          petalPos[i * 3 + 1] = 22 + Math.random() * 4;
          petalPos[i * 3 + 2] = (Math.random() - 0.5) * 100;
        }
      }
      pg.attributes.position.needsUpdate = true;
    },
  };
}
