// Dựng nhân vật chibi từ hình khối cơ bản (đầu to, thân nhỏ) + toon shading + viền đen.
// Không cần file model => rất nhẹ. Hoạt ảnh làm bằng code (procedural).
import * as THREE from 'three';

const OUTLINE_COLOR = 0x1b1630;
let gradientMap = null;
function toonGradient() {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const matCache = new Map();
export function toon(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!opts.unique && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts.params });
  if (!opts.unique) matCache.set(key, m);
  return m;
}
const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });

function mesh(geo, mat, outline = 0.035) {
  const m = new THREE.Mesh(geo, mat);
  if (outline) {
    const o = new THREE.Mesh(geo, outlineMat);
    o.scale.setScalar(1 + outline / Math.max(0.05, geo.boundingSphere?.radius || (geo.computeBoundingSphere(), geo.boundingSphere.radius)));
    o.userData.outline = true;
    m.add(o);
  }
  return m;
}

const G = {
  sphere: (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h),
  capsule: (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10),
  cone: (r, h, s = 8) => new THREE.ConeGeometry(r, h, s),
  cyl: (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s),
  torus: (r, t) => new THREE.TorusGeometry(r, t, 8, 24),
  box: (x, y, z) => new THREE.BoxGeometry(x, y, z),
};

// ---------------- Tóc ----------------
function buildHair(look, head) {
  const hm = toon(look.hair);
  // phần chỏm tóc trùm đầu
  const cap = mesh(new THREE.SphereGeometry(0.515, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), hm, 0.03);
  cap.rotation.x = -0.32;
  cap.position.set(0, 0.02, -0.03);
  head.add(cap);
  // tóc mái
  for (let i = -2; i <= 2; i++) {
    const b = mesh(G.cone(0.12, 0.36, 6), hm, 0.02);
    b.position.set(i * 0.15, 0.24 - Math.abs(i) * 0.03, 0.4);
    b.rotation.set(Math.PI - 0.5, 0, i * 0.18);
    head.add(b);
  }
  const spike = (x, y, z, rx, rz, r = 0.13, h = 0.5) => {
    const s = mesh(G.cone(r, h, 6), hm, 0.02);
    s.position.set(x, y, z);
    s.rotation.set(rx, 0, rz);
    head.add(s);
    return s;
  };
  switch (look.hairStyle) {
    case 'spiky':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        spike(Math.sin(a) * 0.32, 0.32, Math.cos(a) * 0.32 - 0.1, Math.cos(a) * 0.9 - 0.4, -Math.sin(a) * 0.9);
      }
      spike(0, 0.5, -0.05, -0.3, 0, 0.15, 0.5);
      break;
    case 'superSpiky':
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        spike(Math.sin(a) * 0.3, 0.38, Math.cos(a) * 0.28 - 0.12, Math.cos(a) * 0.55 - 0.35, -Math.sin(a) * 0.55, 0.15, 0.72);
      }
      spike(0, 0.6, -0.05, -0.15, 0, 0.18, 0.8);
      spike(0.12, 0.55, 0.12, 0.3, -0.3, 0.12, 0.6);
      spike(-0.12, 0.55, 0.12, 0.3, 0.3, 0.12, 0.6);
      break;
    case 'ponytail': {
      const tie = mesh(G.sphere(0.09), toon(look.accColor || 0xffffff), 0.015);
      tie.position.set(0, 0.32, -0.42);
      head.add(tie);
      const tail = new THREE.Group();
      tail.position.set(0, 0.32, -0.46);
      head.add(tail);
      for (let i = 0; i < 4; i++) {
        const seg = mesh(G.sphere(0.17 - i * 0.03), hm, 0.02);
        seg.scale.set(1, 1.5, 1);
        seg.position.set(0, -0.15 - i * 0.2, -0.12 - i * 0.04);
        tail.add(seg);
      }
      head.userData.tail = tail;
      spike(0.4, -0.05, 0.15, 0.1, 0.25, 0.1, 0.5).rotation.x = Math.PI;
      spike(-0.4, -0.05, 0.15, 0.1, -0.25, 0.1, 0.5).rotation.x = Math.PI;
      break;
    }
    case 'short':
      // tóc ngắn gọn: vài chỏm nhỏ phía sau + mái lệch
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * 0.6 + (i / 4) * Math.PI * 0.8;
        spike(Math.sin(a) * 0.36, 0.18, Math.cos(a) * 0.36 - 0.05, Math.cos(a) * 1.2, -Math.sin(a) * 1.2, 0.11, 0.3);
      }
      spike(0.18, 0.4, 0.3, 0.9, -0.5, 0.12, 0.42);
      break;
    case 'braids':
      // hai bím tóc dài hai bên
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          const b = mesh(G.sphere(0.1 - i * 0.008), hm, 0.015);
          b.position.set(sx * (0.42 + i * 0.02), -0.12 - i * 0.16, -0.05);
          head.add(b);
        }
        const tie = mesh(G.sphere(0.06), toon(look.accColor || 0xffffff), 0.01);
        tie.position.set(sx * 0.5, -0.86, -0.05);
        head.add(tie);
      }
      break;
    case 'mohawk':
      // dải tóc dựng giữa đỉnh đầu từ trước ra sau
      for (let i = 0; i < 6; i++) {
        const z = 0.3 - i * 0.14;
        spike(0, 0.42 + Math.sin((i / 5) * Math.PI) * 0.08, z, -0.2 - i * 0.18, 0, 0.11, 0.48);
      }
      break;
    case 'hooded': {
      // mũ trùm đầu có chóp nhọn phía sau
      const hood = mesh(new THREE.SphereGeometry(0.6, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), toon(look.outfit), 0.03);
      hood.rotation.x = -0.45;
      hood.position.set(0, 0.02, -0.06);
      head.add(hood);
      const tip = mesh(G.cone(0.2, 0.5, 8), toon(look.outfit), 0.02);
      tip.position.set(0, 0.25, -0.5);
      tip.rotation.x = -2.2;
      head.add(tip);
      break;
    }
    case 'long': {
      const back = mesh(G.sphere(0.5), hm, 0.03);
      back.scale.set(1.02, 1.35, 0.6);
      back.position.set(0, -0.28, -0.2);
      head.add(back);
      for (const sx of [-1, 1]) {
        const lock = mesh(G.capsule(0.09, 0.45), hm, 0.02);
        lock.position.set(sx * 0.42, -0.25, 0.18);
        head.add(lock);
      }
      break;
    }
  }
}

