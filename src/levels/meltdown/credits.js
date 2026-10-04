/**
 * In-game credits for Level 3's external models.
 *
 * The Sketchfab models are CC-BY-4.0, which requires attribution - author,
 * source, licence and a note of changes - wherever the work is shown, i.e. in
 * the game itself and not only in docs/credits.md. This is that list, as
 * data, so the preview and the main game's credits screen render the same
 * thing. Keep it in step with docs/credits.md.
 */

/**
 * `assets` names the loader keys (assets.js) each entry covers, so a check
 * can prove that every model the game loads is credited.
 */
export const MELTDOWN_CREDITS = [
  { title: "SCP Scientist Female 2", author: "Maxime66410", url: "https://sketchfab.com/3d-models/scp-scientist-female-2-276e685db9fc4dfe9c9e35b855d05731", licence: "CC BY 4.0", changes: "Textures resized and atlased, recoloured to patient scrubs, animated in a custom shader", use: "Player (female)", assets: ["playerFemale"] },
  { title: "SCP Scientist Male 2", author: "Maxime66410", url: "https://sketchfab.com/3d-models/scp-scientist-male-2-c281bdc259ae46ba88e65ddb81e6a10a", licence: "CC BY 4.0", changes: "Textures resized and atlased, recoloured to patient scrubs, animated in a custom shader", use: "Player (male)", assets: ["playerMale"] },
  { title: "Patient - Silent Hill 4", author: "many-bees", url: "https://sketchfab.com/3d-models/patient-silent-hill-4-5064bde886544cb18bba4da196ee080c", licence: "CC BY 4.0", changes: "Textures resized and atlased, hand bones repaired, procedurally animated", use: "Test subjects", assets: ["patient"] },
  { title: "Scientist_radioman(skibidi_toilet)", author: "SwRasKyy", url: "https://sketchfab.com/3d-models/scientist-radiomanskibidi-toilet-5aa19de185a0423c9f453b3fc7fb607b", licence: "CC BY 4.0", changes: "Textures resized and atlased, procedurally animated", use: "Roof scientist", assets: ["scientistRadioman"] },
  { title: "Rust Scientist (Blue)", author: "Homless_Models", url: "https://sketchfab.com/3d-models/rust-scientist-blue-8040c84dc0194e47b9be7f73db6ffdcb", licence: "CC BY 4.0", changes: "Textures resized and atlased, procedurally animated", use: "Roof scientist", assets: ["scientistRust"] },
  { title: "scientist", author: "Geont (Sketchfab: Fungler)", url: "https://sketchfab.com/3d-models/scientist-ed65738d0ed44e0ba8493af2d1a5112b", licence: "CC BY 4.0", changes: "Textures resized and atlased, procedurally animated", use: "Dr. Okoro (story)", assets: ["scientistGood"] },
  { title: "Scientist", author: "Scientist Broken (Sketchfab: ultra700cybercam)", url: "https://sketchfab.com/3d-models/scientist-4d3ce8401dd74121b691c6a82a486f3c", licence: "CC BY 4.0", changes: "Facial morph targets removed, textures resized and atlased, procedurally animated", use: "Dr. Vale (story)", assets: ["scientistEvil"] },
  { title: "Hind Attack Helicopter", author: "Ashley Aslett", url: "https://sketchfab.com/3d-models/hind-attack-helicopter-bb65bdfde2c54007a52dfbe1d91d930d", licence: "CC BY 4.0", changes: "Weapons removed, meshes merged, rotors separated to spin, textures resized", use: "Rescue helicopter", assets: ["helicopter"] },
  { title: "Weapon", author: "Panoramma32", url: "https://sketchfab.com/3d-models/weapon-d418f1404556408fb065d075ffd2c1c4", licence: "CC BY 4.0", changes: "Textures resized, meshes merged", use: "Scientist's gadget", assets: ["gadgetCoil"] },
  { title: "Steampunk weapon", author: "MakakaObami", url: "https://sketchfab.com/3d-models/steampunk-weapon-696c79424c1d4b3a84112838d9091dd1", licence: "CC BY 4.0", changes: "Re-exported, meshes merged, brass material", use: "Scientist's gadget", assets: ["gadgetBrass"] },
  { title: "Security camera, utility box, concrete barrier, office desk, steel shelves, chain-link fence, ceiling fan, industrial microscope", author: "Poly Haven", url: "https://polyhaven.com/models", licence: "CC0", changes: "Converted to .glb, textures resized, some decimated", use: "Set dressing", assets: ["securityCamera", "utilityBox", "concreteBarrier", "officeDesk", "steelShelves", "chainlinkFence", "ceilingFan", "microscope"] },
  { title: "Ventilation kit, Javelin launcher, alarm light, geothermal plant (pipes, ring)", author: "See docs/credits.md", url: "", licence: "See docs/credits.md", changes: "Converted to .glb, decimated", use: "Ducts, launcher, beacons, pipes, experiment ring", assets: ["ductStraight", "ventGrille", "ventFan", "launcher", "alarmLight", "industrialPipes", "experimentRing"] },
  // The second batch (models the team supplied for the story's later changes).
  { title: "Military Backpack", author: "Neslihan Çakmak", url: "https://sketchfab.com/3d-models/military-backpack-06be5c0f15aa4aa3af8ebcc4c83d02a3", licence: "CC BY 4.0", changes: "Decimated, textures resized", use: "Dr. Okoro's bag of spheres (worn by the player)", assets: ["backpack"] },
  { title: "Military Duffel bag", author: "Sousinho", url: "https://sketchfab.com/3d-models/military-duffel-bag-d69478f0c5334e189e98f99e84bbe3e6", licence: "CC BY 4.0", changes: "Textures resized", use: "Sphere sacks", assets: ["duffelBag"] },
  { title: "Dolphin Helicopter (AS-365/Harbin Z-9)", author: "Martini-SF", url: "https://sketchfab.com/3d-models/dolphin-helicopter-as-365harbin-z-9-d27aaf297dc94a3abb31571217179612", licence: "CC BY-NC 4.0", changes: "Baked to static parts, repainted in police livery, rotor blades rebuilt, textures resized", use: "Police helicopters", assets: ["policeHelicopter"] },
  { title: "city at night low poly skyscrapers", author: "dasy444", url: "https://sketchfab.com/3d-models/city-at-night-low-poly-skyscrapers-dc1294de66194054961c16aa74fda2cb", licence: "Sketchfab Standard", changes: "Textures resized, sky dome hidden", use: "The city (briefing)", assets: ["cityNight"] },
  { title: "SCI-FI Rooftops", author: "Quadra3D", url: "https://sketchfab.com/3d-models/sci-fi-rooftops-8f8a0ba6325a43afbdadd3c7687c953a", licence: "CC BY 4.0", changes: "Kit split into separate pieces, decimated, repainted", use: "The roof's plant: air handlers, a water tank, a dish, masts", assets: ["roofHvac", "roofHvac2", "roofHvac3", "roofTank", "roofDish2", "roofMast", "roofMast2"] },
  { title: "Two-Headed Chained Brute - Dungeon Horror", author: "Pigcraft", url: "https://sketchfab.com/3d-models/two-headed-chained-brute-dungeon-horror-d6abe131426b4dab9c126481030ebf8b", licence: "CC BY 4.0", changes: "Decimated, re-shaded, textures resized, animated in code", use: "The brute (the roof)", assets: ["brute"] },
  { title: "Charité University Hospital - Operating Room", author: "ChrisRE", url: "https://sketchfab.com/3d-models/charite-university-hospital-operating-room-9ec46c4d615a4581a235eebfb162f574", licence: "CC BY-NC 4.0", changes: "Decimated, textures resized", use: "The operating theatre (briefing)", assets: ["operatingRoom"] },
  { title: "Le Radeau de la Méduse 2019", author: "234D", url: "https://sketchfab.com/3d-models/le-radeau-de-la-meduse-2019-60039ce2f5ac4225880bfd837e3e3932", licence: "CC BY 4.0", changes: "Decimated, textures resized, scaled up; walkable heights baked from it", use: "The roof (the finale)", assets: ["roofScan"] },
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
  panel.innerHTML = `<div class="mlt-credits-card"><h2>Credits - models</h2><ul>${rows}</ul><p>Fire, smoke, sky, textures and the synthesised sounds are generated in code. Three.js (MIT).</p><small>PRESS K OR CLICK TO CLOSE</small></div>`;
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
