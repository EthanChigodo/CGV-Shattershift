# Credits and asset register

Documentation set item 6, per `CONTRIBUTING.md`: every external resource,
library, technique, and tool used in the project, with its source, licence,
modifications, and where it is used. Add to this file whenever anything
external enters the repository.

Levels 1 and 2 use no external assets - all geometry is Three.js primitives
and all textures are drawn at runtime. Level 3 is the exception: it uses
external models, converted and listed below (`assets/meltdown/`; conversion
steps in `tools/assets/README.md`).

> **Action needed before submission:** the four rows marked **TODO** in the
> Level 3 models table came from downloads whose source site and licence
> can't be read from the files. Whoever downloaded them must fill in the
> source URL and licence, and confirm the licence allows use in a university
> project. The Poly Haven rows should also be confirmed against the actual
> download pages.

---

## 1. Libraries

| Asset | Creator | Source | Licence | Modifications | Used in |
| --- | --- | --- | --- | --- | --- |
| Three.js r160 | Three.js authors | https://threejs.org - r160 copied from the `three@0.160.0` npm package into `lib/three/` (with its LICENSE) | MIT | None | Whole game, imported only through `src/three.js` (core) and `src/three-addons.js` (GLTFLoader, EffectComposer, UnrealBloomPass, OutputPass, ShaderPass, RoomEnvironment, BufferGeometryUtils, SkeletonUtils) |
| Playwright (dev only, not shipped) | Microsoft | https://playwright.dev | Apache 2.0 | None | `tests/` harnesses |

## 2. Level 3 models

Every external resource used by Level 3, per `CONTRIBUTING.md`: creator,
source, licence, modifications, and where it is used. Lives in
`assets/meltdown/`; conversion steps are in `tools/assets/README.md`.

| Asset (file) | Creator / source | Licence | Modifications | Used in |
| --- | --- | --- | --- | --- |
| Security camera (`security_camera.glb`) | Poly Haven - polyhaven.com/a/security_camera_01 (confirm) | CC0 | Converted .blend -> .glb, textures 4K -> 512 px, decimated to 4k tris | Wall cameras in corridors and halls |
| Utility box (`utility_box.glb`) | Poly Haven - polyhaven.com/a/utility_box_02 (confirm) | CC0 | .glb, 512 px, 4k tris | Corridor walls, boiler hall |
| Concrete road barrier (`concrete_barrier.glb`) | Poly Haven - polyhaven.com/a/concrete_road_barrier_02 (confirm) | CC0 | LOD2 only, .glb, 1024 px | Low barriers (jump obstacles) |
| Metal office desk (`office_desk.glb`) | Poly Haven - polyhaven.com/a/metal_office_desk (confirm) | CC0 | .glb, 1024 px, meshes merged at load | Lab benches, sliding-desk obstacle |
| Steel frame shelves (`steel_shelves.glb`) | Poly Haven - polyhaven.com/a/steel_frame_shelves_01 (confirm) | CC0 | .glb, 1024 px | Shelving, archive hall, toppling-shelf obstacle |
| Modular chain-link fence (`chainlink_fence.glb`) | Poly Haven - polyhaven.com/a/modular_chainlink_fence (confirm) | CC0 | Double panel only, .glb, 1024 px | Containment pens, boiler hall cages |
| Ceiling fan (`ceiling_fan.glb`) | Poly Haven - polyhaven.com/a/ceiling_fan (confirm) | CC0 | .glb, 512 px | Ward and archive hall ceilings |
| Industrial microscope (`microscope.glb`) | Poly Haven - polyhaven.com/a/industrial_microscope (confirm) | CC0 | .glb, 512 px | Lab benches, sliding desk |
| Ventilation system - straight duct, grille (`duct_straight.glb`, `vent_grille.glb`) and fan (`vent_fan.glb`) | **TODO** - downloaded as `4n9j8dkxxi0w-VentilationSystem.rar` | **TODO** | Individual kit pieces exported separately, .glb | Falling/bridge ducts, ceiling duct runs, boiler hall fans |
| Javelin launcher (`launcher.glb`) | **TODO** - downloaded as `6ygizg34zqps-JavelineFinal.rar` | **TODO** | FBX -> .glb, materials rewired to supplied textures, decimated | The player's ball launcher |
| Alarm light (`alarm_light.glb`) | **TODO** - downloaded as `alarm-light.zip` (`Bec-Alarma-Rosu-High-Poly.fbx`) | **TODO** | FBX -> .glb, decimated to 3k tris | Rotating alarm beacons |
| Geothermal steam factory - pipes and ring (`industrial_pipes.glb`, `experiment_ring.glb`) | **TODO** - downloaded as `46-geothermal-steam-factory_blender.zip` | **TODO** | Two objects extracted from the scene; pipe emission disabled at load | Hall pipe walls; the experiment ring |