// ---------------- Phụ kiện + vũ khí ----------------
function buildAccessory(look, rig) {
  const am = toon(look.accColor || 0xffffff);
  switch (look.accessory) {
    case 'scarf': {
      const ring = mesh(G.torus(0.2, 0.08), am, 0.02);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.92;
      rig.body.add(ring);
      const tails = new THREE.Group();
      tails.position.set(0.08, 0.92, -0.18);
      rig.body.add(tails);
      for (let i = 0; i < 2; i++) {
        const t = mesh(G.box(0.12, 0.04, 0.5), am, 0.015);
        t.position.set(i * 0.1, 0, -0.25);
        t.rotation.y = (i - 0.5) * 0.3;
        tails.add(t);
      }
      rig.scarf = tails;
      break;
    }
    case 'belt': case 'sash': {
      const b = mesh(G.torus(0.25, 0.05), am, 0.015);
      b.rotation.x = Math.PI / 2;
      b.position.y = 0.55;
      rig.body.add(b);
      if (look.accessory === 'sash') {
        const knot = mesh(G.box(0.1, 0.3, 0.05), am, 0.015);
        knot.position.set(0.15, 0.42, -0.2);
        knot.rotation.z = 0.3;
        rig.body.add(knot);
      }
      break;
    }
    case 'pauldrons': {
      // giáp vai
      for (const sx of [-1, 1]) {
        const p = mesh(G.sphere(0.17, 12, 8), am, 0.02);
        p.scale.set(1.2, 0.7, 1.1);
        p.position.set(sx * 0.31, 0.92, 0);
        rig.body.add(p);
      }
      const chest = mesh(G.box(0.34, 0.2, 0.06), am, 0.015);
      chest.position.set(0, 0.72, 0.21);
      rig.body.add(chest);
      break;
    }
    case 'flowerCrown': {
      // vòng hoa trên đầu
      const ring = mesh(G.torus(0.42, 0.05), toon(0x52b788), 0.01);
      ring.rotation.x = Math.PI / 2 - 0.2;
      ring.position.set(0, 0.28, 0);
      rig.head.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const fl = mesh(G.sphere(0.075, 8, 6), toon(i % 2 ? am.color.getHex() : 0xfff3b0), 0.01);
        fl.position.set(Math.sin(a) * 0.42, 0.28 + Math.cos(a) * 0.08, Math.cos(a) * 0.42);
        rig.head.add(fl);
      }
      break;
    }
    case 'mask': {
      // khăn che nửa mặt dưới
      const m = mesh(new THREE.SphereGeometry(0.505, 20, 10, Math.PI * 0.05, Math.PI * 0.9, Math.PI * 0.62, Math.PI * 0.22), am, 0);
      m.position.set(0, 0, 0.02);
      rig.head.add(m);
      break;
    }
    case 'hat': {
      const hat = new THREE.Group();
      hat.position.set(0, 0.42, -0.04);
      hat.rotation.set(-0.15, 0, 0.12);
      const brim = mesh(G.cyl(0.78, 0.78, 0.05, 24), am, 0.02);
      const top = mesh(G.cone(0.42, 0.9, 16), am, 0.02);
      top.position.y = 0.45;
      top.rotation.z = -0.25;
      const band = mesh(G.cyl(0.43, 0.43, 0.1, 16), toon(look.outfit2), 0);
      band.position.y = 0.07;
      const star = new THREE.Mesh(G.sphere(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
      star.position.set(0, 0.07, 0.43);
      hat.add(brim, top, band, star);
      rig.head.add(hat);
      break;
    }
  }
  if (look.headband) {
    const band = mesh(G.cyl(0.505, 0.505, 0.1, 24, 1, true), toon(0x2b2d42), 0);
    band.position.set(0, 0.17, 0);
    band.rotation.x = -0.12;
    const plate = mesh(G.box(0.3, 0.13, 0.04), toon(look.headband), 0.012);
    plate.position.set(0, 0.17, 0.5);
    plate.rotation.x = -0.25;
    rig.head.add(band, plate);
  }
}

function buildWeapon(look, hand) {
  const w = new THREE.Group();
  switch (look.weapon) {
    case 'kunai': {
      const blade = mesh(G.cone(0.05, 0.3, 4), toon(0xc9d6df), 0.01);
      blade.position.y = -0.25;
      blade.rotation.x = Math.PI;
      const grip = mesh(G.cyl(0.025, 0.025, 0.15), toon(0x2b2d42), 0.01);
      grip.position.y = -0.05;
      const ring = mesh(G.torus(0.04, 0.012), toon(0x2b2d42), 0);
      ring.position.y = 0.05;
      w.add(blade, grip, ring);
      w.rotation.x = Math.PI / 2;
      break;
    }
    case 'katana': {
      const blade = mesh(G.box(0.04, 1.0, 0.09), toon(0xe9ecef, { params: { emissive: 0x332222 } }), 0.012);
      blade.position.y = 0.62;
      const guard = mesh(G.cyl(0.09, 0.09, 0.03, 10), toon(0xffba08), 0.01);
      guard.position.y = 0.1;
      const grip = mesh(G.cyl(0.03, 0.03, 0.22), toon(0x370617), 0.01);
      grip.position.y = -0.02;
      w.add(blade, guard, grip);
      w.rotation.x = Math.PI / 2 + 0.2;
      w.userData.tip = new THREE.Vector3(0, 1.1, 0);
      break;
    }
    case 'spear': {
      // thương dài: cán, mũi thương phát sáng, tua vàng
      const rod = mesh(G.cyl(0.03, 0.03, 1.9), toon(0x3d3b5a), 0.012);
      rod.position.y = 0.45;
      const tip = new THREE.Mesh(G.cone(0.08, 0.38, 4), new THREE.MeshBasicMaterial({ color: 0xe0d4ff }));
      tip.position.y = 1.58;
      const guard = mesh(G.cyl(0.07, 0.07, 0.05, 8), toon(0xffd23f), 0.01);
      guard.position.y = 1.38;
      const tassel = mesh(G.cone(0.06, 0.22, 6), toon(0xffd23f), 0.01);
      tassel.position.y = 1.27; tassel.rotation.x = Math.PI;
      w.add(rod, tip, guard, tassel);
      w.rotation.x = Math.PI / 2 - 0.1;
      w.userData.tip = new THREE.Vector3(0, 1.7, 0);
      break;
    }
    case 'gauntlet': {
      // găng tay sắt to bao nắm đấm
      const fist = mesh(G.box(0.27, 0.25, 0.27), toon(0x8d99ae), 0.02);
      const knuckle = mesh(G.box(0.29, 0.08, 0.1), toon(0xbc6c25), 0.01);
      knuckle.position.set(0, -0.06, 0.12);
      const cuff = mesh(G.cyl(0.13, 0.15, 0.12, 10), toon(0x5c677d), 0.01);
      cuff.position.y = 0.16;
      w.add(fist, knuckle, cuff);
      break;
    }
    case 'branch': {
      // gậy cành cây có lá và hạt mầm phát sáng
      const rod = mesh(G.cyl(0.035, 0.045, 1.2), toon(0x7f5539), 0.012);
      rod.position.y = 0.25;
      rod.rotation.z = 0.06;
      const seed = new THREE.Mesh(G.sphere(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xc7f9cc }));
      seed.position.y = 0.95;
      w.add(rod, seed);
      for (let i = 0; i < 4; i++) {
        const leaf = mesh(G.sphere(0.09, 6, 4), toon(0x52b788), 0.01);
        leaf.scale.set(0.5, 0.2, 1);
        const a = i * Math.PI / 2;
        leaf.position.set(Math.cos(a) * 0.12, 0.85 + i * 0.03, Math.sin(a) * 0.12);
        leaf.rotation.y = -a;
        w.add(leaf);
      }
      w.userData.gem = seed;
      break;
    }
    case 'dagger': {
      // đoản đao cầm ngược
      const blade = mesh(G.box(0.04, 0.5, 0.08), toon(0x9d8cc2, { params: { emissive: 0x2a1040 } }), 0.01);
      blade.position.y = -0.3;
      const grip = mesh(G.cyl(0.03, 0.03, 0.15), toon(0x1b1b2f), 0.01);
      grip.position.y = -0.02;
      w.add(blade, grip);
      w.rotation.x = Math.PI / 2;
      break;
    }
    case 'staff': {
      const rod = mesh(G.cyl(0.03, 0.035, 1.3), toon(0x6c4f3d), 0.012);
      rod.position.y = 0.25;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), new THREE.MeshBasicMaterial({ color: 0xbde0fe }));
      gem.position.y = 0.98;
      const ring = mesh(G.torus(0.13, 0.02), toon(0xffd166), 0);
      ring.position.y = 0.98;
      w.add(rod, gem, ring);
      w.userData.gem = gem;
      break;
    }
  }
  hand.add(w);
  return w;
}

