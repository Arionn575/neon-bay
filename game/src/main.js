// Neon Bay: boot, the one loop, the camera, input, screens, save/load and the wiring
// between the city, the player, the cars, the peds, the wanted level, the missions and
// the combat. ?shot=start|play|end (with &seed=N) stages that scene for a screenshot.
//
// Controls: WASD/arrows walk & drive, mouse drag looks, E enter/steal a car, F or click
// shoots on foot, Shift runs, Space jumps / handbrakes, P pauses, M mutes.
import * as THREE from 'three';
import { clamp, damp } from './util.js';
import { buildCity, landmarks } from './city.js';
import { createPlayer } from './player.js';
import { createCars } from './cars.js';
import { createPeds } from './peds.js';
import { createWanted } from './wanted.js';
import { createMissions } from './missions.js';
import { createCombat } from './combat.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const SAVE_KEY = 'neonbay-save-v1';

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// ?low=1 is a debug flag for slow machines (headless software rendering): no shadows,
// pixel ratio 1. The shipped game runs with shadows on.
const lowPerf = params.get('low') === '1';
renderer.setPixelRatio(lowPerf ? 1 : Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !lowPerf;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 1500);
const { groundCanvas } = buildCity(scene);

const audio = createAudio();
const hud = createHud(groundCanvas);
const wanted = createWanted();
const player = createPlayer(scene);
const peds = createPeds(scene);
const missions = createMissions({
  wanted,
  onToast: (t, s) => hud.toast(t, s, 5),
  onReward: (n) => { state.money += n; save(); },
  onGuards: (n, pos) => combat.spawnGuards(n, pos),
});
const cars = createCars(scene, {
  wanted, audio,
  onCrime: (amount, label) => { wanted.add(amount, label); hud.toast('Wanted!', label, 2.5); peds.scare(player.pos.x, player.pos.z, 30); },
  onThud: () => audio.thud(),
  onDriverEjected: (x, z) => peds.spawnFlee(x, z),
});
const combat = createCombat(scene, {
  onDamage: (amount) => hurt(amount),
  onCrime: (amount, label) => { wanted.add(amount, label); hud.toast('Wanted!', label, 2.5); },
  onGuardDown: () => missions.guardDown(),
  onPedDown: (ped) => peds.down(ped),
});

const state = {
  screen: 'title', money: 150, health: 100,
  playerCar: null, lastDamageT: -99, bustT: 0, clock: 0,
  camYaw: Math.PI, camPitch: 0.32, camDist: 9, saveT: 0,
  muted: false,
};

player.reset(landmarks.spawn.x, landmarks.spawn.z, landmarks.spawn.heading);
cars.spawnInitial();
peds.spawnInitial(16);

