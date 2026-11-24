import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const ROOM_WIDTH = 17.8, ROOM_DEPTH = 17.2, WALL_HEIGHT = 4.9;

function makeParquet(g) {
  const woods = ['#3f271c', '#4a2e20', '#503024', '#45291e'];
  const edge = 32 / Math.SQRT2, plank = edge * 4;
  g.fillStyle = '#241712';
  g.fillRect(0, 0, 512, 512);
  g.rotate(Math.PI / 4);
  for (let row = -2; row < 6; row++) {
    for (let col = -3; col < 20; col++) {
      const x = row * plank + col * edge, y = row * plank - col * edge;
      const tint = ((row * 3 + col) % woods.length + woods.length) % woods.length;
      g.fillStyle = woods[tint];
      g.fillRect(x + 0.5, y + 0.5, plank - 1, edge - 1);
      g.fillStyle = woods[(tint + 2) % woods.length];
      g.fillRect(x + plank + 0.5, y + 0.5, edge - 1, plank - 1);
      g.fillStyle = 'rgba(222, 151, 89, .09)';
      g.fillRect(x + 1, y + 3, plank - 2, 1);
      g.fillRect(x + plank + 3, y + 1, 1, plank - 2);
    }
  }
}

function makeRug(g) {
  g.beginPath();
  g.roundRect(4, 4, 504, 504, 22);
  g.clip();
  const color = g.createLinearGradient(0, 0, 460, 512);
  color.addColorStop(0, '#5c2931');
  color.addColorStop(1, '#401f29');
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 512);
  // Họa tiết xương cá nhỏ và chỉ viền màu vải ở các cạnh tấm thảm.
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(225, 154, 129, .12)';
  g.beginPath();
  for (let row = -1; row < 88; row++) {
    for (let col = -1; col < 34; col++) {
      const x = col * 16, y = row * 6;
      g.moveTo(x, y);
      g.lineTo(x + 8, y + 4);
      g.lineTo(x + 16, y);
    }
  }
  g.stroke();
  g.beginPath();
  g.roundRect(10, 10, 492, 492, 18);
  g.strokeStyle = '#805043';
  g.lineWidth = 3;
  g.stroke();
}

function makeWall(g, back) {
  const upper = g.createLinearGradient(0, 0, 0, 370);
  upper.addColorStop(0, '#38201e');
  upper.addColorStop(0.46, '#673027');
  upper.addColorStop(1, '#42221e');
  g.fillStyle = upper;
  g.fillRect(0, 0, 1024, 512);
  const panels = back ? [0, 135, 310, 714, 889, 1024] : [0, 171, 342, 513, 684, 855, 1024];
  g.strokeStyle = '#825634';
  g.lineWidth = 2;
  for (let i = 0; i < panels.length - 1; i++) {
    const x = panels[i], width = panels[i + 1] - x;
    g.strokeRect(x + 9, 31, width - 18, 298);
    g.strokeRect(x + 15, 38, width - 30, 284);
    g.fillStyle = '#392016';
    g.fillRect(x, 0, 5, 340);
  }
  const wood = g.createLinearGradient(0, 341, 0, 512);
  wood.addColorStop(0, '#5c3623');
  wood.addColorStop(1, '#2b1917');
  g.fillStyle = wood;
  g.fillRect(0, 339, 1024, 173);
  g.strokeStyle = '#795136';
  for (let i = 0; i < 12; i++) g.strokeRect(i * 86 + 6, 359, 74, 132);
  g.fillStyle = '#9b7144';
  g.fillRect(0, 339, 1024, 3);
  g.fillStyle = '#4f2f21';
  g.fillRect(0, 497, 1024, 15);

  if (back) {
    // Nan đồng hình nan quạt Art Deco trên mảng tường sau ghế băng.
    g.lineWidth = 2.5;
    g.strokeStyle = '#a77643';
    for (let i = 0; i < 9; i++) {
      const x = 360 + i * 38, rise = 66 + Math.abs(4 - i) * 32;
      g.beginPath();
      g.moveTo(512, 303);
      g.lineTo(x, 193);
      g.lineTo(x, rise);
      g.stroke();
    }
  }
  for (const x of back ? [207, 817] : [180, 512, 844]) {
    const glow = g.createRadialGradient(x, 147, 6, x, 147, 133);
    glow.addColorStop(0, 'rgba(255, 165, 84, .45)');
    glow.addColorStop(1, 'rgba(255, 165, 84, 0)');
    g.fillStyle = glow;
    g.fillRect(x - 133, 14, 266, 266);
  }
}

function addInstances(scene, geometry, material, transforms) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  const pose = new THREE.Object3D();
  transforms.forEach(([x, y, z, w, h, d, yaw = 0, tilt = 0], i) => {
    pose.position.set(x, y, z);
    pose.rotation.set(0, yaw, tilt);
    pose.scale.set(w, h, d);
    pose.updateMatrix();
    mesh.setMatrixAt(i, pose.matrix);
  });
  scene.add(mesh);
}