// ---------------- Dựng nhân vật ----------------
export function buildChibi(look) {
  const root = new THREE.Group();     // đặt ở chân, xoay theo yaw
  const body = new THREE.Group();     // dùng để nhún/nghiêng
  root.add(body);
  const rig = { root, body };

  const skin = toon(look.skin);
  const cloth = toon(look.outfit);
  const cloth2 = toon(look.outfit2);

  // Thân
  const torso = mesh(G.capsule(0.25, 0.18), cloth);
  torso.position.y = 0.68;
  torso.scale.set(1, 1, 0.85);
  body.add(torso);
  const skirt = mesh(G.cyl(0.22, 0.3, 0.2, 14), cloth2, 0.02);
  skirt.position.y = 0.48;
  body.add(skirt);

  // Đầu
  const head = new THREE.Group();
  head.position.y = 1.32;
  body.add(head);
  rig.head = head;
  const skull = mesh(G.sphere(0.48, 28, 20), skin, 0.035);
  skull.scale.set(1.05, 0.98, 1);
  head.add(skull);

  // Mắt anime: hình oval lớn + điểm sáng
  const eyeMat = new THREE.MeshBasicMaterial({ color: look.eye });
  const eyeDark = new THREE.MeshBasicMaterial({ color: 0x14112b });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  rig.eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * 0.18, -0.04, 0.43);
    eye.rotation.y = sx * 0.32;
    const outer = new THREE.Mesh(G.sphere(0.1, 14, 10), eyeDark);
    outer.scale.set(0.82, 1.25, 0.35);
    const iris = new THREE.Mesh(G.sphere(0.075, 14, 10), eyeMat);
    iris.scale.set(0.82, 1.2, 0.3);
    iris.position.set(0, -0.02, 0.012);
    const hl = new THREE.Mesh(G.sphere(0.032, 8, 6), white);
    hl.position.set(sx * -0.025, 0.045, 0.035);
    const hl2 = new THREE.Mesh(G.sphere(0.015, 6, 4), white);
    hl2.position.set(sx * 0.02, -0.05, 0.035);
    eye.add(outer, iris, hl, hl2);
    head.add(eye);
    rig.eyes.push(eye);
    const blush = new THREE.Mesh(G.sphere(0.06, 10, 6), new THREE.MeshBasicMaterial({ color: 0xff8fab, transparent: true, opacity: 0.45 }));
    blush.scale.set(1.3, 0.6, 0.2);
    blush.position.set(sx * 0.29, -0.18, 0.39);
    blush.rotation.y = sx * 0.5;
    head.add(blush);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 4, 10, Math.PI), eyeDark);
  mouth.position.set(0, -0.22, 0.46);
  mouth.rotation.z = Math.PI;
  head.add(mouth);
  rig.mouth = mouth;

  buildHair(look, head);

  // Tay (pivot ở vai) – tay phải ở phía -X vì nhân vật nhìn về +Z
  const mkArm = sx => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.3, 0.86, 0);
    const arm = mesh(G.capsule(0.085, 0.2), cloth, 0.02);
    arm.position.y = -0.15;
    const hand = new THREE.Group();
    hand.position.y = -0.34;
    const fist = mesh(G.sphere(0.1, 12, 10), skin, 0.02);
    hand.add(fist);
    pivot.add(arm, hand);
    body.add(pivot);
    return { pivot, hand };
  };
  const R = mkArm(-1), L = mkArm(1);
  rig.armR = R.pivot; rig.armL = L.pivot; rig.handR = R.hand; rig.handL = L.hand;

  // Chân (pivot ở hông)
  const mkLeg = sx => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.13, 0.42, 0);
    const leg = mesh(G.capsule(0.1, 0.14), cloth2, 0.02);
    leg.position.y = -0.17;
    const foot = mesh(G.sphere(0.12, 12, 8), toon(0x2b2d42), 0.02);
    foot.scale.set(0.9, 0.6, 1.3);
    foot.position.set(0, -0.36, 0.04);
    pivot.add(leg, foot);
    body.add(pivot);
    return pivot;
  };
  rig.legR = mkLeg(-1); rig.legL = mkLeg(1);

  buildAccessory(look, rig);
  rig.weapon = buildWeapon(look, rig.handR);
  if (look.weapon === 'gauntlet') buildWeapon(look, rig.handL);   // găng cả hai tay

  // Bóng tròn dưới chân (rẻ hơn shadow map rất nhiều)
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  rig.shadow = shadow;

  // Thu thập vật liệu để làm hiệu ứng nháy trắng khi trúng đòn
  const flashables = [];
  root.traverse(o => { if (o.isMesh && o.material.isMeshToonMaterial) flashables.push(o); });
  rig.flashables = flashables;

  root.scale.setScalar(look.scale || 1);   // nhân vật to con trông lớn hơn (không đổi va chạm)
  return new ChibiAnimator(rig);
}