### Characters, weapons, and vehicles (Sketchfab, CC-BY-4.0)

Author, source and licence below were read from each file's embedded glTF
metadata. **CC-BY-4.0 requires attribution** (author, link, licence, and a note
of changes) wherever the work is shown - so these must also appear in the
game's credits screen, not only here. All were converted with
`tools/assets/convert.py` (textures cut to 1024 px; rigs preserved) and renamed as shown.

| File (renamed from) | Title / author / source | Modifications | Planned use |
| --- | --- | --- | --- |
| `player_female.glb` (scp_scientist_female_2) | "SCP Scientist Female 2" by Maxime66410 - sketchfab.com/3d-models/scp-scientist-female-2-276e685db9fc4dfe9c9e35b855d05731 | Textures 1024 px; at load: atlased, clothing recoloured to patient scrubs, animated by a vertex-shader rig | **Player (female, default)** |
| `player_male.glb` (scp_scientist_male_2) | "SCP Scientist Male 2" by Maxime66410 - sketchfab.com/3d-models/scp-scientist-male-2-c281bdc259ae46ba88e65ddb81e6a10a | Textures 1024 px; at load: as above | **Player (male)** |
| `scientist_radioman.glb` (scientist_radiomanskibidi_toilet) | "Scientist_radioman(skibidi_toilet)" by SwRasKyy - sketchfab.com/3d-models/scientist-radiomanskibidi-toilet-5aa19de185a0423c9f453b3fc7fb607b | Textures 1024 px, rig kept; at load: atlased into one mesh, procedurally animated | Phase B scientist (wave 1) |
| `scientist_rust.glb` (rust_scientist_blue) | "Rust Scientist (Blue)" by Homless_Models - sketchfab.com/3d-models/rust-scientist-blue-8040c84dc0194e47b9be7f73db6ffdcb | Textures 1024 px, rig kept; at load: atlased, procedurally animated | Phase B scientist (wave 2) |
| `patient.glb` (patient_-_silent_hill_4) | "Patient - Silent Hill 4" by many-bees - sketchfab.com/3d-models/patient-silent-hill-4-5064bde886544cb18bba4da196ee080c | Textures 1024 px, rig kept; at load: hand bones repaired (unit error), atlased into one mesh, procedurally animated | Specimen tanks and cells, lurching obstacles, watchers in the dark, roof rushers |
| `helicopter.glb` (hind_attack_helicopter) | "Hind Attack Helicopter" by Ashley Aslett - sketchfab.com/3d-models/hind-attack-helicopter-bb65bdfde2c54007a52dfbe1d91d930d | Textures 1024 px (from 44 MB); at load: weapons removed, airframe merged, rotors separated to spin | Phase B rescue helicopter |
| `weapon.glb` | "Weapon" by Panoramma32 - sketchfab.com/3d-models/weapon-d418f1404556408fb065d075ffd2c1c4 | Textures 1024 px (from 106 MB); meshes merged at load | Wave 2 scientist's gadget |
| `steampunk_weapon.glb` | "Steampunk weapon" by MakakaObami - sketchfab.com/3d-models/steampunk-weapon-696c79424c1d4b3a84112838d9091dd1 | Re-exported; meshes merged, brass material at load (it ships untextured) | Wave 1 scientist's gadget |
| `dead_end_weapons.glb` | "Dead end weapons" by Professor E12^2 - sketchfab.com/3d-models/dead-end-weapons-255e81ecd8f8407696c0ecc243823adc | Textures 1024 px, rigs kept | Enemy gadget candidate |
| `weapon_set.glb` | "Weapon set" by rudolfs - sketchfab.com/3d-models/weapon-set-cb2e607fc7734e6fbf84211b6a65912f | Re-exported | Enemy gadget candidate |
| `dragon_flail.glb` | "Dragon Flail" by Roeland Van Sichem De Combe - sketchfab.com/3d-models/dragon-flail-a1ddde08ead04e3aa271f0a9c8bc0088 | Re-exported | Melee enemy weapon candidate |
| `scientist_good.glb` (good_scientist) | "scientist" by Geont (Sketchfab user Fungler) - sketchfab.com/3d-models/scientist-ed65738d0ed44e0ba8493af2d1a5112b | Textures 1024 px, rig kept (82 bones) | Dr. Okoro, the ally scientist (`src/story/`) |
| `scientist_evil.glb` (evil_scientist) | "Scientist" by Scientist Broken (Sketchfab user ultra700cybercam) - sketchfab.com/3d-models/scientist-4d3ce8401dd74121b691c6a82a486f3c | Textures 1024 px, rig kept (81 bones); 428 facial morph targets and a 4-channel morph-weight clip ("MorphBake") stripped | Dr. Vale, the villain / pilot (`src/story/`) |

