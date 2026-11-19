// The wanted system: heat 0..10, stars = floor(heat / 2) capped at 5. Crimes add heat;
// heat bleeds away only while no police are near and no crime happened recently.
// The police response (cars and foot cops) lives in cars.js and reads `stars` here.
export function createWanted() {
  const w = {
    heat: 0, stars: 0, lastCrimeT: -99, clock: 0,
    add(amount, label) {
      w.heat = Math.min(10, w.heat + amount);
      w.lastCrimeT = w.clock;
      w.stars = Math.min(5, Math.floor(w.heat / 2));
      return label;
    },
    update(dt, policeNear) {
      w.clock += dt;
      const newStars = Math.min(5, Math.floor(w.heat / 2));
      if (newStars !== w.stars) w.stars = newStars;
      if (!policeNear && w.clock - w.lastCrimeT > 5) {
        w.heat = Math.max(0, w.heat - dt * 0.28);
        w.stars = Math.min(5, Math.floor(w.heat / 2));
      }
    },
    clear() { w.heat = 0; w.stars = 0; },
    halve() { w.heat = Math.max(0, w.heat / 2); w.stars = Math.min(5, Math.floor(w.heat / 2)); },
    setStars(n) { w.heat = n * 2; w.stars = n; w.lastCrimeT = w.clock; },
  };
  return w;
}
