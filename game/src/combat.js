// Combat: Vic's pistol (hitscan, F or click), Salazar's warehouse guards, and the
// shooting back that foot cops and guards do. Ray-sphere tests, tracers, muzzle flash.
import * as THREE from 'three';
import { dist, makeRng } from './util.js';
import { blocks } from './city.js';

const rng = makeRng(99);
const RANGE = 70;

function pointInBlock(x, z) {
  for (const b of blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return true;
  return false;
}
function hasLineOfSight(ax, az, bx, bz) {
  const d = dist(ax, az, bx, bz);
  const steps = Math.ceil(d / 4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointInBlock(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

function makeGuardMesh() {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: 0x8a1f1f, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.68, 0.32), shirt); torso.position.y = 1.14;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.3), skin); head.position.y = 1.68;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.76, 0.22), pants); legL.position.set(-0.13, 0.38, 0);
  const legR = legL.clone(); legR.position.x = 0.13;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  gun.position.set(0.3, 1.2, 0.3);
  for (const m of [torso, head, legL, legR, gun]) { m.castShadow = true; g.add(m); }
  return g;
}

export function createCombat(scene, deps) {
  const { onDamage, onCrime, onGuardDown, onPedDown } = deps;
  const guards = [];
  const tracers = [];
  const flash = new THREE.PointLight(0xffcc66, 0, 14);
  scene.add(flash);

  function addTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    tracers.push({ line, life: 0.09 });
    if (tracers.length > 6) { const t = tracers.shift(); scene.remove(t.line); t.line.geometry.dispose(); }
  }

  function raySphere(origin, dir, cx, cy, cz, r) {
    const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
    const t = ox * dir.x + oy * dir.y + oz * dir.z;
    if (t < 0) return -1;
    const d2 = ox * ox + oy * oy + oz * oz - t * t;
    if (d2 > r * r) return -1;
    return t - Math.sqrt(r * r - d2);
  }

  function spawnGuard(x, z) {
    const g = makeGuardMesh();
    g.position.set(x, 0, z);
    scene.add(g);
    const guard = { group: g, pos: g.position, hp: 2, down: false, shootT: 0.8 + rng() * 0.8, phase: rng() * 6 };
    guards.push(guard);
    return guard;
  }

  const c = {
    guards,
    spawnGuards(n, pos) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        spawnGuard(pos.x + Math.cos(a) * 6, pos.z + Math.sin(a) * 6);
      }
    },
    clearGuards() {
      for (const g of guards) scene.remove(g.group);
      guards.length = 0;
    },
    // Player fires from the camera. targets: {cops, policeCars, peds} from the world.
    shoot(origin, dir, targets) {
      let bestT = RANGE, best = null;
      const test = (t, cx, cy, cz, r, kind, ref) => {
        // A miss returns -1: it must never win over a real hit inside the range.
        if (t >= 0 && t < bestT) { bestT = t; best = { kind, ref, cx, cy, cz }; }
      };
      for (const g of guards) {
        if (g.down) continue;
        test(raySphere(origin, dir, g.pos.x, 1.2, g.pos.z, 1.1), g.pos.x, 1.2, g.pos.z, 1.1, 'guard', g);
      }
      for (const k of targets.cops || []) {
        if (k.down) continue;
        test(raySphere(origin, dir, k.pos.x, 1.2, k.pos.z, 1.1), k.pos.x, 1.2, k.pos.z, 1.1, 'cop', k);
      }
      for (const car of targets.policeCars || []) {
        test(raySphere(origin, dir, car.pos.x, 1.0, car.pos.z, 2.4), car.pos.x, 1.0, car.pos.z, 2.4, 'policeCar', car);
      }
      for (const p of (targets.peds || []).peds || []) {
        test(raySphere(origin, dir, p.pos.x, 1.1, p.pos.z, 0.95), p.pos.x, 1.1, p.pos.z, 0.95, 'ped', p);
      }
      const end = new THREE.Vector3(origin.x + dir.x * bestT, origin.y + dir.y * bestT, origin.z + dir.z * bestT);
      const muzzle = new THREE.Vector3(origin.x + dir.x * 1.2, origin.y + dir.y * 1.2 - 0.15, origin.z + dir.z * 1.2);
      addTracer(muzzle, end);
      flash.position.copy(muzzle);
      flash.intensity = 4;
      if (best) {
        if (best.kind === 'guard') {
          best.ref.hp -= 1;
          if (best.ref.hp <= 0 && !best.ref.down) {
            best.ref.down = true;
            best.ref.group.rotation.x = Math.PI / 2;
            best.ref.group.position.y = 0.4;
            onGuardDown();
          }
        } else if (best.kind === 'cop') {
          targets.onShootCop(best.ref);
        } else if (best.kind === 'policeCar') {
          targets.onShootPoliceCar(best.ref);
        } else if (best.kind === 'ped') {
          onPedDown(best.ref);
          onCrime(3, 'Shot a pedestrian');
        }
        return { hit: true, kind: best.kind };
      }
      return { hit: false };
    },
    update(dt, playerPos, playerInCar, cops) {
      flash.intensity = Math.max(0, flash.intensity - dt * 40);
      for (const t of tracers) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
        if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); tracers.splice(tracers.indexOf(t), 1); }
      }
      // Guards shoot back when the player is close and visible.
      for (const g of guards) {
        if (g.down) continue;
        const d = dist(g.pos.x, g.pos.z, playerPos.x, playerPos.z);
        g.shootT -= dt;
        if (d < 42 && g.shootT <= 0) {
          g.shootT = 1.1 + rng() * 0.6;
          const from = new THREE.Vector3(g.pos.x, 1.3, g.pos.z);
          const to = new THREE.Vector3(playerPos.x, playerInCar ? 1.0 : 1.2, playerPos.z);
          addTracer(from, to);
          if (hasLineOfSight(g.pos.x, g.pos.z, playerPos.x, playerPos.z) && rng() < 0.5) {
            onDamage(8 + rng() * 6, 'guard');
          }
        }
        g.group.rotation.y = Math.atan2(playerPos.x - g.pos.x, playerPos.z - g.pos.z);
      }
      // Foot cops shoot too.
      for (const k of cops || []) {
        if (k.down) continue;
        const d = dist(k.pos.x, k.pos.z, playerPos.x, playerPos.z);
        k.shootT = (k.shootT ?? 1) - dt;
        if (d < 26 && k.shootT <= 0) {
          k.shootT = 1.5 + rng() * 0.5;
          const from = new THREE.Vector3(k.pos.x, 1.3, k.pos.z);
          const to = new THREE.Vector3(playerPos.x, playerInCar ? 1.0 : 1.2, playerPos.z);
          addTracer(from, to);
          if (hasLineOfSight(k.pos.x, k.pos.z, playerPos.x, playerPos.z) && rng() < 0.4) {
            onDamage(6 + rng() * 5, 'cop');
          }
        }
      }
    },
  };
  return c;
}