### Third batch: models for the story's later changes (Sketchfab)

Supplied by the team; author, source and licence read from each file's glTF
metadata. Converted with `tools/assets/convert_heavy.py`,
`extract_kit.py` and `heightmap.py` (see `tools/assets/README.md`).

| File | Title / author / source | Licence | Modifications | Used in |
| --- | --- | --- | --- | --- |
| `backpack.glb` | "Military Backpack" by Neslihan Çakmak - sketchfab.com/3d-models/military-backpack-06be5c0f15aa4aa3af8ebcc4c83d02a3 | CC BY 4.0 | Decimated, textures resized | Dr. Okoro's bag of spheres (the Foundry; worn by the player) |
| `duffel_bag.glb` | "Military Duffel bag" by Sousinho - sketchfab.com/3d-models/military-duffel-bag-d69478f0c5334e189e98f99e84bbe3e6 | CC BY 4.0 | Textures resized | Sphere sacks (the Labs) |
| `police_helicopter.glb` | "Dolphin Helicopter (AS-365/Harbin Z-9)" by Martini-SF - sketchfab.com/3d-models/dolphin-helicopter-as-365harbin-z-9-d27aaf297dc94a3abb31571217179612 | **CC BY-NC 4.0** | Skin baked to static parts, police livery, rotor blades rebuilt in code, textures resized | Police helicopters (Skyline, roof, briefing) |
| `city_night.glb` | "city at night low poly skyscrapers" by dasy444 - sketchfab.com/3d-models/city-at-night-low-poly-skyscrapers-dc1294de66194054961c16aa74fda2cb | **Sketchfab Standard** | Textures resized; its sky dome hidden | The city (briefing) |
| `roof_hvac.glb`, `roof_hvac2.glb`, `roof_hvac3.glb`, `roof_tank.glb`, `roof_dish2.glb`, `roof_mast.glb`, `roof_mast2.glb` | "SCI-FI Rooftops" by Quadra3D - sketchfab.com/3d-models/sci-fi-rooftops-8f8a0ba6325a43afbdadd3c7687c953a | CC BY 4.0 | Kit split into pieces, decimated, repainted at load; the pipe walkways dropped (too heavy) | Roof plant: air handlers, a tank, a dish, masts |
| `brute.glb` | "Two-Headed Chained Brute - Dungeon Horror" by Pigcraft - sketchfab.com/3d-models/two-headed-chained-brute-dungeon-horror-d6abe131426b4dab9c126481030ebf8b | CC BY 4.0 | Decimated to 140k tris, re-shaded, textures resized, animated in code | The brute (roof waves) |
| `operating_room.glb` | "Charité University Hospital - Operating Room" by ChrisRE - sketchfab.com/3d-models/charite-university-hospital-operating-room-9ec46c4d615a4581a235eebfb162f574 | **CC BY-NC 4.0** | Decimated, textures resized | The operating theatre (briefing) |
| `roof_scan.glb` + `roof_scan_heights.json` | "Le Radeau de la Méduse 2019" by 234D - sketchfab.com/3d-models/le-radeau-de-la-meduse-2019-60039ce2f5ac4225880bfd837e3e3932 (a photogrammetry scan of a rooftop) | CC BY 4.0 | Joined, welded, decimated to 100k tris, 512 px textures, scaled x1.4 in game; walkable height map baked from it | The roof (the finale) |

> **Licences worth a team decision:** CC BY-NC 4.0 (the police helicopter,
> the operating room) allows a non-commercial university project but not a
> commercial release. The city's **Sketchfab Standard** licence permits use
> in a project but not redistributing the model file itself - which a public
> repository does. Keep the repo private, or swap the city out before
> publishing. Not used: the two explosion downloads (`.rar` archives of
> Cinema 4D `.c4d` scenes, which no web pipeline can read - the explosions
> are made in code) and `sci-fi_rooftops.glb`'s pipe walkways.

All licensed **CC-BY-4.0** (creativecommons.org/licenses/by/4.0/) unless the
third batch's table says otherwise. The ones
the game uses are credited in game (press `K` in the preview; the data is
`src/levels/meltdown/credits.js` - keep it in step with this table).
`dead_end_weapons.glb`, `weapon_set.glb` and `dragon_flail.glb` are not used
yet - when one is wired in, add its entry to `credits.js` so the in-game
credits stay in step.

