// Screenshot staging: ?shot=start|play|end (with &seed=N) sets the game up as that
// scene instead of running the loop, paints a few frames and sets window.__shotReady.
// The shots show the real game: the start screen over the city, a police chase while
// driving with the HUD and minimap, and the story-complete screen.
import { landmarks } from './city.js';

export function stageShot(name, ctx) {
  const { player, cars, wanted, missions, hud } = ctx;
  if (name === 'start') {
    player.reset(landmarks.spawn.x, landmarks.spawn.z, landmarks.spawn.heading);
    missions.reset();
    missions.index = 0; missions.step = 0;
    wanted.clear();
    hud.toast('', '', 0.1);
    return { screen: 'title', runFrames: 40 };
  }
  if (name === 'play') {
    // Vic in a car, two stars, two cruisers on his tail, mid-mission.
    const car = cars.nearestStealable(landmarks.spawn.x, landmarks.spawn.z)
      || cars.cars.find((c) => c.kind === 'civil');
    cars.steal(car);
    car.pos.set(-29, 0, 60);
    car.heading = 0;
    car.speed = 16;
    ctx.enterCar(car);
    wanted.setStars(2);
    // Stage the chase close enough to read in one frame: cruisers right behind.
    cars.spawnPoliceAt(-29, 18);
    cars.spawnPoliceAt(-31, 2);
    missions.reset();
    missions.index = 1; missions.step = 0;
    hud.toast('The Package', 'Deliver the package to the Sunset Motel', 6);
    return { screen: 'play', runFrames: 150 };
  }
  // end: the story is complete.
  player.reset(landmarks.diner.x, landmarks.diner.z - 14, Math.PI);
  missions.reset();
  missions.storyDone = true;
  // Past the last mission, so the mission line reads "Story complete".
  missions.index = 4;
  wanted.clear();
  return { screen: 'win', runFrames: 40 };
}
