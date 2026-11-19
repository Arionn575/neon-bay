// Cars: the mesh builder, arcade driving physics, traffic that follows the road grid,
// police that chase the player, foot cops, and stealing. A car faces +z when heading is 0.
import * as THREE from 'three';
import { clamp, damp, angleDiff, dist, makeRng, pick } from './util.js';
import { collideCircle, ROAD_C, BEACH_X, blocks } from './city.js';

function pointInBlock(x, z) {
  for (const b of blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return true;
  return false;
}
// The closest intersection (a road crossing) that is nearer to the target than the
// car is: hopping between intersections keeps a chasing car on the roads instead of
// wedged against a building.
function nextIntersection(x, z, tx, tz, d) {
  let best = null, bestD = Infinity;
  for (const ix of ROAD_C) for (const iz of ROAD_C) {
    const di = dist(ix, iz, x, z);
    if (di < 5 || di > 90) continue;
    const dp = dist(ix, iz, tx, tz);
    if (dp < d && dp < bestD) { bestD = dp; best = { x: ix, z: iz }; }
  }
  return best;
}

const CAR_COLORS = [0xd23c2e, 0xf2c230, 0x2e9e8f, 0xe8e8e8, 0x23262e, 0x7a4fd0, 0xe87a2e, 0x3f7ad0, 0xd0508a, 0x4fae4f];
const rng = makeRng(777);

export function buildCarMesh(color, kind) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x18222e, roughness: 0.15, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.62, 3.7), paint);
  body.position.y = 0.62; body.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.58, 1.9), glass);
  cabin.position.set(0, 1.18, -0.25); cabin.castShadow = true;
  g.add(body, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12);
  for (const [x, z] of [[-0.85, 1.2], [0.85, 1.2], [-0.85, -1.2], [0.85, -1.2]]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.36, z);
    g.add(w);
  }
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 0.9 });
  for (const x of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), headMat);
    h.position.set(x, 0.62, 1.86);
    g.add(h);
  }
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xaa1111, emissive: 0xcc2222, emissiveIntensity: 0.8 });
  for (const x of [-0.6, 0.6]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), tailMat);
    t.position.set(x, 0.62, -1.86);
    g.add(t);
  }
  let lightL = null, lightR = null;
  if (kind === 'police') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.4), dark);
    bar.position.set(0, 1.56, -0.25);
    g.add(bar);
    lightL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.42), new THREE.MeshStandardMaterial({ color: 0xcc0000, emissive: 0xff0000, emissiveIntensity: 2 }));
    lightL.position.set(-0.28, 1.56, -0.25);
    lightR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.42), new THREE.MeshStandardMaterial({ color: 0x0044ff, emissive: 0x2266ff, emissiveIntensity: 2 }));
    lightR.position.set(0.28, 1.56, -0.25);
    g.add(lightL, lightR);
  }
  return { group: g, lightL, lightR };
}

function makeCar(scene, x, z, heading, color, kind) {
  const { group, lightL, lightR } = buildCarMesh(color, kind);
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  return {
    group, pos: group.position, heading, speed: 0, kind,
    driver: kind === 'police' ? 'police' : 'traffic',
    hp: kind === 'police' ? 3 : 999, disabled: false, stuckT: 0, reverseT: 0, loseT: 0,
    axis: 'x', line: 0, along: 0, dir: 1, lightL, lightR, flashT: rng() * 2,
    // traffic state
    cruise: 8 + rng() * 5,
  };
}

