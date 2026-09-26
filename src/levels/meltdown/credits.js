/**
 * In-game credits for Level 3's external models.
 *
 * The Sketchfab models are CC-BY-4.0, which requires attribution - author,
 * source, licence and a note of changes - wherever the work is shown, i.e. in
 * the game itself and not only in docs/credits.md. This is that list, as
 * data, so the preview and the main game's credits screen render the same
 * thing. Keep it in step with docs/credits.md.
 */

export const MELTDOWN_CREDITS = [
  { title: "SCP Scientist Female 2", author: "Maxime66410", url: "https://sketchfab.com/3d-models/scp-scientist-female-2-276e685db9fc4dfe9c9e35b855d05731", licence: "CC BY 4.0", changes: "Textures resized and atlased, recoloured to patient scrubs, animated in a custom shader", use: "Player (female)" },
  { title: "SCP Scientist Male 2", author: "Maxime66410", url: "https://sketchfab.com/3d-models/scp-scientist-male-2-c281bdc259ae46ba88e65ddb81e6a10a", licence: "CC BY 4.0", changes: "Textures resized and atlased, recoloured to patient scrubs, animated in a custom shader", use: "Player (male)" },
  { title: "Patient - Silent Hill 4", author: "many-bees", url: "https://sketchfab.com/3d-models/patient-silent-hill-4-5064bde886544cb18bba4da196ee080c", licence: "CC BY 4.0", changes: "Textures resized and atlased, hand bones repaired, procedurally animated", use: "Test subjects" },
  { title: "Scientist_radioman(skibidi_toilet)", author: "SwRasKyy", url: "https://sketchfab.com/3d-models/scientist-radiomanskibidi-toilet-5aa19de185a0423c9f453b3fc7fb607b", licence: "CC BY 4.0", changes: "Textures resized and atlased, procedurally animated", use: "Roof scientist" },
  { title: "Rust Scientist (Blue)", author: "Homless_Models", url: "https://sketchfab.com/3d-models/rust-scientist-blue-8040c84dc0194e47b9be7f73db6ffdcb", licence: "CC BY 4.0", changes: "Textures resized and atlased, procedurally animated", use: "Roof scientist" },
  { title: "Hind Attack Helicopter", author: "Ashley Aslett", url: "https://sketchfab.com/3d-models/hind-attack-helicopter-bb65bdfde2c54007a52dfbe1d91d930d", licence: "CC BY 4.0", changes: "Weapons removed, meshes merged, rotors separated to spin, textures resized", use: "Rescue helicopter" },
  { title: "Weapon", author: "Panoramma32", url: "https://sketchfab.com/3d-models/weapon-d418f1404556408fb065d075ffd2c1c4", licence: "CC BY 4.0", changes: "Textures resized, meshes merged", use: "Scientist's gadget" },
  { title: "Steampunk weapon", author: "MakakaObami", url: "https://sketchfab.com/3d-models/steampunk-weapon-696c79424c1d4b3a84112838d9091dd1", licence: "CC BY 4.0", changes: "Re-exported, meshes merged, brass material", use: "Scientist's gadget" },
  { title: "Security camera, utility box, concrete barrier, office desk, steel shelves, chain-link fence, ceiling fan, industrial microscope", author: "Poly Haven", url: "https://polyhaven.com/models", licence: "CC0", changes: "Converted to .glb, textures resized, some decimated", use: "Set dressing" },
  { title: "Ventilation kit, Javelin launcher, alarm light, geothermal plant (pipes, ring)", author: "See docs/credits.md", url: "", licence: "See docs/credits.md", changes: "Converted to .glb, decimated", use: "Ducts, launcher, beacons, pipes, experiment ring" },
];

/** A plain DOM panel listing the credits; toggled by the host. */
export function createCreditsPanel(container = document.body) {
  const panel = document.createElement("section");
  panel.className = "mlt-credits";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Credits");
  const rows = MELTDOWN_CREDITS.map(
    (c) => `<li><b>${c.title}</b> by ${c.author}${c.url ? ` - <a href="${c.url}" target="_blank" rel="noopener">${c.url.replace(/^https:\/\//, "")}</a>` : ""}<br><span>${c.licence} // ${c.changes} // ${c.use}</span></li>`
  ).join("");
  panel.innerHTML = `<div class="mlt-credits-card"><h2>Credits - Level 3</h2><ul>${rows}</ul><p>Fire, smoke, sky, textures and all audio are generated in code. Three.js (MIT).</p><small>PRESS K OR CLICK TO CLOSE</small></div>`;
  panel.addEventListener("pointerdown", (event) => {
    if (event.target.tagName !== "A") {
      event.stopPropagation();
      panel.hidden = true;
    }
  });
  container.append(panel);
  return {
    panel,
    toggle(force) {
      panel.hidden = force === undefined ? !panel.hidden : !force;
    },
  };
}
