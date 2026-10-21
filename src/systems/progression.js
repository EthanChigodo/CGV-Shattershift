/**
 * What Subject 07 can do, sector by sector, in the story: one new sphere
 * type each level, and a new ability.
 *
 *   The Foundry   Glass     throw by hand
 *   The Labs      + Cryo    the launcher, and its charged shot
 *   The Skyline   + Shock   focus (bullet time)
 *   The Roof      + Gravity quick shift (the dodge), free movement
 *
 * A story run gets what its sector has reached; Endless and the multiplayer
 * modes have everything. Each sector's gains are shown on a card before it
 * starts (src/ui/unlock-card.js), with how to use them.
 *
 *   spheresAt("labs")     // ["glass", "cryo"]
 *   abilitiesAt("labs")   // Set { "throw", "launcher", "charge" }
 */

export const STAGES = ["foundry", "labs", "skyline", "roof"];

export const STAGE_NAMES = {
  foundry: "Sector 01 · The Foundry",
  labs: "Sector 02 · The Labs",
  skyline: "Sector 03 · The Skyline",
  roof: "The Roof",
};

/** What each sector adds. */
export const GAINS = {
  foundry: { sphere: "glass", abilities: ["throw"] },
  labs: { sphere: "cryo", abilities: ["launcher", "charge"] },
  skyline: { sphere: "shock", abilities: ["focus"] },
  roof: { sphere: "gravity", abilities: ["dodge"] },
};

/**
 * The abilities (and the launcher, a weapon - `kind`): the card's words, and how to use one - each `how` line is
 * the keyboard's keys, the controller's (input-glyphs.js codes) and what
 * they do.
 */
export const ABILITIES = {
  throw: {
    name: "Throw",
    text: "Subject 07 throws the spheres by hand - a real arc, so aim a little high for the far ones. Glass breaks glass.",
    how: [{ kb: ["Click"], pad: ["PadRT"], does: "throw at the crosshair" }],
  },
  launcher: {
    // (A weapon, not an ability: its charged shot is the Labs' ability.)
    kind: "Weapon",
    name: "The launcher",
    text: "The Labs' failed prototype, off the lift's roof. Spheres go out of it flat and fast, straight to the crosshair.",
    how: [{ kb: ["Click"], pad: ["PadRT"], does: "fire" }],
  },
  charge: {
    name: "Charged shot",
    text: "Hold the trigger and the launcher charges; let go to fire. The longer you hold, the faster and harder the sphere goes, tearing the air as it flies. It bursts where it lands, breaking everything round it - full, the most of all. Twice the spheres.",
    how: [{ kb: ["Hold", "Click"], pad: ["Hold", "PadRT"], does: "charge, then let go" }],
  },
  focus: {
    name: "Focus",
    text: "Time slows to a crawl while you line up the shot. The meter drains while you hold it, and fills again as you break things.",
    how: [{ kb: ["Hold", "Right click"], pad: ["Hold", "PadLT"], does: "slow time" }],
  },
  dodge: {
    name: "Quick shift",
    text: "The roof is open ground: walk it freely, and burst out of the way - through a charge, or off a laser's line before it locks.",
    how: [
      { kb: ["W", "A", "S", "D"], pad: ["Left stick"], does: "move" },
      { kb: ["Mouse"], pad: ["Right stick"], does: "look all the way round" },
      { kb: ["Space"], pad: ["PadA"], does: "quick shift the way you're moving" },
      { kb: ["C"], pad: ["PadY"], does: "top-down camera instead" },
    ],
  },
};

/** How to change sphere (for a new sphere's card). */
export const SPHERE_HOW = [{ kb: ["Q", "E"], pad: ["PadLB", "PadRB"], does: "change sphere" }];

const upTo = (stage) => STAGES.slice(0, Math.max(0, STAGES.indexOf(stage)) + 1);

/** The sphere types a story run has at this sector. */
export function spheresAt(stage) {
  return upTo(stage).map((s) => GAINS[s].sphere);
}

/** The abilities a story run has at this sector. */
export function abilitiesAt(stage) {
  return new Set(upTo(stage).flatMap((s) => GAINS[s].abilities));
}