// ---- input ----
const keys = {};
const input = { f: false, b: false, l: false, r: false, run: false, jump: false, handbrake: false };
let mouseDown = false, mouseMoved = 0, lastMX = 0, lastMY = 0;
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'KeyM') { state.muted = audio.toggleMute(); hud.toast(state.muted ? 'Muted' : 'Sound on', '', 1.5); }
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyE' && state.screen === 'play') tryEnterCar();
  if (e.code === 'KeyF' && state.screen === 'play' && !state.playerCar) shoot();
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('mousedown', (e) => { mouseDown = true; mouseMoved = 0; lastMX = e.clientX; lastMY = e.clientY; });
window.addEventListener('mousemove', (e) => {
  if (!mouseDown) return;
  const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
  lastMX = e.clientX; lastMY = e.clientY;
  mouseMoved += Math.abs(dx) + Math.abs(dy);
  state.camYaw -= dx * 0.005;
  state.camPitch = clamp(state.camPitch + dy * 0.004, -0.1, 0.9);
});
window.addEventListener('mouseup', (e) => {
  if (mouseDown && mouseMoved < 6 && state.screen === 'play' && !state.playerCar) shoot();
  mouseDown = false;
});
canvas.addEventListener('wheel', (e) => {
  state.camDist = clamp(state.camDist + Math.sign(e.deltaY) * 1.5, 4.5, 16);
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function readInput() {
  input.f = !!(keys.KeyW || keys.ArrowUp);
  input.b = !!(keys.KeyS || keys.ArrowDown);
  input.l = !!(keys.KeyA || keys.ArrowLeft);
  input.r = !!(keys.KeyD || keys.ArrowRight);
  input.run = !!keys.ShiftLeft || !!keys.ShiftRight;
  input.jump = !!keys.Space;
  input.handbrake = !!keys.Space;
}

function tryEnterCar() {
  if (state.playerCar) {
    // Exit: step out beside the car.
    const car = state.playerCar;
    cars.release(car);
    state.playerCar = null;
    player.reset(car.pos.x + Math.sin(car.heading + Math.PI / 2) * 2.2, car.pos.z + Math.cos(car.heading + Math.PI / 2) * 2.2, car.heading);
    player.group.visible = true;
    audio.engineOff();
    hud.setCrosshair(true);
    return;
  }
  const car = cars.nearestStealable(player.pos.x, player.pos.z);
  if (car) {
    cars.steal(car);
    state.playerCar = car;
    player.group.visible = false;
    hud.setCrosshair(false);
    audio.chime();
    hud.toast('Nice wheels', '', 1.5);
  }
}

function shoot() {
  if (state.clock - (shoot.last || -9) < 0.22) return;
  shoot.last = state.clock;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.position.clone();
  const res = combat.shoot(origin, dir, {
    cops: cars.cops, policeCars: cars.cars.filter((c) => c.kind === 'police' && !c.disabled),
    peds,
    onShootCop: (cop) => cars.shootCop(cop),
    onShootPoliceCar: (car) => cars.damage(car, 1),
  });
  audio.shot();
  if (res.hit) hud.toast('', '', 0.1);
}

function hurt(amount) {
  state.health -= amount;
  state.lastDamageT = state.clock;
  if (state.health <= 0) wasted();
}

function busted() {
  state.screen = 'busted';
  state.money = Math.max(0, state.money - 200);
  wanted.clear();
  showScreen('screen-busted');
  announce('Busted. The police caught Vic.');
  save();
}
function wasted() {
  state.health = 0;
  state.screen = 'wasted';
  state.money = Math.max(0, state.money - 200);
  wanted.halve();
  showScreen('screen-wasted');
  announce('Wasted. Vic woke up at the hospital.');
  save();
}
function respawnAt(lm) {
  if (state.playerCar) { cars.release(state.playerCar); state.playerCar = null; }
  player.reset(lm.x, lm.z, 0);
  player.group.visible = true;
  state.health = 100;
  state.bustT = 0;
  audio.engineOff();
  audio.siren(false);
  hud.setCrosshair(true);
  state.screen = 'play';
  showScreen(null);
  save();
}

function showScreen(id) {
  for (const s of ['screen-start', 'screen-pause', 'screen-busted', 'screen-wasted', 'screen-win']) {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  }
}
function announce(msg) { statusEl.textContent = msg; }

function togglePause() {
  if (state.screen === 'play') { state.screen = 'paused'; showScreen('screen-pause'); announce('Paused.'); }
  else if (state.screen === 'paused') { state.screen = 'play'; showScreen(null); announce('Playing.'); }
}

function startGame(fresh) {
  audio.unlock();
  if (fresh) {
    state.money = 150; state.health = 100;
    missions.reset();
    cars.reset();
    peds.reset();
    combat.clearGuards();
    wanted.clear();
    player.reset(landmarks.spawn.x, landmarks.spawn.z, landmarks.spawn.heading);
    try { localStorage.removeItem(SAVE_KEY); } catch { /* no storage */ }
    missions.start(0);
  }
  state.screen = 'play';
  showScreen(null);
  hud.setCrosshair(true);
  announce('Playing. Follow the mission marker.');
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: state.money, health: state.health,
      mission: missions.getState(),
      x: player.pos.x, z: player.pos.z, heading: player.heading,
    }));
  } catch { /* storage off: the save lasts this visit only */ }
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    state.money = s.money ?? 150;
    state.health = s.health ?? 100;
    missions.setState(s.mission || { index: 0, step: 0 });
    player.reset(s.x ?? landmarks.spawn.x, s.z ?? landmarks.spawn.z, s.heading ?? 0);
    return true;
  } catch { return false; }
}

