// Mô hình súng dựng từ khối hộp (low-poly, nhẹ). Nòng súng hướng về -Z.
import * as THREE from 'three';
import { toon } from '../chibi.js';

const M = {
  metal: () => toon(0x2b2d42),
  steel: () => toon(0x8d99ae),
  wood: () => toon(0x8d5524),
  dark: () => toon(0x1b1b26),
  accent: c => toon(c),
};

function box(w, h, d, mat, x = 0, y = 0, z = 0, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  return m;
}
function cyl(r, l, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 10), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

// Trả về Group, userData.muzzle = điểm đầu nòng (toạ độ local)
export function buildGun(id) {
  const g = new THREE.Group();
  let muzzle = -0.3;
  switch (id) {
    case 'knife':
      g.add(box(0.03, 0.035, 0.12, M.dark(), 0, 0, 0.02));
      g.add(box(0.012, 0.045, 0.22, M.steel(), 0, 0.005, -0.15));
      g.add(box(0.06, 0.012, 0.02, M.metal(), 0, 0, -0.04));
      muzzle = -0.26;
      break;
    case 'pistol':
      g.add(box(0.035, 0.05, 0.19, M.metal(), 0, 0.03, -0.05));
      g.add(box(0.032, 0.1, 0.045, M.dark(), 0, -0.04, 0.02, 0.2));
      muzzle = -0.15;
      break;
    case 'eagle':
      g.add(box(0.045, 0.065, 0.26, M.steel(), 0, 0.035, -0.08));
      g.add(box(0.036, 0.11, 0.05, M.dark(), 0, -0.04, 0.02, 0.2));
      g.add(box(0.03, 0.02, 0.04, M.metal(), 0, 0.075, 0.03));
      muzzle = -0.22;
      break;
    case 'smg':
      g.add(box(0.05, 0.08, 0.32, M.metal(), 0, 0.02, -0.06));
      g.add(box(0.035, 0.16, 0.045, M.dark(), 0, -0.1, -0.08));
      g.add(box(0.035, 0.09, 0.045, M.dark(), 0, -0.05, 0.06, 0.25));
      g.add(cyl(0.015, 0.12, M.metal(), 0, 0.035, -0.27));
      g.add(box(0.02, 0.05, 0.15, M.metal(), 0, 0.01, 0.15));
      muzzle = -0.33;
      break;
    case 'shotgun':
      g.add(cyl(0.024, 0.62, M.metal(), 0, 0.03, -0.22));
      g.add(cyl(0.02, 0.5, M.metal(), 0, -0.01, -0.18));
      g.add(box(0.055, 0.04, 0.16, M.wood(), 0, -0.015, -0.22));
      g.add(box(0.05, 0.08, 0.16, M.metal(), 0, 0.01, 0.03));
      g.add(box(0.045, 0.1, 0.28, M.wood(), 0, -0.03, 0.22, -0.12));
      muzzle = -0.53;
      break;
    case 'rifle':
    case 'carbine': {
      const body = id === 'rifle' ? M.wood() : M.accent(0x34495e);
      g.add(box(0.055, 0.09, 0.42, M.metal(), 0, 0.02, -0.05));
      g.add(box(0.05, 0.06, 0.24, body, 0, 0.0, -0.33));
      g.add(cyl(0.014, 0.22, M.metal(), 0, 0.03, -0.55));
      const mag = box(0.035, 0.19, 0.06, M.dark(), 0, -0.12, -0.08, id === 'rifle' ? -0.35 : -0.1);
      g.add(mag);
      g.add(box(0.035, 0.09, 0.045, M.dark(), 0, -0.07, 0.08, 0.3));
      g.add(box(0.05, 0.09, 0.24, body, 0, -0.01, 0.27));
      if (id === 'carbine') g.add(box(0.03, 0.04, 0.12, M.metal(), 0, 0.085, -0.05));
      muzzle = -0.66;
      break;
    }
    case 'sniper':
      g.add(box(0.055, 0.08, 0.5, M.accent(0x3a5a40), 0, 0.01, -0.05));
      g.add(cyl(0.017, 0.5, M.metal(), 0, 0.03, -0.55));
      g.add(cyl(0.035, 0.28, M.dark(), 0, 0.11, -0.05));
      g.add(box(0.035, 0.12, 0.045, M.dark(), 0, -0.08, 0.06, 0.3));
      g.add(box(0.05, 0.1, 0.26, M.accent(0x3a5a40), 0, -0.01, 0.32));
      g.add(box(0.03, 0.12, 0.05, M.dark(), 0, -0.09, -0.12));
      muzzle = -0.8;
      break;
  }
  g.userData.muzzle = new THREE.Vector3(0, 0.03, muzzle);
  return g;
}

// Súng góc nhìn thứ nhất: thêm 2 bàn tay chibi tròn tròn
export function buildViewModel(id, skin = 0xffe0c4, sleeve = 0x3d2c2e) {
  const root = new THREE.Group();
  const gun = buildGun(id);
  root.add(gun);
  const hand = new THREE.SphereGeometry(0.055, 12, 10);
  const skinM = toon(skin), sleeveM = toon(sleeve);
  const h1 = new THREE.Mesh(hand, skinM);
  h1.position.set(0, -0.04, id === 'knife' ? 0.04 : 0.05);
  const h2 = new THREE.Mesh(hand, skinM);
  h2.position.set(0.02, -0.03, ['pistol', 'eagle', 'knife'].includes(id) ? 0.0 : -0.25);
  if (id === 'knife') h2.visible = false;
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.25, 4, 8), sleeveM);
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0.02, -0.07, 0.25);
  root.add(h1, h2, arm);
  root.userData.muzzle = gun.userData.muzzle;
  return root;
}

// Lựu đạn: thân trụ + nắp + chốt
const NADE_COLORS = { he: 0x3a5a40, flash: 0xd9dde3, smoke: 0x6c7a8f };
export function buildNade(k, withHand = false) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.11, 10), toon(NADE_COLORS[k] || 0x555555));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.035, 8), toon(0x2b2d42));
  cap.position.y = 0.07;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 4, 10), toon(0xc9a227));
  ring.position.set(0.03, 0.085, 0);
  ring.rotation.y = Math.PI / 2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.015, 10), toon(k === 'he' ? 0xffd166 : k === 'flash' ? 0x4895ef : 0xe9ecef));
  band.position.y = 0.02;
  g.add(body, cap, ring, band);
  if (withHand) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), toon(0xffe0c4));
    hand.position.set(0.01, -0.04, 0.04);
    g.add(hand);
  }
  g.userData.muzzle = new THREE.Vector3(0, 0.05, -0.05);
  return g;
}

// Quả bom (hộp + đèn đỏ)
export function buildBomb() {
  const g = new THREE.Group();
  g.add(box(0.4, 0.18, 0.28, toon(0x3d3d3d), 0, 0.09, 0));
  g.add(box(0.36, 0.06, 0.22, toon(0xc9a227), 0, 0.2, 0));
  g.add(box(0.12, 0.05, 0.1, toon(0x111111), 0.08, 0.25, 0));
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  light.position.set(-0.1, 0.25, 0);
  g.add(light);
  g.userData.light = light;
  return g;
}