// ---------------- Hoạt ảnh ----------------
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export const ANIM = { idle: 0, run: 1, sprint: 2, air: 3, fly: 4, dash: 5, charge: 6, heal: 7, stun: 8, dead: 9 };

export class ChibiAnimator {
  constructor(rig) {
    this.rig = rig;
    this.root = rig.root;
    this.t = Math.random() * 10;
    this.state = 0;
    this.action = null;  // {pose, t, dur, alt}
    this.flash = 0;
    this.dead = 0;
    this.punchAlt = 0;
    this.cur = { bodyY: 0, lean: 0, spin: 0, aRx: 0, aRz: 0, aLx: 0, aLz: 0, lRx: 0, lLx: 0, headX: 0, roll: 0 };
    this.flashMat = new Map();
  }

  play(pose, dur) {
    if (pose === 'punch' || pose === 'slash') this.punchAlt ^= 1;
    this.action = { pose, t: 0, dur: Math.max(0.15, dur), alt: this.punchAlt };
  }

  hitFlash() { this.flash = 0.15; }

  setFlash(on) {
    for (const m of this.rig.flashables) {
      if (on) {
        if (!this.flashMat.has(m)) this.flashMat.set(m, m.material);
        m.material = FLASH_MAT;
      } else if (this.flashMat.has(m)) {
        m.material = this.flashMat.get(m);
      }
    }
    if (!on) this.flashMat.clear();
  }

