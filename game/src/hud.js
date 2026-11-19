// The HUD: money, health, wanted stars, mission line, speed, toasts, and the minimap
// canvas — the whole city with the player, cars, police, peds and the mission marker.
import { WORLD, BEACH_X } from './city.js';

export function createHud(groundCanvas) {
  const moneyEl = document.querySelector('#hud-money .cash');
  const healthFill = document.getElementById('hud-health-fill');
  const wantedEl = document.getElementById('hud-wanted');
  const missionEl = document.getElementById('hud-mission');
  const missionName = missionEl.querySelector('.mname');
  const missionObj = missionEl.querySelector('.mobj');
  const speedEl = document.getElementById('hud-speed');
  const toastEl = document.getElementById('hud-toast');
  const subEl = document.getElementById('hud-sub');
  const crossEl = document.getElementById('hud-cross');
  const map = document.getElementById('hud-minimap');
  const mg = map.getContext('2d');
  let toastT = null;

  function toast(title, sub, seconds = 4) {
    toastEl.textContent = title;
    subEl.textContent = sub || '';
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.textContent = ''; subEl.textContent = ''; }, (seconds || 4) * 1000);
  }

  function drawMap(snap) {
    const W = map.width, H = map.height;
    mg.clearRect(0, 0, W, H);
    // Ground canvas as the base: world -WORLD..WORLD maps to the canvas.
    mg.drawImage(groundCanvas, 0, 0, W, H);
    const toPx = (v) => ((v + WORLD) / (WORLD * 2)) * W;
    // Water strip on the east edge.
    mg.fillStyle = '#1f7fa8';
    mg.fillRect(toPx(BEACH_X), 0, W - toPx(BEACH_X), H);
    // Mission marker: pulsing yellow diamond.
    if (snap.missionTarget) {
      const mx = toPx(snap.missionTarget.x), my = toPx(snap.missionTarget.z);
      const r = 7 + Math.sin(snap.clock * 5) * 2;
      mg.fillStyle = '#ffd23e';
      mg.beginPath();
      mg.moveTo(mx, my - r); mg.lineTo(mx + r, my); mg.lineTo(mx, my + r); mg.lineTo(mx - r, my);
      mg.closePath(); mg.fill();
      mg.strokeStyle = '#000'; mg.lineWidth = 1; mg.stroke();
    }
    // Pedestrians: tiny grey dots.
    mg.fillStyle = 'rgba(220,220,220,0.8)';
    for (const p of snap.peds || []) mg.fillRect(toPx(p.pos.x) - 1, toPx(p.pos.z) - 1, 2, 2);
    // Civilian cars: yellow dots.
    mg.fillStyle = '#ffe14d';
    for (const c of snap.cars || []) {
      if (c.kind === 'civil') { mg.beginPath(); mg.arc(toPx(c.pos.x), toPx(c.pos.z), 2.5, 0, 7); mg.fill(); }
    }
    // Guards: red dots.
    mg.fillStyle = '#ff4444';
    for (const g of snap.guards || []) {
      if (!g.down) { mg.beginPath(); mg.arc(toPx(g.pos.x), toPx(g.pos.z), 3, 0, 7); mg.fill(); }
    }
    // Police: flashing blue/red dots.
    const flash = Math.sin(snap.clock * 10) > 0;
    mg.fillStyle = flash ? '#4488ff' : '#ff3333';
    for (const c of snap.cars || []) {
      if (c.kind === 'police' && !c.disabled) { mg.beginPath(); mg.arc(toPx(c.pos.x), toPx(c.pos.z), 3.5, 0, 7); mg.fill(); }
    }
    for (const k of snap.cops || []) {
      if (!k.down) { mg.beginPath(); mg.arc(toPx(k.pos.x), toPx(k.pos.z), 3, 0, 7); mg.fill(); }
    }
    // Player: white arrow, rotated to the heading.
    const px = toPx(snap.player.x), py = toPx(snap.player.z);
    mg.save();
    mg.translate(px, py);
    mg.rotate(Math.atan2(Math.sin(snap.player.heading), Math.cos(snap.player.heading)) + Math.PI / 2);
    mg.fillStyle = '#ffffff';
    mg.strokeStyle = '#000'; mg.lineWidth = 1;
    mg.beginPath();
    mg.moveTo(0, -7); mg.lineTo(5, 5); mg.lineTo(0, 2.5); mg.lineTo(-5, 5);
    mg.closePath(); mg.fill(); mg.stroke();
    mg.restore();
  }

  return {
    toast,
    setCrosshair(on) { crossEl.style.display = on ? 'block' : 'none'; },
    update(snap) {
      moneyEl.textContent = Math.floor(snap.money).toLocaleString('en-US');
      healthFill.style.width = `${Math.max(0, snap.health)}%`;
      healthFill.style.background = snap.health > 50 ? 'linear-gradient(90deg,#2ecc71,#7dff9a)' : snap.health > 25 ? 'linear-gradient(90deg,#e8a13c,#ffd23e)' : 'linear-gradient(90deg,#d23c2e,#ff7a6a)';
      let stars = '';
      for (let i = 0; i < 5; i++) stars += i < snap.stars ? '★' : '<span class="off">★</span>';
      wantedEl.innerHTML = stars;
      if (snap.missionName) {
        missionEl.classList.remove('hidden');
        missionName.textContent = snap.missionName;
        missionObj.textContent = snap.missionText;
      } else missionEl.classList.add('hidden');
      if (snap.inCar) {
        speedEl.classList.remove('hidden');
        speedEl.innerHTML = `${Math.round(Math.abs(snap.speed) * 2.237)} <span class="unit">mph</span>`;
      } else speedEl.classList.add('hidden');
      drawMap(snap);
    },
  };
}