export function buildLounge(scene, texture, walnut, brass) {
  const parquet = texture(makeParquet);
  parquet.wrapS = parquet.wrapT = THREE.RepeatWrapping;
  parquet.repeat.set(4, 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshBasicMaterial({ map: parquet }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 11.1), new THREE.MeshBasicMaterial({
    map: texture(makeRug), alphaTest: 0.46, alphaToCoverage: true,
  }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.014;
  scene.add(rug);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, WALL_HEIGHT),
    new THREE.MeshBasicMaterial({ map: texture(g => makeWall(g, true), 1024, 512) }));
  back.position.set(0, WALL_HEIGHT * 0.5, -ROOM_DEPTH * 0.5);
  scene.add(back);
  const sideGeo = new THREE.PlaneGeometry(ROOM_DEPTH, WALL_HEIGHT);
  const sideMat = new THREE.MeshBasicMaterial({ map: texture(g => makeWall(g, false), 1024, 512) });
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(sideGeo, sideMat);
    wall.rotation.y = -side * Math.PI * 0.5;
    wall.position.set(side * ROOM_WIDTH * 0.5, WALL_HEIGHT * 0.5, 0);
    scene.add(wall);
  }

  const padded = new RoundedBoxGeometry(1, 1, 1, 2, 0.14);
  const stool = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
  const leather = new THREE.MeshStandardMaterial({ color: 0x742b30, roughness: 0.72 });
  const velvet = new THREE.MeshStandardMaterial({ color: 0x43442e, roughness: 0.84 });
  const linen = new THREE.MeshStandardMaterial({ color: 0xbe895d, roughness: 0.93 });
  const cushions = [], frames = [], armchairs = [], pillows = [];
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.82, z = -7.26 + i * i * 0.048, yaw = -i * 0.085;
    cushions.push([x, 0.54, z + 0.19, 0.88, 0.32, 0.96, yaw], [x, 1.04, z - 0.29, 0.82, 0.98, 0.33, yaw]);
    frames.push([x, 0.28, z + 0.17, 0.87, 0.27, 0.91, yaw]);
  }
  for (const side of [-1, 1]) {
    const x = side * 2.95;
    cushions.push([x, 0.72, -6.6, 0.31, 0.58, 1.05, -side * 0.23]);
    pillows.push([side * 1.79, 0.87, -6.97, 0.51, 0.49, 0.2, -side * 0.14, side * 0.23]);
    const chair = side * 5.45, yaw = -side * 0.24;
    frames.push([chair, 0.23, -6.62, 1.22, 0.22, 1.21, yaw]);
    armchairs.push([chair, 0.53, -6.58, 1.23, 0.42, 1.14, yaw], [chair, 1.02, -7.11, 1.21, 1.04, 0.31, yaw]);
    for (const arm of [-1, 1]) armchairs.push([chair + arm * 0.56, 0.74, -6.61, 0.25, 0.43, 1.12, yaw]);
    pillows.push([chair + side * 0.18, 0.84, -6.88, 0.45, 0.47, 0.18, yaw, side * 0.31]);
  }
  addInstances(scene, padded, leather, cushions);
  addInstances(scene, padded, walnut, frames);
  addInstances(scene, padded, velvet, armchairs);
  addInstances(scene, padded, linen, pillows);

  const endTables = [-6.57, 6.57].flatMap(x => [[x, 0.78, -6.05, 0.86, 0.11, 0.86], [x, 0.07, -6.05, 0.63, 0.11, 0.63]]);
  addInstances(scene, stool, walnut, endTables);
  addInstances(scene, stool, brass, [-6.57, 6.57].flatMap(x => [
    [x, 0.41, -6.05, 0.12, 0.66, 0.12], [x, 0.98, -6.05, 0.23, 0.31, 0.23],
  ]));
  const bloom = new THREE.MeshBasicMaterial({ color: 0xe6b38b });
  addInstances(scene, new THREE.SphereGeometry(0.5, 10, 8), bloom, [-6.57, 6.57].flatMap(x => [
    [x - 0.11, 1.17, -6.04, 0.23, 0.22, 0.22], [x + 0.11, 1.19, -6.05, 0.24, 0.24, 0.22], [x, 1.28, -6.08, 0.19, 0.2, 0.2],
  ]));

  const wallZ = -ROOM_DEPTH * 0.5;
  const lightFeet = [-5.32, 5.32].flatMap(x => [[x, 3.39, wallZ + 0.11, 0.34, 0.19, 0.28], [x, 2.8, wallZ + 0.11, 0.34, 0.15, 0.28]]);
  addInstances(scene, padded, brass, lightFeet);
  addInstances(scene, padded, new THREE.MeshBasicMaterial({ color: 0xffcb83 }), [-5.32, 5.32].map(x => [
    x, 3.09, wallZ + 0.16, 0.25, 0.52, 0.22,
  ]));
}
