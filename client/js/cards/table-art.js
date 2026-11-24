import * as THREE from 'three';
import { buildLounge } from './lounge-art.js';

const SIZE = 512;
const HALF = SIZE / 2;
const TAU = 2 * Math.PI;
const DETAIL_SCALE = 1.5;

// Các bề mặt được vẽ một lần khi tạo cảnh, dùng chung cho cả ba chế độ bài.
function texture(paint, width = SIZE, height = width, scale = DETAIL_SCALE) {
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  paint(g);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

function fillSurface(g, x, y, inner, outer) {
  const glow = g.createRadialGradient(x, y, 24, HALF, HALF, HALF * 1.4);
  glow.addColorStop(0, inner);
  glow.addColorStop(1, outer);
  g.fillStyle = glow;
  g.fillRect(0, 0, SIZE, SIZE);
}

function weave(g) {
  g.fillStyle = 'rgba(0, 0, 0, .065)';
  for (let i = 1; i < SIZE; i += 3) {
    g.fillRect(i, 0, 1, SIZE);
    g.fillRect(0, i, SIZE, 1);
  }
  g.fillStyle = 'rgba(255, 255, 255, .035)';
  for (let i = 0; i < SIZE; i += 3) g.fillRect(i, 0, 1, SIZE);
}

function ring(g, radius, color, width) {
  g.beginPath();
  g.arc(HALF, HALF, radius, 0, TAU);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
}

function diamonds(g, radius, count, size, color) {
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    g.save();
    g.translate(HALF, HALF);
    g.rotate(TAU * i / count);
    g.translate(0, -radius);
    g.beginPath();
    g.moveTo(0, -size);
    g.lineTo(size * 0.68, 0);
    g.lineTo(0, size);
    g.lineTo(-size * 0.68, 0);
    g.closePath();
    g.fill();
    g.restore();
  }
}

function roundSurface(scene, radius, y, material) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  scene.add(mesh);
  return mesh;
}

export function buildTableArt(scene, height, radius) {
  scene.background.set(0x25151c);
  scene.fog.color.copy(scene.background);
  scene.add(new THREE.HemisphereLight(0xffe7c9, 0x756a9c, 1.7));
  const key = new THREE.DirectionalLight(0xffead1, 1.6);
  key.position.set(-3, 8, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb7cfff, 0.6);
  fill.position.set(3, 3, -5);
  scene.add(fill);

  const walnut = new THREE.MeshStandardMaterial({ color: 0x683723, roughness: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc99251, roughness: 0.43, metalness: 0.13 });
  buildLounge(scene, texture, walnut, brass);

  const shadowMap = texture(g => {
    const shade = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    shade.addColorStop(0, 'rgba(14, 8, 15, .78)');
    shade.addColorStop(0.61, 'rgba(14, 8, 15, .55)');
    shade.addColorStop(1, 'rgba(14, 8, 15, 0)');
    g.fillStyle = shade;
    g.fillRect(0, 0, 128, 128);
  }, 128, 128, 1);
  roundSurface(scene, 4.35, 0.018, new THREE.MeshBasicMaterial({
    map: shadowMap, transparent: true, depthWrite: false,
  }));

  const feltMap = texture(g => {
    fillSurface(g, 216, 184, '#1c7659', '#08352d');
    weave(g);
    ring(g, 242, '#c1a472', 2);
    ring(g, 233, '#7d9778', 1);
    diamonds(g, 232, 12, 3.5, '#bb9f6c');
    ring(g, 114, 'rgba(221, 206, 159, .37)', 1.8);
    ring(g, 108, 'rgba(221, 206, 159, .16)', 1);
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.14, radius + 0.04, 0.23, 80), walnut);
  body.position.y = height - 0.123; // Mép gỗ nằm dưới mặt nỉ để hai bề mặt không nhấp nháy.
  scene.add(body);
  roundSurface(scene, radius, height, new THREE.MeshBasicMaterial({ map: feltMap }));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.07, 0.17, 12, 96), walnut);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = height - 0.045;
  scene.add(rim);
  const inlay = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.005, 0.023, 8, 96), brass);
  inlay.rotation.x = Math.PI / 2;
  inlay.position.y = height + 0.108;
  scene.add(inlay);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.92, height - 0.21, 32), walnut);
  leg.position.y = (height - 0.21) / 2;
  scene.add(leg);

  const lamp = new THREE.Group();
  lamp.position.y = 5.65;
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.05, 0.53, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x74293d, roughness: 0.52, side: THREE.DoubleSide }));
  lamp.add(shade);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.032, 8, 40), brass);
  edge.rotation.x = Math.PI / 2;
  edge.position.y = -0.265;
  lamp.add(edge);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffe2ac }));
  bulb.position.y = -0.2;
  lamp.add(bulb);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 4, 8), walnut);
  cord.position.y = 2.2;
  lamp.add(cord);
  scene.add(lamp);
  return lamp;
}
