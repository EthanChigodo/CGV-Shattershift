/**
 * Kits: sets of looks you earn, each unlocked by a trophy (src/systems/trophies.js).
 *
 *   escapee   finish the story ("Get to the Roof"): the Ember outfit, the
 *             Visor, the Escape runners, the Molten launcher finish
 *   fracture  the platinum ("Fracture Proof"): the Platinum outfit, the Halo,
 *             the Platinum trainers, the Prism launcher finish
 *
 * An item belongs to a kit by its `kit` field (OUTFITS, HEADWEAR, SHOES,
 * LAUNCHER_SKINS); anything without one is always yours.
 *
 *   kitLocked(item)            true while its kit isn't unlocked
 *   unlockedKeys(table)        the keys you can pick, in order
 *   KIT_FOR_TROPHY[trophyId]   the kit a trophy unlocks
 */

import { progress } from "../systems/trophies.js";

export const KITS = {
  escapee: {
    key: "escapee", name: "Escapee kit", trophy: "roof", colour: "#ff8a3d",
    how: "Finish the story", blurb: "For getting out of Ascension Tower.",
    items: ["Ember outfit", "Visor", "Escape runners", "Molten launcher finish"],
  },
  fracture: {
    key: "fracture", name: "Fracture kit", trophy: "platinum", colour: "#bdeeff",
    how: "Earn the platinum", blurb: "For earning every trophy there is.",
    items: ["Platinum outfit", "Halo", "Platinum trainers", "Prism launcher finish"],
  },
};
export const KIT_ORDER = ["escapee", "fracture"];
export const KIT_FOR_TROPHY = Object.fromEntries(Object.values(KITS).map((k) => [k.trophy, k]));

export function kitUnlocked(key) {
  const kit = KITS[key];
  return !kit || progress.has(kit.trophy);
}

/** An outfit / headwear / launcher finish (its table entry): still locked? */
export function kitLocked(item) {
  return Boolean(item?.kit) && !kitUnlocked(item.kit);
}

/** The keys of a table you can pick right now. */
export function unlockedKeys(table) {
  return Object.keys(table).filter((k) => !kitLocked(table[k]));
}
