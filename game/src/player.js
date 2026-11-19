// Vic Marlowe on foot: a low-poly walker with a third-person camera. WASD moves relative
// to the camera, Shift runs, Space jumps. Buildings stop him; the beach and water do not
// (he can wade onto the sand, but not swim out past the shore).
import * as THREE from 'three';
import { clamp, damp, angleDiff, dist } from './util.js';
import { collideCircle, BEACH_X } from './city.js';

const WALK = 6, RUN = 10.5;

export function createPlayer(scene) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.8 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x2e8f86, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2b3242, roughness: 0.9 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1 });

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.24), pants);
  legL.position.set(-0.14, 0.4, 0);
  const legR = legL.clone(); legR.position.x = 0.14;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), jacket);
  torso.position.y = 1.16;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.2), jacket);
  armL.position.set(-0.4, 1.2, 0);
  const armR = armL.clone(); armR.position.x = 0.4;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin);
  head.position.y = 1.72;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36), hair);
  cap.position.y = 1.94;
  for (const m of [legL, legR, torso, armL, armR, head, cap]) { m.castShadow = true; group.add(m); }
  scene.add(group);

  const p = {
    group, pos: group.position, heading: 0, speed: 0, vy: 0, grounded: true,
    walkPhase: 0, alive: true,
    reset(x, z, heading) {
      p.pos.set(x, 0, z); p.heading = heading; p.speed = 0; p.vy = 0; p.alive = true;
      group.rotation.y = heading;
    },
    update(dt, input, camYaw) {
      // input: {f, b, l, r, run, jump} in camera space.
      const mx = (input.r ? 1 : 0) - (input.l ? 1 : 0);
      const mz = (input.f ? 1 : 0) - (input.b ? 1 : 0);
      const moving = mx !== 0 || mz !== 0;
      const target = input.run ? RUN : WALK;
      if (moving) {
        const want = Math.atan2(mx, mz) + camYaw;
        p.heading += angleDiff(p.heading, want) * Math.min(1, dt * 10);
        p.speed = damp(p.speed, target, 8, dt);
      } else {
        p.speed = damp(p.speed, 0, 10, dt);
      }
      const step = p.speed * dt;
      p.pos.x += Math.sin(p.heading) * step;
      p.pos.z += Math.cos(p.heading) * step;
      // Stay in the world: beach sand is walkable, deep water is not.
      p.pos.x = clamp(p.pos.x, -252, BEACH_X + 24);
      p.pos.z = clamp(p.pos.z, -252, 252);
      collideCircle(p.pos, 0.55);
      if (input.jump && p.grounded) { p.vy = 5.2; p.grounded = false; }
      if (!p.grounded) {
        p.vy -= 14 * dt;
        p.pos.y += p.vy * dt;
        if (p.pos.y <= 0) { p.pos.y = 0; p.vy = 0; p.grounded = true; }
      }
      // Walk cycle: legs and arms swing with speed.
      p.walkPhase += p.speed * dt * 1.6;
      const swing = Math.min(0.7, p.speed / RUN) * 0.55 * Math.sin(p.walkPhase);
      legL.rotation.x = swing; legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.8; armR.rotation.x = swing * 0.8;
      group.rotation.y = p.heading;
      group.position.y = p.pos.y;
    },
    distanceTo(x, z) { return dist(p.pos.x, p.pos.z, x, z); },
  };
  return p;
}
