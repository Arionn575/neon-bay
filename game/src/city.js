// Neon Bay itself: a sun-soaked coastal city on a road grid, built procedurally from a
// seeded layout so it is the same every run. Exports the layout constants, the collision
// blocks, the landmarks missions use, and the ground canvas the minimap reuses.
import * as THREE from 'three';
import { makeRng, pick } from './util.js';

export const ROAD_C = [-145, -87, -29, 29, 87, 145]; // road centre lines, x and z
export const ROAD_W = 12;
export const EDGE = 180;          // city edge (blocks end here)
export const BEACH_X = 235;       // sand ends, water begins
export const WORLD = 260;         // ground plane half-size
const rng = makeRng(20261119);

// Block rectangles between the roads (plus the two outer strips at each edge).
export const blocks = [];
for (let i = 0; i <= ROAD_C.length; i++) {
  const a = i === 0 ? -EDGE : ROAD_C[i - 1] + ROAD_W / 2;
  const b = i === ROAD_C.length ? EDGE : ROAD_C[i] - ROAD_W / 2;
  for (let j = 0; j <= ROAD_C.length; j++) {
    const c = j === 0 ? -EDGE : ROAD_C[j - 1] + ROAD_W / 2;
    const d = j === ROAD_C.length ? EDGE : ROAD_C[j] - ROAD_W / 2;
    blocks.push({ x0: a, z0: c, x1: b, z1: d, bi: i, bj: j });
  }
}

// Push a circle (x, z, radius) out of every block it overlaps. Returns true if it hit.
export function collideCircle(p, r) {
  let hit = false;
  for (const b of blocks) {
    const cx = Math.max(b.x0, Math.min(p.x, b.x1));
    const cz = Math.max(b.z0, Math.min(p.z, b.z1));
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    // The epsilon keeps a circle pushed to exactly the boundary from
    // re-colliding on floating-point noise, which used to pin cars at ~0 speed.
    if (d2 < r * r - 1e-6) {
      hit = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      } else {
        // Centre inside the block: push out along the shortest side.
        const l = p.x - b.x0, rr = b.x1 - p.x, t = p.z - b.z0, bo = b.z1 - p.z;
        const m = Math.min(l, rr, t, bo);
        if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r;
        else if (m === t) p.z = b.z0 - r; else p.z = b.z1 + r;
      }
    }
  }
  return hit;
}

// A point on a road centre line, on the right-hand side for its direction of travel.
export function roadPoint(axis, line, along, side) {
  const off = 2.6 * (side || 1);
  return axis === 'x' ? { x: along, z: line + off } : { x: line + off, z: along };
}