  update(dt, state, speed = 0) {
    this.t += dt;
    const t = this.t;
    const r = this.rig;
    const tg = { bodyY: 0, lean: 0, spin: 0, aRx: 0, aRz: -0.12, aLx: 0, aLz: 0.12, lRx: 0, lLx: 0, headX: 0, roll: 0 };
    const k = Math.min(1, dt * 14);

    switch (state) {
      case ANIM.idle:
        tg.bodyY = Math.sin(t * 2.5) * 0.02;
        tg.aRz = -0.15 - Math.sin(t * 2.5) * 0.04; tg.aLz = 0.15 + Math.sin(t * 2.5) * 0.04;
        tg.headX = Math.sin(t * 1.3) * 0.04;
        break;
      case ANIM.run: case ANIM.sprint: {
        const sp = state === ANIM.sprint ? 17 : 13;
        const s = Math.sin(t * sp);
        tg.bodyY = Math.abs(Math.cos(t * sp)) * 0.08;
        tg.lean = state === ANIM.sprint ? 0.42 : 0.15;
        tg.lRx = s * 0.95; tg.lLx = -s * 0.95;
        if (state === ANIM.sprint) { tg.aRx = 1.3; tg.aLx = 1.3; tg.aRz = -0.3; tg.aLz = 0.3; } // chạy kiểu ninja
        else { tg.aRx = -s * 0.9; tg.aLx = s * 0.9; }
        break;
      }
      case ANIM.air:
        tg.lRx = -0.7; tg.lLx = 0.3; tg.aRx = -0.4; tg.aLx = -0.4; tg.aRz = -0.7; tg.aLz = 0.7;
        tg.bodyY = 0.05;
        break;
      case ANIM.fly:
        tg.lean = 0.9; tg.aRx = 0.6; tg.aLx = 0.6; tg.lRx = 0.2; tg.lLx = 0.35; tg.headX = -0.5;
        tg.bodyY = Math.sin(t * 4) * 0.05;
        break;
      case ANIM.dash:
        tg.lean = 0.7; tg.aRx = 1.0; tg.aLx = 1.0; tg.lRx = 0.6; tg.lLx = -0.3; tg.headX = -0.4;
        break;
      case ANIM.charge:
        tg.bodyY = -0.12 + Math.sin(t * 40) * 0.01;
        tg.aRz = -0.6; tg.aLz = 0.6; tg.aRx = -0.3; tg.aLx = -0.3;
        tg.lRx = -0.35; tg.lLx = 0.35; tg.headX = 0.15;
        break;
      case ANIM.heal:
        tg.aRx = -1.4; tg.aLx = -1.4; tg.aRz = 0.35; tg.aLz = -0.35; tg.headX = 0.25;
        tg.bodyY = Math.sin(t * 3) * 0.03;
        break;
      case ANIM.stun:
        tg.roll = Math.sin(t * 9) * 0.15; tg.headX = 0.3; tg.aRz = -0.4; tg.aLz = 0.4;
        break;
    }

    // Tư thế ra chiêu đè lên tư thế cơ bản
    const a = this.action;
    if (a) {
      a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      const s = a.alt ? -1 : 1;
      switch (a.pose) {
        case 'slash': {
          const q = ease(Math.min(1, p * 1.6));
          tg.aRx = lerp(-2.6, -0.4, q); tg.aRz = lerp(-0.8 * s, 0.6 * s, q) - 0.2;
          tg.lean = 0.25; tg.spin = lerp(-0.6 * s, 0.5 * s, q);
          tg.lRx = 0.5; tg.lLx = -0.4;
          break;
        }
        case 'punch': {
          const q = p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65 * 0.6;
          if (a.alt) { tg.aLx = -1.55 * q; tg.aRx = 0.5; tg.spin = 0.35 * q; }
          else { tg.aRx = -1.55 * q; tg.aLx = 0.5; tg.spin = -0.35 * q; }
          tg.aRz = -0.05; tg.aLz = 0.05; tg.lean = 0.2; tg.lRx = 0.4; tg.lLx = -0.4;
          break;
        }
        case 'throw': {
          const q = ease(Math.min(1, p * 2));
          tg.aRx = lerp(-2.8, -1.2, q); tg.aRz = -0.2; tg.lean = lerp(-0.15, 0.25, q); tg.spin = lerp(0.4, -0.3, q);
          break;
        }
        case 'push':
          tg.aRx = -1.5; tg.aLx = -1.2; tg.aRz = 0.15; tg.aLz = -0.1; tg.lean = 0.15; tg.spin = -0.2;
          break;
        case 'thrust':
          tg.aRx = -1.5; tg.aRz = 0.1; tg.aLx = 0.9; tg.lean = 0.55; tg.lRx = 0.8; tg.lLx = -0.6; tg.headX = -0.2;
          break;
        case 'beam':
          if (p < 0.35) { tg.aRx = 0.6; tg.aLx = 0.6; tg.aRz = 0.3; tg.aLz = -0.3; tg.spin = 0.6; tg.bodyY = -0.1; }
          else { tg.aRx = -1.55; tg.aLx = -1.55; tg.aRz = 0.18; tg.aLz = -0.18; tg.lean = 0.1; tg.lRx = 0.5; tg.lLx = -0.5; }
          break;
        case 'raise':
          tg.aRx = -2.9; tg.aLx = -2.9; tg.aRz = 0.2; tg.aLz = -0.2; tg.headX = -0.4; tg.lean = -0.15;
          break;
        case 'spin':
          tg.spin = p * Math.PI * 4; tg.aRz = -1.4; tg.aLz = 1.4; tg.bodyY = 0.1;
          break;
        case 'slam': {
          const q = ease(Math.min(1, p * 1.7));
          tg.aRx = lerp(-2.9, -0.9, q); tg.aLx = lerp(-2.9, -0.9, q); tg.lean = lerp(-0.2, 0.5, q); tg.bodyY = lerp(0.1, -0.15, q);
          break;
        }
        case 'uppercut':
          tg.aRx = -3.0; tg.aRz = 0.2; tg.aLx = 0.5; tg.lRx = -0.9; tg.lLx = 0.4; tg.spin = p * Math.PI * 2;
          break;
      }
      if (a.t >= a.dur) this.action = null;
    }

    // Lerp mượt
    const c = this.cur;
    for (const key in tg) c[key] = key === 'spin' && a && a.pose === 'spin' ? tg[key] : lerp(c[key], tg[key], k);

    // Chết: ngã xuống
    this.dead = lerp(this.dead, state === ANIM.dead ? 1 : 0, Math.min(1, dt * 8));

    r.body.position.y = c.bodyY;
    r.body.rotation.set(c.lean - this.dead * 1.45, c.spin, c.roll);
    r.body.position.z = -this.dead * 0.3;
    r.armR.rotation.set(c.aRx, 0, c.aRz);
    r.armL.rotation.set(c.aLx, 0, c.aLz);
    r.legR.rotation.x = c.lRx;
    r.legL.rotation.x = c.lLx;
    r.head.rotation.x = c.headX;
    if (r.scarf) r.scarf.rotation.x = 0.3 + Math.sin(t * 9) * 0.15 + speed * 0.04;
    if (r.head.userData.tail) r.head.userData.tail.rotation.x = 0.1 + Math.sin(t * 6) * 0.08 + speed * 0.03;
    if (r.weapon.userData.gem) r.weapon.userData.gem.rotation.y += dt * 2;

    // Chớp mắt
    const blink = (t % 3.7) < 0.12 || state === ANIM.dead ? 0.12 : 1;
    for (const e of r.eyes) e.scale.y = lerp(e.scale.y, blink, Math.min(1, dt * 30));

    // Nháy trắng khi trúng đòn
    if (this.flash > 0) {
      this.flash -= dt;
      this.setFlash(this.flash > 0);
    }
  }
}

const FLASH_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff });
