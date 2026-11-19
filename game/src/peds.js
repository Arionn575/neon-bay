// Pedestrians: they stroll the sidewalks, cross at corners, and run from gunshots and
// speeding cars. A fleeing ped is what a stolen traffic car's driver becomes.
import * as THREE from 'three';
import { clamp, dist, makeRng, pick } from './util.js';
import { collideCircle, ROAD_C } from './city.js';

const rng = makeRng(4242);
const SHIRTS = [0xe8e8e8, 0xf2c230, 0xd0508a, 0x4fae4f, 0x3f7ad0, 0xe87a2e, 0x9a6fd0];
const PANTS = [0x2b3242, 0x5a4a3a, 0x3a5a4a, 0x444444];

function makePedMesh(shirt, pants) {
  const g = new THREE.Group();
  const s = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const p = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.28), s); torso.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.28), skin); head.position.y = 1.6;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.2), p); legL.position.set(-0.12, 0.36, 0);
  const legR = legL.clone(); legR.position.x = 0.12;
  for (const m of [torso, head, legL, legR]) { m.castShadow = true; g.add(m); }
  return { group: g, legL, legR };
}

export function createPeds(scene) {
  const peds = [];

  function spawn(x, z, fleeing) {
    const { group, legL, legR } = makePedMesh(pick(rng, SHIRTS), pick(rng, PANTS));
    group.position.set(x, 0, z);
    scene.add(group);
    const p = {
      group, pos: group.position, legL, legR,
      heading: rng() * Math.PI * 2, speed: fleeing ? 6.5 : 1.2 + rng() * 0.8,
      state: fleeing ? 'flee' : 'walk', phase: rng() * 6, target: null, panicT: fleeing ? 4 : 0,
    };
    peds.push(p);
    return p;
  }

  function spawnInitial(n) {
    for (let i = 0; i < n; i++) {
      // On a sidewalk: just off a road centre line, near a block edge.
      const road = pick(rng, ROAD_C);
      const along = -170 + rng() * 340;
      const axis = rng() < 0.5 ? 'x' : 'z';
      const off = pick(rng, [-7.2, 7.2]);
      spawn(axis === 'x' ? along : road + off, axis === 'x' ? road + off : along, false);
    }
  }

  function scare(x, z, radius) {
    for (const p of peds) {
      if (p.state !== 'flee' && dist(p.pos.x, p.pos.z, x, z) < radius) {
        p.state = 'flee';
        p.panicT = 4;
        p.speed = 6.5;
        p.heading = Math.atan2(p.pos.x - x, p.pos.z - z);
      }
    }
  }

  function update(dt, playerPos, playerCar) {
    for (const p of peds) {
      if (p.state === 'down') continue; // knocked down: stays where they fell
      if (p.state === 'flee') {
        p.panicT -= dt;
        if (p.panicT <= 0) { p.state = 'walk'; p.speed = 1.4; }
      } else {
        // Stroll: pick a new direction at intersections, else keep walking.
        if (rng() < dt * 0.06) p.heading += (rng() - 0.5) * 1.6;
        // Flee from a fast car coming close.
        if (playerCar && Math.abs(playerCar.speed) > 6 && dist(p.pos.x, p.pos.z, playerCar.pos.x, playerCar.pos.z) < 10) {
          p.state = 'flee'; p.panicT = 3; p.speed = 6.5;
          p.heading = Math.atan2(p.pos.x - playerCar.pos.x, p.pos.z - playerCar.pos.z);
        }
      }
      p.pos.x += Math.sin(p.heading) * p.speed * dt;
      p.pos.z += Math.cos(p.heading) * p.speed * dt;
      p.pos.x = clamp(p.pos.x, -175, 225);
      p.pos.z = clamp(p.pos.z, -175, 175);
      collideCircle(p.pos, 0.45);
      p.phase += p.speed * dt * 2.2;
      p.legL.rotation.x = Math.sin(p.phase) * 0.55;
      p.legR.rotation.x = -Math.sin(p.phase) * 0.55;
      p.group.rotation.y = p.heading;
    }
  }

  return {
    peds,
    spawnInitial,
    spawnFlee(x, z) { return spawn(x, z, true); },
    down(p) {
      if (p.state === 'down') return;
      p.state = 'down';
      p.group.rotation.x = Math.PI / 2;
      p.group.position.y = 0.4;
    },
    scare,
    update,
    nearest(x, z, r) {
      let best = null, bd = r;
      for (const p of peds) {
        const d = dist(x, z, p.pos.x, p.pos.z);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    },
    reset() {
      for (const p of peds) scene.remove(p.group);
      peds.length = 0;
      spawnInitial(16);
    },
  };
}
