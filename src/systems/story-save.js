/**
 * The story's saved game: the sector you last reached (as the story's own
 * checkpoint has it - score, spheres, the launcher's balls) and the
 * difficulty it is being played at. Written each time a New game or a
 * Continue reaches a sector, cleared when the story is finished (or a new
 * game is started). Kept in the browser.
 *
 *   writeSave({ stage, score, ammo, balls, difficulty })
 *   loadSave()  -> the save, or null
 *   clearSave()
 */

const KEY = "fractureRun.save";
const STAGES = ["foundry", "labs", "skyline", "roof"];

/** The sectors as the menu names them. */
export const SAVE_STAGE_NAMES = {
  foundry: "Sector 01 // The Foundry",
  labs: "Sector 02 // The Labs",
  skyline: "Sector 03 // The Skyline",
  roof: "The Roof",
};

export function loadSave() {
  try {
    const save = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!save || !STAGES.includes(save.stage)) return null;
    return save;
  } catch {
    return null;
  }
}

export function writeSave({ stage, score = 0, ammo = 0, balls = null, difficulty = "normal" }) {
  if (!STAGES.includes(stage)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ stage, score, ammo, balls, difficulty, savedAt: Date.now() }));
  } catch {}
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch {}
}