function facadeTexture(base, lit) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,190,120,0.25)'); grad.addColorStop(1, 'rgba(0,0,40,0.35)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 256);
  for (let y = 14; y < 240; y += 22) {
    for (let x = 10; x < 118; x += 20) {
      g.fillStyle = rng() < lit ? '#ffd98a' : '#1d2733';
      g.fillRect(x, y, 12, 14);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
  g.fillStyle = fg; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function groundCanvas() {
  const S = 1024, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const toPx = (v) => ((v + WORLD) / (WORLD * 2)) * S;
  g.fillStyle = '#6e6a63'; g.fillRect(0, 0, S, S); // sidewalks
  g.fillStyle = '#e8c98f'; g.fillRect(toPx(EDGE), 0, toPx(BEACH_X) - toPx(EDGE), S); // beach sand
  g.fillStyle = '#3b3e45';
  for (const r of ROAD_C) { // roads
    g.fillRect(toPx(r - ROAD_W / 2), 0, toPx(ROAD_W), S);
    g.fillRect(0, toPx(r - ROAD_W / 2), S, toPx(ROAD_W));
  }
  g.strokeStyle = '#d8c25a'; g.lineWidth = 2; g.setLineDash([14, 12]);
  for (const r of ROAD_C) {
    g.beginPath(); g.moveTo(toPx(r), 0); g.lineTo(toPx(r), S); g.stroke();
    g.beginPath(); g.moveTo(0, toPx(r)); g.lineTo(S, toPx(r)); g.stroke();
  }
  g.setLineDash([]);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (const rx of ROAD_C) for (const rz of ROAD_C) { // crosswalks
    for (let k = -2; k <= 2; k++) {
      g.fillRect(toPx(rx + k * 2.2) - 3, toPx(rz - ROAD_W / 2) + 2, 6, 5);
      g.fillRect(toPx(rx + k * 2.2) - 3, toPx(rz + ROAD_W / 2) - 7, 6, 5);
    }
  }
  return c;
}

export const landmarks = {
  spawn: { x: -29, z: 120, heading: Math.PI },          // south road, facing north into town
  diner: { x: -87, z: 87, name: "Rosa's Palms Diner" },
  motel: { x: 145, z: -29, name: 'Sunset Motel' },
  marina: { x: 205, z: 145, name: 'Marina Docks' },
  safehouse: { x: -145, z: -145, name: 'Safehouse' },
  warehouse: { x: 160, z: 150, name: "Salazar's Warehouse" },
  hospital: { x: 29, z: -87, name: 'Bay General Hospital' },
  police: { x: -29, z: -29, name: 'NBPD Central' },
};

export function buildCity(scene) {
  // Sunset sky, warm sun low in the west, long shadows.
  scene.background = new THREE.Color(0xffb36b);
  scene.fog = new THREE.Fog(0xff9e66, 260, 620);
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.9);
  sun.position.set(-220, 130, -80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 700;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fb8e8, 0x8a6a4a, 1.5));
  // Big low sun disc on the horizon.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(26, 32),
    new THREE.MeshBasicMaterial({ color: 0xffdf8a, fog: false }),
  );
  sunDisc.position.set(-480, 60, -60);
  sunDisc.lookAt(0, 40, 0);
  scene.add(sunDisc);

  // Ground: roads, sidewalks, beach, from one painted canvas.
  const gc = groundCanvas();
  const gtex = new THREE.CanvasTexture(gc);
  gtex.colorSpace = THREE.SRGBColorSpace;
  gtex.anisotropy = 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD * 2, WORLD * 2),
    new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Water east of the beach.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(340, WORLD * 2 + 80),
    new THREE.MeshStandardMaterial({ color: 0x1f7fa8, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(BEACH_X + 170, 0.15, 0);
  scene.add(water);

  // Buildings, one mesh per building, shared facade materials.
  const facades = [
    facadeTexture('#8fa0b5', 0.35),
    facadeTexture('#b08d6e', 0.3),
    facadeTexture('#6f8a9e', 0.4),
  ];
  const sideMats = facades.map((t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95 });
  const parkBlocks = new Set(['1,1', '4,3', '2,5', '5,1']);
  const special = { '3,3': 'diner', '4,2': 'motel', '1,4': 'hospital', '3,2': 'police' };
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const b of blocks) {
    const key = `${b.bi},${b.bj}`;
    if (parkBlocks.has(key)) {
      // A pocket park: grass square, a few palms.
      const park = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x4d7a3a, roughness: 1 }));
      park.scale.set(b.x1 - b.x0 - 2, 0.4, b.z1 - b.z0 - 2);
      park.position.set((b.x0 + b.x1) / 2, 0.2, (b.z0 + b.z1) / 2);
      park.receiveShadow = true;
      scene.add(park);
      continue;
    }
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const n = w > 40 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const bw = (w - 8) / n, bd = d - 8;
      const cx = b.x0 + 4 + bw / 2 + k * (bw + 2);
      const cz = (b.z0 + b.z1) / 2;
      const centreDist = Math.hypot(cx, cz);
      const h = special[key] ? 9 : 8 + rng() * (centreDist < 90 ? 42 : 20);
      const m = new THREE.Mesh(boxGeo, [sideMats[Math.floor(rng() * 3)], sideMats[Math.floor(rng() * 3)], roofMat, roofMat, sideMats[Math.floor(rng() * 3)], sideMats[Math.floor(rng() * 3)]]);
      m.scale.set(bw, h, bd);
      m.position.set(cx, h / 2, cz);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
    }
    if (special[key]) {
      const names = { diner: "PALMS DINER", motel: 'SUNSET MOTEL', hospital: 'BAY GENERAL', police: 'NBPD' };
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(22, 5.5),
        new THREE.MeshBasicMaterial({ map: signTexture(names[special[key]], '#20242e', '#ffd23e') }),
      );
      sign.position.set((b.x0 + b.x1) / 2, 9.5, b.z0 - 0.3);
      scene.add(sign);
    }
  }

  // Distant skyline silhouettes.
  const skyMat = new THREE.MeshStandardMaterial({ color: 0x6a5a7a, roughness: 1 });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 380 + rng() * 120;
    const h = 40 + rng() * 90;
    const s = new THREE.Mesh(boxGeo, skyMat);
    s.scale.set(24 + rng() * 30, h, 24 + rng() * 30);
    s.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    scene.add(s);
  }

  // Palms along the beach and a few on sidewalks; lamps along the roads.
  // Both are InstancedMesh so the whole city stays near 150 draw calls.
  const palmSpots = [];
  for (let z = -240; z <= 240; z += 24) palmSpots.push([196 + rng() * 14, z]);
  for (let i = 0; i < 14; i++) palmSpots.push([-160 + rng() * 320, pick(rng, [-151, 151])]);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f8f4e, roughness: 1 });
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.4, 7, 6), trunkMat, palmSpots.length);
  const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 3.4, 5), leafMat, palmSpots.length * 5);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1);
    palmSpots.forEach(([x, z], i) => {
      e.set(0, 0, 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, 3.5, z), q, s);
      trunks.setMatrixAt(i, m);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        e.set(0, a, 1.1); q.setFromEuler(e);
        m.compose(new THREE.Vector3(x + Math.cos(a) * 1.1, 7.4, z + Math.sin(a) * 1.1), q, s);
        leaves.setMatrixAt(i * 5 + k, m);
      }
    });
  }
  trunks.castShadow = true;
  scene.add(trunks, leaves);

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.7 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc861, emissiveIntensity: 1.4 });
  const lampSpots = [];
  for (const rx of ROAD_C) for (const rz of ROAD_C) lampSpots.push([rx + 7, rz + 7]);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 6, 6), poleMat, lampSpots.length);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 8, 6), lampMat, lampSpots.length);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    lampSpots.forEach(([x, z], i) => {
      m.compose(new THREE.Vector3(x, 3, z), q, s); poles.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 6.1, z), q, s); bulbs.setMatrixAt(i, m);
    });
  }
  scene.add(poles, bulbs);

  // Wooden marina pier reaching into the water.
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1 });
  const pier = new THREE.Mesh(boxGeo, pierMat);
  pier.scale.set(60, 0.6, 8);
  pier.position.set(BEACH_X + 28, 0.5, 145);
  pier.castShadow = true;
  scene.add(pier);

  return { groundCanvas: gc };
}
