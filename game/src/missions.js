// The story: Vic Marlowe, out of prison, working for Rosa Delgado at the Palms Diner,
// settling a score with Eddie Salazar. Four missions, each a short step chain with a
// marker the HUD and the minimap show. Rewards are cash; the last mission ends the story.
import { landmarks } from './city.js';
import { dist } from './util.js';

const MISSIONS = [
  {
    name: 'Wheels',
    intro: "Rosa needs wheels. Any car will do — Neon Bay is full of them.",
    reward: 500,
    steps: [
      { type: 'enterCar', text: 'Get a car (walk up to one and press E)' },
      { type: 'reach', target: landmarks.diner, radius: 10, text: "Drive to Rosa's Palms Diner" },
    ],
  },
  {
    name: 'The Package',
    intro: 'A package is waiting at the Marina Docks. Bring it to the Sunset Motel, no questions.',
    reward: 800,
    steps: [
      { type: 'reach', target: landmarks.marina, radius: 9, text: 'Pick up the package at the Marina Docks' },
      { type: 'reach', target: landmarks.motel, radius: 10, text: 'Deliver the package to the Sunset Motel' },
    ],
  },
  {
    name: 'Heat',
    intro: "Salazar tipped off the cops! Lose them, then lay low at the safehouse.",
    reward: 1000,
    steps: [
      { type: 'loseCops', text: 'Lose the cops — get your wanted level to zero' },
      { type: 'reach', target: landmarks.safehouse, radius: 10, text: 'Reach the safehouse' },
    ],
  },
  {
    name: 'Payback',
    intro: "Time to settle it. Salazar's warehouse, three guards, one bag of cash.",
    reward: 2000,
    steps: [
      { type: 'reach', target: landmarks.warehouse, radius: 12, text: "Get to Salazar's Warehouse" },
      { type: 'eliminate', count: 3, text: 'Take out the guards (0/3)' },
      { type: 'reach', target: landmarks.warehouse, radius: 7, text: 'Grab the cash' },
      { type: 'reach', target: landmarks.diner, radius: 10, text: 'Bring the cash to Rosa' },
    ],
  },
];

export function createMissions(deps) {
  const { wanted, onToast, onReward, onGuards } = deps;
  const m = {
    index: 0, step: 0, done: false, storyDone: false,
    get current() { return MISSIONS[m.index] || null; },
    get stepDef() { const c = m.current; return c ? c.steps[m.step] : null; },
    get target() { const s = m.stepDef; return s && s.target ? s.target : null; },
    get objectiveText() {
      const s = m.stepDef;
      if (!s) return m.storyDone ? 'free roam' : '';
      if (s.type === 'eliminate') return `Take out the guards (${s.doneCount || 0}/${s.count})`;
      return s.text;
    },
    start(i) {
      m.index = i; m.step = 0; m.done = false;
      const cur = m.current;
      if (!cur) return;
      onToast(cur.name, cur.intro);
      if (cur.name === 'Heat') wanted.setStars(2);
      if (cur.name === 'Payback') onGuards(3, landmarks.warehouse);
    },
    guardDown() {
      const s = m.stepDef;
      if (s && s.type === 'eliminate') {
        s.doneCount = (s.doneCount || 0) + 1;
        if (s.doneCount >= s.count) m.advance();
      }
    },
    advance() {
      const cur = m.current;
      if (!cur) return 'none';
      m.step += 1;
      if (m.step >= cur.steps.length) {
        onReward(cur.reward);
        onToast(`${cur.name} complete`, `+$${cur.reward}`);
        m.index += 1;
        m.step = 0;
        if (m.index >= MISSIONS.length) {
          m.storyDone = true;
          return 'storyDone';
        }
        m.start(m.index);
        return 'missionDone';
      }
      return 'stepDone';
    },
    // ctx: {x, z, inCar, wantedStars}. Returns 'stepDone' | 'missionDone' | 'storyDone' | 'none'.
    update(ctx) {
      const s = m.stepDef;
      if (!s || m.storyDone) return 'none';
      if (s.type === 'enterCar' && ctx.inCar) return m.advance();
      if (s.type === 'reach' && s.target && dist(ctx.x, ctx.z, s.target.x, s.target.z) < s.radius) return m.advance();
      if (s.type === 'loseCops' && ctx.wantedStars === 0) return m.advance();
      return 'none';
    },
    getState() { return { index: m.index, step: m.step, storyDone: m.storyDone }; },
    setState(st) {
      m.index = st.index || 0;
      m.step = st.step || 0;
      m.storyDone = !!st.storyDone;
      if (!m.storyDone && m.current) {
        if (m.current.name === 'Heat') wanted.setStars(2);
        if (m.current.name === 'Payback') onGuards(3, landmarks.warehouse);
      }
    },
    reset() { m.index = 0; m.step = 0; m.storyDone = false; for (const mi of MISSIONS) for (const s of mi.steps) delete s.doneCount; },
  };
  return m;
}
