/**
 * Balance checks - can the level actually be finished, and is it fair?
 *
 * Two of these guard bugs that made the level unplayable in ways no amount of
 * hands-on testing would reliably surface:
 *
 *  - the sphere softlock: cells returned a sphere only 55% of the time, so a
 *    player who shot everything reached the mandatory extraction valve with
 *    nothing to shoot it with, and the level became unfinishable
 *  - the escape death spiral: fully closing gates meant one impact cost speed,
 *    the lost speed meant arriving after the next gate shut, and a simulated
 *    run took six gate hits in a row
 *
 * Each check reloads the page first, because a simulated run breaks switches
 * and permanently changes the level.
 */

import { installSimulator } from "../lib/simulate.js";

export const name = "balance";

async function freshRun(page, url, options) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => globalThis.__foundry?.level, null, { timeout: 20000 });
  await installSimulator(page);
  return page.evaluate((opts) => globalThis.__sim(opts), options);
}

export async function run(page, { url }) {
  const failures = [];
  const notes = {};

  /* -- A player who shoots everything and uses the right inputs ---------- */
  const skilled = await freshRun(page, url, { shootCells: true, useInputs: true });
  notes.skilled = skilled;

  if (!skilled.complete) {
    failures.push("a skilled run does not complete the level");
  }
  if (skilled.systems < 3) {
    failures.push(`a skilled run restores only ${skilled.systems}/3 systems`);
  }
  if (skilled.hits > 0) {
    failures.push(`a skilled run takes ${skilled.hits} hit(s) - the level should be clearable untouched`);
  }
  if (skilled.ranDryAt !== null) {
    failures.push(
      `a player who shoots everything runs out of spheres at ${skilled.ranDryAt}m - this is the softlock, cells must return the sphere they cost`
    );
  }

  /* -- A player who never jumps or slides and ignores optional switches --- */
  const sloppy = await freshRun(page, url, { shootCells: false, useInputs: false });
  notes.sloppy = sloppy;

  if (!sloppy.complete) {
    failures.push(
      `a player who never jumps or slides cannot finish (reached ${sloppy.reached}m, ${sloppy.hits} hits) - the level should be survivable badly, not only well`
    );
  }
  if (sloppy.escapeHits > 1) {
    failures.push(
      `${sloppy.escapeHits} hits during the escape - this is the death spiral, gates must stop short of fully closed while the clock runs`
    );
  }

  /* -- The escape timer has to be losable but not a coin flip ------------- */
  notes.escapeSecondsLeft = skilled.escapeLeft;
  if (skilled.escapeLeft <= 0) {
    failures.push("a skilled run runs out of containment time - the escape is unwinnable");
  }
  if (skilled.escapeLeft > skilled.seconds * 0.5) {
    failures.push(
      `a skilled run finishes with ${skilled.escapeLeft}s spare - the countdown is decoration rather than a loss condition`
    );
  }

  return { failures, notes };
}