document.getElementById('btn-start').addEventListener('click', () => startGame(true));
document.getElementById('btn-continue').addEventListener('click', () => {
  audio.unlock();
  if (load()) { state.screen = 'play'; showScreen(null); hud.setCrosshair(true); }
  else startGame(true);
});
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-restart').addEventListener('click', () => startGame(true));
document.getElementById('btn-busted').addEventListener('click', () => respawnAt(landmarks.police));
document.getElementById('btn-wasted').addEventListener('click', () => respawnAt(landmarks.hospital));
document.getElementById('btn-freeroam').addEventListener('click', () => { state.screen = 'play'; showScreen(null); });
try { if (localStorage.getItem(SAVE_KEY)) document.getElementById('btn-continue').classList.remove('hidden'); } catch { /* no storage */ }

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.screen === 'play') togglePause();
});
window.addEventListener('beforeunload', save);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- the camera: third-person orbit on foot, chase cam in a car ----
function updateCamera(dt) {
  const target = state.playerCar ? state.playerCar.pos : player.pos;
  const targetHeading = state.playerCar ? state.playerCar.heading : player.heading;
  if (state.playerCar) {
    // Chase cam: swing behind the car's heading, unless the player is dragging.
    const wantYaw = targetHeading + Math.PI;
    let d = wantYaw - state.camYaw;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    if (!mouseDown) state.camYaw += d * Math.min(1, dt * 2.2);
    state.camPitch = damp(state.camPitch, 0.22, 2, dt);
  }
  const dist = state.playerCar ? state.camDist + 0.5 : state.camDist;
  const cx = target.x + Math.sin(state.camYaw) * Math.cos(state.camPitch) * dist;
  const cz = target.z + Math.cos(state.camYaw) * Math.cos(state.camPitch) * dist;
  const cy = (state.playerCar ? 1.2 : 1.6) + Math.sin(state.camPitch) * dist;
  camera.position.set(cx, Math.max(1.2, cy), cz);
  camera.lookAt(target.x, (state.playerCar ? 1.0 : 1.5) + target.y, target.z);
}

// ---- one fixed step ----
function step() {
  state.clock += STEP;
  readInput();
  const inCar = !!state.playerCar;
  if (inCar) {
    cars.updatePlayerCar(STEP, state.playerCar, input);
    // The player rides in the car: every world system reads player.pos as the actor.
    player.pos.set(state.playerCar.pos.x, 0, state.playerCar.pos.z);
    player.heading = state.playerCar.heading;
  } else player.update(STEP, input, state.camYaw);

  // Running over a pedestrian while driving.
  if (inCar && Math.abs(state.playerCar.speed) > 5) {
    const ped = peds.nearest(state.playerCar.pos.x, state.playerCar.pos.z, 2.4);
    if (ped && ped.state !== 'down') {
      peds.down(ped);
      wanted.add(2, 'Hit a pedestrian');
      peds.scare(state.playerCar.pos.x, state.playerCar.pos.z, 30);
      audio.thud();
    }
  }

  cars.update(STEP, player, state.playerCar);
  peds.update(STEP, player.pos, state.playerCar);
  // Heat bleeds away once the police are no longer on top of the player (60 m):
  // with the cruisers' search mode, breaking away for a few seconds is enough.
  wanted.update(STEP, cars.policeNear(player.pos.x, player.pos.z, 60));
  combat.update(STEP, player.pos, inCar, cars.cops);

  // Health regenerates after 5 quiet seconds.
  if (state.clock - state.lastDamageT > 5 && state.health > 0) {
    state.health = Math.min(100, state.health + 4 * STEP);
  }

  // Busted: a cruiser or a foot cop stays on Vic for a moment.
  if (!inCar && wanted.stars > 0) {
    let touching = false;
    for (const c of cars.cars) {
      if (c.kind === 'police' && !c.disabled && Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z) < 2.6) touching = true;
    }
    for (const k of cars.cops) {
      if (!k.down && Math.hypot(k.pos.x - player.pos.x, k.pos.z - player.pos.z) < 1.7) touching = true;
    }
    state.bustT = touching ? state.bustT + STEP : 0;
    if (state.bustT > 0.9) { state.bustT = 0; busted(); return; }
  } else state.bustT = 0;

  const res = missions.update({ x: player.pos.x, z: player.pos.z, inCar, wantedStars: wanted.stars });
  if (res === 'storyDone') {
    state.screen = 'win';
    showScreen('screen-win');
    announce('Story complete. Neon Bay is yours.');
    save();
  }

  // Audio: siren while wanted, engine while driving.
  audio.siren(wanted.stars > 0);
  if (!inCar) audio.engineOff();

  // Autosave.
  state.saveT += STEP;
  if (state.saveT > 20) { state.saveT = 0; save(); }

  updateHud();
  updateCamera(STEP);
  renderer.render(scene, camera);
}

