/**
 * Story difficulty: Easy, Normal (the game as designed) and Hard.
 *
 * One table, read by every level, so a difficulty means the same thing
 * everywhere:
 *
 *   speed       how fast the runner levels move (the Foundry's speed zones,
 *               the Labs' corridor, the Skyline's pace and its collapse)
 *   density     how close together the filler obstacles are (more = closer)
 *   damage      how much a hit (or the fire, or the smoke) takes off
 *   recharge    seconds for one sphere to come back when you have none
 *   length      how long the runner levels are (their sections stretch)
 *   checkpoint  whether the runner levels have their halfway checkpoint
 *   extras      Hard's new obstacles: the Foundry's slag carts, the Labs'
 *               fire waves and stalking patients in every section, the
 *               Skyline's falling debris and reinforced glass
 *   roof        the roof's fight: time between waves, how hard the
 *               patients hit, how fast they move, how long the helicopter
 *               takes, how many waves there are
 *
 * Endless and the chapters' practice runs keep Normal: Endless already gets
 * harder the further you go. The choice is kept in the browser.
 */

export const DIFFICULTIES = {
  easy: {
    key: "easy", name: "Easy",
    blurb: "Slower, fewer obstacles, hits hurt less, spheres come back faster.",
    speed: 0.88, density: 0.75, damage: 0.65, recharge: 1.6, length: 0.9, checkpoint: true, extras: false,
    roof: { waves: 1.3, damage: 0.65, enemySpeed: 0.9, heli: 0.9, lastWave: 3 },
  },
  normal: {
    key: "normal", name: "Normal",
    blurb: "The escape as designed. One checkpoint per level.",
    speed: 1, density: 1, damage: 1, recharge: 2.5, length: 1, checkpoint: true, extras: false,
    roof: { waves: 1, damage: 1, enemySpeed: 1, heli: 1, lastWave: 3 },
  },
  hard: {
    key: "hard", name: "Hard",
    blurb: "Longer and faster, more obstacles and new ones, hits hurt more, no checkpoints; a fourth wave on the roof.",
    speed: 1.14, density: 1.35, damage: 1.35, recharge: 3.5, length: 1.3, checkpoint: false, extras: true,
    roof: { waves: 0.72, damage: 1.35, enemySpeed: 1.15, heli: 1.4, lastWave: 4 },
  },
};
export const DIFFICULTY_ORDER = ["easy", "normal", "hard"];

const KEY = "fractureRun.difficulty";

export function loadDifficulty() {
  try {
    const key = localStorage.getItem(KEY);
    return DIFFICULTIES[key] ? key : "normal";
  } catch {
    return "normal";
  }
}

export function saveDifficulty(key) {
  if (!DIFFICULTIES[key]) return;
  try { localStorage.setItem(KEY, key); } catch {}
}
