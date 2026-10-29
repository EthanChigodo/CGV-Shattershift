/**
 * What Subject 07 can do, sector by sector, in the story: a sphere type a
 * level that the level needs, and a new ability.
 *
 *   The Foundry   Glass     throw by hand
 *   The Labs      + Cryo    the launcher, its charged shot - cryo puts out the fire walls
 *   The Skyline   + Shock   focus - shock's EMP is all that brings down the security drones
 *   The Roof      + Gravity quick shift (the dodge) - gravity throws patients off the roof
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
  foundry: { spheres: ["glass"], abilities: ["throw"] },
  labs: { spheres: ["cryo"], abilities: ["launcher", "charge"], tips: ["firewall"] },
  skyline: { spheres: ["shock"], abilities: ["focus"], tips: ["drone", "vent", "sprinkler"] },
  roof: { spheres: ["gravity"], abilities: ["dodge"], tips: ["brute"] },
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

/**
 * What to know about a sector before it starts (its card, after the new
 * things; Endless shows them once): the Skyline's smoke and fire.
 */
export const TIPS = {
  // The obstacles each sphere is for (the level's card says which to use).
  firewall: {
    name: "Fire walls",
    text: "A wall of fire right across the corridor: too tall to jump, and it burns you if you run into it. Change to the cryo sphere and shoot it before you get there - glass and shock do nothing to it. Cryo puts out any fire it bursts near, too: shoot the floor by a fire vent and it freezes over for good.",
    how: [{ kb: ["Q", "E"], pad: ["PadLB", "PadRB"], does: "change to cryo" }, { kb: ["Click"], pad: ["PadRT"], does: "shoot the fire" }],
  },
  drone: {
    name: "Security drones",
    text: "HALCYON sends drones after you: one keeps pace ahead and sweeps your lane with a red scan, then locks on and fires down it - change lane when the beam holds still. Its armour shrugs off glass, cryo and gravity: only a shock sphere's EMP brings it down.",
    how: [{ kb: ["Q", "E"], pad: ["PadLB", "PadRB"], does: "change to shock" }, { kb: ["Click"], pad: ["PadRT"], does: "shoot the drone" }],
  },
  brute: {
    name: "The brute",
    text: "The big one shrugs off spheres - each does a third of what it should. Throw it off the roof instead: a gravity sphere near it lifts it and flings it at the open ledge.",
    how: [{ kb: ["Q", "E"], pad: ["PadLB", "PadRB"], does: "change to gravity" }, { kb: ["Click"], pad: ["PadRT"], does: "shoot beside it" }],
  },
  vent: {
    name: "Air vents",
    text: "Smoke fills the causeway, and thick smoke eats your integrity. Shoot the cover off a vent on the walls and it pulls the smoke out of that stretch. The HUD warns you when the air turns, and says where the next vent is.",
    how: [{ kb: ["Click"], pad: ["PadRT"], does: "shoot the vent's cover" }],
  },
  sprinkler: {
    name: "Sprinklers",
    text: "Fire burns integrity too. Shoot the red glass bulb on a sprinkler and it floods the fire under it - a cryo sphere puts fires out as well.",
    how: [{ kb: ["Click"], pad: ["PadRT"], does: "shoot the red bulb" }],
  },
};

/** How to change sphere (for a new sphere's card). */
export const SPHERE_HOW = [{ kb: ["Q", "E"], pad: ["PadLB", "PadRB"], does: "change sphere" }];

const upTo = (stage) => STAGES.slice(0, Math.max(0, STAGES.indexOf(stage)) + 1);

/** The sphere types a story run has at this sector. */
export function spheresAt(stage) {
  return upTo(stage).flatMap((s) => GAINS[s].spheres);
}

/** The abilities a story run has at this sector. */
export function abilitiesAt(stage) {
  return new Set(upTo(stage).flatMap((s) => GAINS[s].abilities));
}