// The HUD snapshot, used by step() and by the title/win screens, so the money,
// health and mission line are never stale.
function updateHud() {
  const inCar = !!state.playerCar;
  hud.update({
    money: state.money, health: state.health, stars: wanted.stars,
    missionName: missions.current ? missions.current.name : (missions.storyDone ? 'Story complete' : null),
    missionText: missions.objectiveText,
    inCar, speed: inCar ? state.playerCar.speed : 0,
    player: { x: player.pos.x, z: player.pos.z, heading: player.heading },
    cars: cars.cars, cops: cars.cops, peds: peds.peds, guards: combat.guards,
    missionTarget: missions.target, clock: state.clock,
  });
}

// ---- the frame loop ----
let last = performance.now();
let accumulator = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (state.screen !== 'play' && state.screen !== 'title') { last = now; return; }
  accumulator += Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  let guard = 0;
  while (accumulator >= STEP && guard < 8) {
    if (state.screen === 'title') { // idle city behind the start screen
      state.clock += STEP;
      cars.update(STEP, player, null);
      peds.update(STEP, player.pos, null);
      updateCamera(STEP);
      updateHud();
    } else step();
    accumulator -= STEP;
    guard += 1;
    if (state.screen !== 'play' && state.screen !== 'title') break;
  }
  renderer.render(scene, camera);
}

// ---- screenshot staging ----
function runShot(name) {
  const staged = stageShot(name, {
    player, cars, wanted, missions, hud,
    enterCar: (car) => { state.playerCar = car; player.group.visible = false; hud.setCrosshair(false); },
  });
  state.screen = staged.screen === 'title' ? 'title' : staged.screen === 'win' ? 'win' : 'play';
  if (staged.screen === 'title') showScreen('screen-start');
  else if (staged.screen === 'win') showScreen('screen-win');
  else showScreen(null);
  // In play shots the player is in a car, so no crosshair.
  // In play shots the car keeps driving: hold W down through the normal input path.
  if (staged.screen === 'play') keys.KeyW = true;
  let painted = 0;
  function paint() {
    if (staged.screen === 'title') {
      state.clock += STEP;
      cars.update(STEP, player, null);
      peds.update(STEP, player.pos, null);
      updateCamera(STEP);
      updateHud();
    } else step();
    renderer.render(scene, camera);
    painted += 1;
    if (painted < staged.runFrames) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

// Debug hooks for playtesting (never shown in the game).
window.__neon = {
  state, player, cars, peds, wanted, missions, combat, hud,
  start: (fresh) => startGame(fresh),
  warp: (x, z) => { if (state.playerCar) { state.playerCar.pos.set(x, 0, z); } else player.reset(x, z, 0); },
  setWanted: (n) => wanted.setStars(n),
  get inCar() { return !!state.playerCar; },
};

if (shotName) runShot(shotName);
else {
  announce('Neon Bay. Press Start to play.');
  requestAnimationFrame(frame);
}