export function createCars(scene, deps) {
  const { wanted, audio, onCrime, onThud, onDriverEjected } = deps;
  const cars = [];
  const cops = [];
  let clock = 0;

  function spawnParked() {
    for (let i = 0; i < 12; i++) {
      const road = pick(rng, ROAD_C);
      const along = -170 + rng() * 340;
      const axis = rng() < 0.5 ? 'x' : 'z';
      // Parked close enough to the centre line that the 1.7 m collision radius
      // never grazes the block edge (3.4 + 1.7 = 5.1 < 6, the road half-width):
      // a car parked on the edge could never accelerate away.
      const side = rng() < 0.5 ? 3.4 : -3.4;
      const x = axis === 'x' ? along : road + side;
      const z = axis === 'x' ? road + side : along;
      const heading = axis === 'x' ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
      const c = makeCar(scene, x, z, heading, pick(rng, CAR_COLORS), 'civil');
      c.driver = 'none';
      cars.push(c);
    }
  }

  function spawnTrafficCar() {
    const road = pick(rng, ROAD_C);
    const axis = rng() < 0.5 ? 'x' : 'z';
    const dir = rng() < 0.5 ? 1 : -1;
    const along = -170 + rng() * 340;
    const side = axis === 'x' ? (dir > 0 ? 2.6 : -2.6) : (dir > 0 ? -2.6 : 2.6);
    const x = axis === 'x' ? along : road + side;
    const z = axis === 'x' ? road + side : along;
    const c = makeCar(scene, x, z, axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI), pick(rng, CAR_COLORS), 'civil');
    c.axis = axis; c.line = road; c.along = along; c.dir = dir; c.speed = c.cruise;
    cars.push(c);
    return c;
  }

  function spawnTraffic(n) { for (let i = 0; i < n; i++) spawnTrafficCar(); }

  function spawnPolice(x, z) {
    const c = makeCar(scene, x, z, 0, 0xf2f2f2, 'police');
    c.speed = 0;
    cars.push(c);
    return c;
  }

  function makeCop(x, z) {
    const g = new THREE.Group();
    const uni = new THREE.MeshStandardMaterial({ color: 0x1d3a6e, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.32), uni); torso.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.3), skin); head.position.y = 1.7;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.22), uni); legL.position.set(-0.13, 0.39, 0);
    const legR = legL.clone(); legR.position.x = 0.13;
    for (const m of [torso, head, legL, legR]) { m.castShadow = true; g.add(m); }
    g.position.set(x, 0, z);
    scene.add(g);
    const cop = { group: g, pos: g.position, heading: 0, hp: 2, down: false, legL, legR, phase: rng() * 6 };
    cops.push(cop);
    return cop;
  }

  function policeCars() { return cars.filter((c) => c.kind === 'police' && !c.disabled); }

  function updateTraffic(dt, playerCar) {
    for (const c of cars) {
      if (c.kind !== 'civil' || c.driver !== 'traffic') continue;
      // Car ahead on the same road and direction? Slow down or stop.
      let ahead = null;
      for (const o of cars) {
        if (o === c) continue;
        if (o.axis !== c.axis || o.line !== c.line || Math.sign(o.dir) !== Math.sign(c.dir)) continue;
        const gap = (o.along - c.along) * c.dir;
        if (gap > 0 && gap < 10 && (!ahead || gap < ahead)) ahead = gap;
      }
      if (playerCar && playerCar.axis === undefined) { /* player car handled by distance below */ }
      // Also stop for the player's car if it is right in front on the road.
      if (playerCar) {
        const d = dist(c.pos.x, c.pos.z, playerCar.pos.x, playerCar.pos.z);
        if (d < 9) {
          const fwdX = Math.sin(c.heading), fwdZ = Math.cos(c.heading);
          const toX = playerCar.pos.x - c.pos.x, toZ = playerCar.pos.z - c.pos.z;
          if (fwdX * toX + fwdZ * toZ > 0) ahead = Math.min(ahead ?? 99, d);
        }
      }
      const want = ahead !== null && ahead < 9 ? 0 : c.cruise;
      c.speed = damp(c.speed, want, 3, dt);
      c.along += c.dir * c.speed * dt;
      // Wrap around the city edge.
      if (c.along > 175) c.along = -175;
      if (c.along < -175) c.along = 175;
      // At an intersection, sometimes turn onto the crossing road.
      for (const r of ROAD_C) {
        if (Math.abs(c.along - r) < 1.2 && rng() < 0.004) {
          const nAxis = c.axis === 'x' ? 'z' : 'x';
          const nDir = rng() < 0.5 ? 1 : -1;
          c.axis = nAxis; c.line = r; c.dir = nDir;
          c.along = nAxis === 'x' ? c.pos.x : c.pos.z;
          c.cruise = 8 + rng() * 5;
          break;
        }
      }
      const side = c.axis === 'x' ? (c.dir > 0 ? 2.6 : -2.6) : (c.dir > 0 ? -2.6 : 2.6);
      if (c.axis === 'x') { c.pos.x = c.along; c.pos.z = c.line + side; }
      else { c.pos.x = c.line + side; c.pos.z = c.along; }
      c.heading = c.axis === 'x' ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
      c.group.rotation.y = c.heading;
    }
  }

  function updatePolice(dt, player, playerCar) {
    const stars = wanted.stars;
    const target = playerCar || player;
    // Spawn / despawn police cars to match the wanted level.
    const wantCount = stars === 0 ? 0 : Math.min(1 + stars, 4);
    const alive = policeCars();
    if (alive.length < wantCount) {
      const a = rng() * Math.PI * 2;
      const d = 50 + rng() * 30;
      const x = clamp(target.pos.x + Math.cos(a) * d, -170, 170);
      const z = clamp(target.pos.z + Math.sin(a) * d, -170, 170);
      spawnPolice(x, z);
    }
    for (const c of [...cars]) {
      if (c.kind !== 'police') continue;
      if (c.disabled) {
        // Flashing lights keep going on a disabled cruiser.
        c.flashT += dt;
        if (c.lightL) { c.lightL.visible = Math.sin(c.flashT * 10) > 0; c.lightR.visible = !c.lightL.visible; }
        continue;
      }
      if (stars === 0) {
        // No heat: cruisers drive off and despawn.
        c.speed = damp(c.speed, 12, 2, dt);
        c.pos.x += Math.sin(c.heading) * c.speed * dt;
        c.pos.z += Math.cos(c.heading) * c.speed * dt;
        if (dist(c.pos.x, c.pos.z, target.pos.x, target.pos.z) > 260) {
          scene.remove(c.group);
          cars.splice(cars.indexOf(c), 1);
        }
        continue;
      }
      const dx = target.pos.x - c.pos.x, dz = target.pos.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      // A cruiser that has not been close to the player for 10 s gives up the chase
      // and searches slowly: that is how the player can ever lose the cops.
      if (d < 15) c.loseT = 0; else c.loseT += dt;
      const searching = c.loseT > 10;
      // Chase the player, but steer around blocks: if the road ahead is blocked,
      // hop to the nearest intersection that is closer to the player, then resume.
      let wantHeading = Math.atan2(dx, dz);
      const probeX = c.pos.x + Math.sin(c.heading) * 10;
      const probeZ = c.pos.z + Math.cos(c.heading) * 10;
      if (pointInBlock(probeX, probeZ)) {
        const ix = nextIntersection(c.pos.x, c.pos.z, target.pos.x, target.pos.z, d);
        if (ix) wantHeading = Math.atan2(ix.x - c.pos.x, ix.z - c.pos.z);
      }
      const prevX = c.pos.x, prevZ = c.pos.z;
      // A cruiser that has pulled up next to a player on foot stops and holds
      // them: that is what makes the bust timer fill instead of the car driving
      // straight through the player.
      if (!playerCar && d < 6) {
        c.speed = damp(c.speed, 0, 4, dt);
        c.heading += angleDiff(c.heading, wantHeading) * Math.min(1, dt * 2.4);
      } else if (c.reverseT > 0) {
        c.reverseT -= dt;
        c.speed = damp(c.speed, -9, 6, dt);
        c.heading += angleDiff(c.heading, wantHeading + Math.PI) * dt * 1.5;
      } else {
        c.speed = damp(c.speed, searching ? 14 : d > 60 ? 35 : 30, 2.5, dt);
        c.heading += angleDiff(c.heading, wantHeading) * Math.min(1, dt * 2.4);
      }
      c.pos.x += Math.sin(c.heading) * c.speed * dt;
      c.pos.z += Math.cos(c.heading) * c.speed * dt;
      c.pos.x = clamp(c.pos.x, -175, BEACH_X + 18);
      c.pos.z = clamp(c.pos.z, -175, 175);
      if (collideCircle(c.pos, 1.7)) {
        c.speed *= 0.4;
        c.stuckT += dt;
        if (c.stuckT > 1.6) { c.reverseT = 1.1; c.stuckT = 0; }
      } else c.stuckT = 0;
      const moved = dist(c.pos.x, c.pos.z, prevX, prevZ);
      if (c.speed > 4 && moved < 0.02) { c.stuckT += dt; if (c.stuckT > 1.6) { c.reverseT = 1.1; c.stuckT = 0; } }
      c.group.rotation.y = c.heading;
      c.flashT += dt;
      if (c.lightL) { c.lightL.visible = Math.sin(c.flashT * 10) > 0; c.lightR.visible = !c.lightL.visible; }
      // Ram the player on foot: touching busts them (handled by main via proximity).
      if (!playerCar && d < 2.6) {
        c.thudT = (c.thudT || 0) - dt;
        if (c.thudT <= 0) { onThud(); c.thudT = 0.5; }
      }
    }
    // Foot cops at 3+ stars.
    const wantCops = stars >= 3 ? Math.min(2, stars - 1) : 0;
    const aliveCops = cops.filter((k) => !k.down);
    if (aliveCops.length < wantCops) {
      const a = rng() * Math.PI * 2;
      makeCop(clamp(player.pos.x + Math.cos(a) * 30, -170, 170), clamp(player.pos.z + Math.sin(a) * 30, -170, 170));
    }
    for (const k of cops) {
      if (k.down) continue;
      const dx = player.pos.x - k.pos.x, dz = player.pos.z - k.pos.z;
      const d = Math.hypot(dx, dz);
      k.heading = Math.atan2(dx, dz);
      // Cops close to 4 m and hold there, shooting: they only bust a player who
      // walks right into them, so a shootout can actually end in Wasted.
      if (d > 4) {
        const sp = 7.6;
        k.pos.x += Math.sin(k.heading) * sp * dt;
        k.pos.z += Math.cos(k.heading) * sp * dt;
        collideCircle(k.pos, 0.5);
        k.phase += dt * 9;
      }
      k.legL.rotation.x = Math.sin(k.phase) * 0.6;
      k.legR.rotation.x = -Math.sin(k.phase) * 0.6;
      k.group.rotation.y = k.heading;
    }
  }

  function updatePlayerCar(dt, car, input) {
    const maxF = 30, maxR = 9;
    if (input.f) car.speed += 15 * dt;
    else if (input.b) {
      if (car.speed > 0.5) car.speed -= 24 * dt; // brake
      else car.speed -= 10 * dt; // reverse
    } else {
      car.speed = damp(car.speed, 0, 1.2, dt);
    }
    car.speed = clamp(car.speed, -maxR, maxF);
    const steer = (input.l ? 1 : 0) - (input.r ? 1 : 0);
    const sf = clamp(Math.abs(car.speed) / 9, 0, 1);
    const turn = input.handbrake ? 2.4 : 1.55;
    car.heading += steer * turn * sf * Math.sign(car.speed || 1) * dt;
    if (input.handbrake) car.speed = damp(car.speed, 0, 2.2, dt);
    car.pos.x += Math.sin(car.heading) * car.speed * dt;
    car.pos.z += Math.cos(car.heading) * car.speed * dt;
    car.pos.x = clamp(car.pos.x, -252, BEACH_X + 18);
    car.pos.z = clamp(car.pos.z, -252, 252);
    if (collideCircle(car.pos, 1.7)) {
      car.thudT = (car.thudT || 0) - dt;
      if (Math.abs(car.speed) > 6 && car.thudT <= 0) { onThud(); car.thudT = 0.6; }
      car.speed *= 0.45;
    }
    car.group.rotation.y = car.heading;
    car.group.position.y = 0;
    // Tilt the body a little into turns and acceleration.
    car.group.rotation.z = damp(car.group.rotation.z, -steer * 0.05 * sf, 6, dt);
    car.group.rotation.x = damp(car.group.rotation.x, clamp(-car.speed * 0.0012, -0.03, 0.02), 6, dt);
    audio.engine(clamp(Math.abs(car.speed) / maxF, 0, 1));
  }

  function collideCars(dt) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const d = dist(a.pos.x, a.pos.z, b.pos.x, b.pos.z);
        if (d < 3.4 && d > 0.01) {
          const nx = (a.pos.x - b.pos.x) / d, nz = (a.pos.z - b.pos.z) / d;
          const aPlayer = a.driver === 'player', bPlayer = b.driver === 'player';
          if (aPlayer || bPlayer) {
            // A ram never pins the player's car: the other car takes the whole
            // push and the speed cut, so the player can always drive away.
            const other = aPlayer ? b : a;
            const sgn = aPlayer ? -1 : 1;
            other.pos.x += sgn * nx * (3.4 - d);
            other.pos.z += sgn * nz * (3.4 - d);
            other.speed *= 0.7;
          } else {
            const push = (3.4 - d) / 2;
            a.pos.x += nx * push; a.pos.z += nz * push;
            b.pos.x -= nx * push; b.pos.z -= nz * push;
          }
        }
      }
    }
  }

  return {
    cars, cops,
    spawnInitial() { spawnParked(); spawnTraffic(11); },
    spawnPoliceAt(x, z) { return spawnPolice(x, z); },
    reset() {
      for (const c of cars) scene.remove(c.group);
      for (const k of cops) scene.remove(k.group);
      cars.length = 0; cops.length = 0;
      spawnParked(); spawnTraffic(11);
    },
    update(dt, player, playerCar) {
      clock += dt;
      updateTraffic(dt, playerCar);
      updatePolice(dt, player, playerCar);
      collideCars(dt);
    },
    updatePlayerCar,
    nearestStealable(x, z) {
      let best = null, bd = 4.2;
      for (const c of cars) {
        if (c.kind === 'police' || c.disabled || c.driver === 'player') continue;
        const d = dist(x, z, c.pos.x, c.pos.z);
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    },
    steal(car) {
      const wasTraffic = car.driver === 'traffic';
      if (wasTraffic && onDriverEjected) onDriverEjected(car.pos.x, car.pos.z);
      car.driver = 'player';
      car.speed = 0;
      onCrime(wasTraffic ? 3 : 2, wasTraffic ? 'Stole a car' : 'Took a parked car');
      return car;
    },
    release(car) { car.driver = 'none'; car.speed = 0; },
    damage(car, amount) {
      if (car.kind !== 'police') return false;
      car.hp -= amount;
      if (car.hp <= 0 && !car.disabled) {
        car.disabled = true;
        car.speed = 0;
        onCrime(2, 'Disabled a police cruiser');
        return true;
      }
      return false;
    },
    shootCop(cop) {
      cop.hp -= 1;
      if (cop.hp <= 0 && !cop.down) {
        cop.down = true;
        cop.group.rotation.x = Math.PI / 2;
        cop.group.position.y = 0.4;
        onCrime(4, 'Shot a police officer');
        return true;
      }
      return false;
    },
    policeNear(x, z, r) {
      for (const c of policeCars()) if (dist(x, z, c.pos.x, c.pos.z) < r) return true;
      for (const k of cops) if (!k.down && dist(x, z, k.pos.x, k.pos.z) < r) return true;
      return false;
    },
    policeCount() { return policeCars().length + cops.filter((k) => !k.down).length; },
  };
}
