# Credits and asset register

Every external resource in the project, per `CONTRIBUTING.md`: creator, source,
licence, modifications, and where it is used. Levels 1 and 2 use no external
assets (all procedural). Everything below is used by Level 3 and lives in
`assets/meltdown/`; conversion steps are in `tools/assets/README.md`.

> **Action needed before submission:** the four rows marked **TODO** came from
> downloads whose source site and licence can't be read from the files. Whoever
> downloaded them must fill in the source URL and licence, and confirm the
> licence allows use in a university project. The Poly Haven rows should also
> be confirmed against the actual download pages.

## Models

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

## Characters, weapons, and vehicles (Sketchfab, CC-BY-4.0)

Author, source and licence below were read from each file's embedded glTF
metadata. **CC-BY-4.0 requires attribution** (author, link, licence, and a note
of changes) wherever the work is shown - so these must also appear in the
game's credits screen, not only here. All were converted with
`tools/assets/convert.py` (textures cut to 1024 px, 512 px for the Colossus
scientist; rigs preserved) and renamed as shown.

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

All licensed **CC-BY-4.0** (creativecommons.org/licenses/by/4.0/). The ones
the game uses are credited in game (press `K` in the preview; the data is
`src/levels/meltdown/credits.js` - keep it in step with this table).
`dead_end_weapons.glb`, `weapon_set.glb` and `dragon_flail.glb` are not used
yet.

> **Worth a team decision:** four of these are fan recreations of commercial
> games/franchises (Silent Hill 4, Wolfenstein: The New Colossus, Rust,
> Skibidi Toilet). The uploader's CC-BY licence covers *their* model, not the
> original character designs. Usually fine for a non-commercial university
> project, but if the game is ever published, swap these for original or
> generic models.

## Not external

- Fire and smoke: custom GLSL shaders (`src/levels/meltdown/fire.js`).
- Audio: synthesized live with the Web Audio API (`src/audio/meltdown-audio.js`) - no sample files.
- All wall/floor/signage textures: generated on canvas at runtime (`src/levels/meltdown/textures.js`).
- Sky, smoke ceiling, launcher beam, grading pass: custom GLSL (`src/levels/meltdown/roof.js`, `smoke.js`, `flashlight.js`, `post.js`).
- Three.js r160 (MIT) and its examples/jsm add-ons (GLTFLoader, EffectComposer, UnrealBloomPass, OutputPass, ShaderPass, RoomEnvironment, BufferGeometryUtils, SkeletonUtils), loaded from jsDelivr.