> **Worth a team decision:** three of these are fan recreations of commercial
> games/franchises (Silent Hill 4, Rust,
> Skibidi Toilet). The uploader's CC-BY licence covers *their* model, not the
> original character designs. Usually fine for a non-commercial university
> project, but if the game is ever published, swap these for original or
> generic models.

### Not external (Level 3)

- Fire and smoke: custom GLSL shaders (`src/levels/meltdown/fire.js`).
- Audio: synthesized live with the Web Audio API (`src/audio/meltdown-audio.js`) - no sample files.
- All wall/floor/signage textures: generated on canvas at runtime (`src/levels/meltdown/textures.js`).
- Sky, smoke bank, launcher beam, grading pass: custom GLSL (`src/levels/meltdown/roof.js`, `smoke.js`, `flashlight.js`, `post.js`).

## 3. Models, textures, sounds (Levels 1 and 2)

All geometry is built from Three.js primitives, and all textures are drawn at runtime (`src/levels/causeway/textures.js`, `src/levels/foundry/textures.js`).

Background music supplied to the project:

- Story briefing: `leberch-piano-story-601906.mp3` — Leberch.
- Main menu: `852268__holizna__trap-melody-loop-5-ebmin-165-bpm.wav` — Holizna.
- Level 1: `GalacticTemple.ogg` — source and licence details must be added by the asset supplier before release.

Level 1 sound effects supplied to the project:

- Fire: `vanzetpictures-fire-457848.mp3` — VanzetPictures.
- Solid impact: `sumaga123-wood-hit-432148.mp3` — Sumaga123.
- Sprinkler water: `fire_sprinkler_water_flow_splash.wav` — source and licence details pending.
- Glass shatter: `eaglaxle-glass-shattering-461637.mp3` — Eaglaxle.
- Opening containment-pod glass: `universfield-glass-bottle-breaking-351297.mp3` — Universfield.
- Falling object: `dragon-studio-falling-tree-356127.mp3` — Dragon Studio.
- Game over: `universfield-marimba-game-over-250960.mp3` — Universfield.
- Broken-glass footstep: `368343__johandeecke__glass-hit-32.wav` — JohanDeecke.
- Elevator: `wind1.wav` — source and licence details pending.
- Sphere throw: `floraphonic-swing-whoosh-9-198502.mp3` — Floraphonic.
- Sphere cache / serum collected: `floraphonic-arcade-ui-6-229503.mp3` — Floraphonic.
- Side-wall / ceiling ricochet: `freesound_community-wall-hit-1-100717.mp3` — Freesound Community.
- UI click: `justsomesounds-click-sound-432501.mp3` — JustSomeSounds.

Exact source URLs and licence terms for the supplied SFX must be recorded before release.

## 4. Published techniques

These are well-known graphics techniques, implemented in our own code. They are credited because the maths or the approach comes from published work.

| Technique | Source | Where |
| --- | --- | --- |
| Fresnel approximation | C. Schlick, "An Inexpensive BRDF Model for Physically-based Rendering", 1994 | Glass, shards |
| Snell's law refraction, Beer-Lambert absorption | Standard optics | Glass |
| Ray/box intersection (slab method) | T. Kay and J. Kajiya, "Ray Tracing Complex Scenes", SIGGRAPH 1986 | Fire |
| Smooth minimum, SDF normals by tetrahedral differences, 3D value noise from a 2D texture | Inigo Quilez, articles at https://iquilezles.org | Serum capsule, noise lattice |
| FXAA | T. Lottes, NVIDIA, 2009 | Composite pass |
| ACES filmic tone-mapping curve (fitted) | K. Narkowicz, 2016 | 360° capture |
| Gaussian blur with linear sampling | D. Rákos, 2010 | Bloom |
| Rodrigues' rotation formula | Standard mathematics | GPU shard physics |
| Sobel filter for normal maps | Standard image processing | Both levels' textures |

## 5. Tools and assistance

| Tool | Use | Note |
| --- | --- | --- |
| Claude (Anthropic AI assistant) | Helped write Level 1's and Level 3's code, shaders, tests and documentation | **Declare this according to the course's policy on AI assistance.** Every team member presenting a level should be able to explain the code; `docs/shaders-explained.md` and `docs/level-3-handoff.md` are written for that purpose |

## 6. Reference games (inspiration only, no assets used)

| Game | Developer | What we took |
| --- | --- | --- |
| Smash Hit | Mediocre AB | Throwing spheres, glass destruction, limited ammunition |
| Temple Run 2 | Imangi Studios | Chase camera, lanes, obstacle anticipation |
