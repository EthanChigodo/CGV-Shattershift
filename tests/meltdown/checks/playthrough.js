/**
 * Playthrough: a scripted player runs Phase A of the real game module.
 *
 * Guards the host-side rules the other checks never exercise - the player's
 * hitbox, the hit handling, the hidden countdown - by playing the level
 * through `__meltdown.game` (see bot.js). Kept alive (vitality floored) so it
 * sees every beat. Fails if:
 *   - any hit is not a real overlap with a hazard (a phantom hit: once, a
 *     broken hitbox made every hazard in range "hit" the player every second);
 *   - the bot takes more hits than a clumsy player would;
 *   - it does not reach the lift at the end;
 *   - the hidden countdown runs before the run starts.
 */

import { BOT_SOURCE } from "./bot.js";

export const name = "playthrough";

export async function run(page) {
  const failures = [];
  const notes = {};
  await page.waitForFunction(() => globalThis.__meltdown?.assetsReady, null, { timeout: 180000 });

  // Nothing counts down while the level waits and the lift doors open.
  const idle = await page.evaluate(() => {
    const g = globalThis.__meltdown.game;
    const before = g.level.state.timeRemaining;
    for (let i = 0; i < 150; i += 1) g.update(1 / 30, i / 30);
    return { before, after: g.level.state.timeRemaining };
  });
  if (idle.after !== idle.before) failures.push(`the countdown ran while idle (${idle.before} -> ${idle.after})`);

  await page.evaluate(() => globalThis.__meltdown.begin());
  const log = await page.evaluate(`(${BOT_SOURCE})({ immortal: true })`);
  const phantom = log.hits.filter((h) => !h.genuine);
  if (phantom.length) failures.push(`${phantom.length} hit(s) with nothing actually in the way, first at ${phantom[0].d} m`);
  if (log.hits.length > 14) failures.push(`${log.hits.length} hits in one run - far more than the obstacles account for`);
  if (!log.end || !["depart", "fade", "roofArrive"].includes(log.end.phase)) failures.push(`did not reach the lift at the end (${JSON.stringify(log.end)})`);
  notes.hits = log.hits.map((h) => `${h.d}m ${h.what}`);
  notes.end = log.end;
  return { failures, notes };
}
