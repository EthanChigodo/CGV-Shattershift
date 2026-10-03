# Asset conversion

The supplied source models (Blender `.blend`, `.fbx`, `.obj`) are converted to
web-ready `.glb` files in `assets/meltdown/` with Blender run headless. Nobody
has to open Blender by hand; re-running these commands reproduces every file.

Requires Blender 4.x or 5.x (`winget install BlenderFoundation.Blender`).

```text
blender -b --factory-startup --python tools/assets/convert.py -- <source> <out.glb> [maxTex] [maxTris] [--only=Obj1,Obj2] [--info]
```

- `maxTex` - longest texture edge after resizing (512 for small props, 1024 otherwise). The Poly Haven sources ship 4K EXR maps, which glTF cannot carry and a browser game cannot afford.
- `maxTris` - any mesh above this gets a Decimate modifier.
- `--only=` - export just the named objects (the barrier file holds 5 LODs of one object; the fence and duct files are modular kits laid out side by side).
- `--info` - print/write a JSON summary instead of exporting.

The Javelin launcher needs its own script because its FBX points at texture paths that don't exist; `javelin.py` rewires all three materials to the supplied diffuse + normal maps:

```text
blender -b --factory-startup --python tools/assets/javelin.py -- Jav3.FBX "<textures folder>" assets/meltdown/launcher.glb
```

## What was exported from what

| Output | Source | Notes |
| --- | --- | --- |
| `ceiling_fan.glb` | ceiling_fan_4k.blend | 512 px |
| `concrete_barrier.glb` | concrete_road_barrier_02_4k.blend | `--only=concrete_road_barrier_02_LOD2` |
| `microscope.glb` | industrial_microscope_4k.blend | 512 px |
| `office_desk.glb` | metal_office_desk_4k.blend | |
| `chainlink_fence.glb` | modular_chainlink_fence_4k.blend | `--only=modular_chainlink_fence_double` |
| `security_camera.glb` | security_camera_01_4k.blend | 512 px |
| `steel_shelves.glb` | steel_frame_shelves_01_4k.blend | |
| `utility_box.glb` | utility_box_02_4k.blend | 512 px |
| `duct_straight.glb` | Ventilation System.obj | `--only=Cube.004` (the 6 m straight) |
| `vent_grille.glb` | Ventilation System.obj | `--only=Plane` |
| `vent_fan.glb` | Ventilation System/Fan/Fan.obj | |
| `launcher.glb` | Jav3.FBX | via `javelin.py` |
| `alarm_light.glb` | Bec-Alarma-Rosu-High-Poly.fbx | 3000 tris |
| `industrial_pipes.glb` | Geothermal Steam Factory_Blender_2.8.blend | `--only=pipes_Low.001`; its lava-red emission is switched off at load (assets.js) |
| `experiment_ring.glb` | Geothermal Steam Factory_Blender_2.8.blend | `--only=Ring_Low` |

### Second batch: Sketchfab `.glb` downloads

`convert.py` also imports `.glb`/`.gltf`, and keeps armatures selected so rigged
models export *with* their skeletons (verified: all 6 rigs survived). None of
these files contain animations.

| Output | Source file | Settings | Rigged |
| --- | --- | --- | --- |
| `player_female.glb` | scp_scientist_female_2.glb | 1024, 12000 | No |
| `player_male.glb` | scp_scientist_male_2.glb | 1024, 12000 | No |
| `scientist_radioman.glb` | scientist_radiomanskibidi_toilet.glb | 1024, 12000 | Yes |
| `scientist_rust.glb` | rust_scientist_blue.glb | 1024, 10000 | Yes |
| `patient.glb` | patient_-_silent_hill_4.glb | 1024, 8000 | Yes |
| `helicopter.glb` | hind_attack_helicopter.glb | 1024, 8000 | No |
| `weapon.glb` | weapon.glb | 1024, 8000 | No |
| `steampunk_weapon.glb` | steampunk_weapon.glb | 1024, 8000 | No |
| `dead_end_weapons.glb` | dead_end_weapons.glb | 1024, 8000 | Yes (2) |
| `weapon_set.glb` | weapon_set.glb | 1024, 8000 | No |
| `dragon_flail.glb` | dragon_flail.glb | 1024, 8000 | No |
| `scientist_good.glb` | good_scientist.glb | 1024, 10000 | Yes (82 bones) |
| `scientist_evil.glb` | evil_scientist.glb | 1024, 10000, `--no-morph` | Yes (81 bones) |

Two extra `convert.py` flags exist for cases like the last two rows:

- `--no-morph` drops shape keys. `evil_scientist.glb` ships with 428 facial
  morph targets, which made the export 4.1 MB instead of 1 MB and would have
  Three.js evaluate a 428-entry influence array every frame for nothing a
  runner game can show.
- `--anim` keeps animation clips (the default strips them, since none of the
  supplied models had a useful one). It is **not** usable on
  `evil_scientist.glb`: its only clip, `MorphBake`, is four morph-weight
  channels over 10 s (no skeletal motion), and Blender 5.2's glTF exporter
  crashes (`KeyError: None`) while gathering it. Neither character has an
  idle/walk/run clip, so both need animating in code like the other
  characters (see `src/levels/meltdown/characters.js`).

~238 MB of source became ~22 MB. Units vary wildly between files (the
characters are in centimetres, the helicopter is ~1,900 units long, the
steampunk weapon ~3.5 cm) - that is fine, `fillAssetSlots` scales everything by
measured size. Rigged meshes were not decimated (it can tear skin weights).

### Third batch: heavy scenes, a kit and a scan

Some of these were far beyond `convert.py` (a 737 fuselage with thousands of
objects, a 3,367-object rooftop kit, a multi-million-triangle photogrammetry
scan), so three more scripts:

| Script | What it does |
| --- | --- |
| `convert_heavy.py` | One shared decimation ratio to a total `--tris` budget, `--drop` tiny objects, `--keep-x` a slice (e.g. a cockpit out of a fuselage), `--keep-box`, `--join` per material, `--weld` (merge by distance after joining - closes a scan's seams), `--smooth` by angle, `--max-size`, `--render` a preview PNG. Custom split normals are cleared before decimating (otherwise the result looks shredded). |
| `extract_kit.py` | Pulls named groups out of a modular kit into one `.glb` each, re-centred (bottom at y = 0), planar-decimated then collapsed to a per-piece budget. Unparents before applying the world matrix (otherwise pieces land in the wrong place). |
| `heightmap.py` | Casts rays straight down over a model on a grid (BVH) and writes the highest hit per cell as JSON (+ a grey PNG): the roof's walkable floor, sampled by `roof.js`. Holes in it are filled in JS (`fillScanHoles`). |

| Output | Source file | How |
| --- | --- | --- |
| `backpack.glb` | military_backpack.glb | `convert_heavy.py`, 1024 px |
| `duffel_bag.glb` | military_duffel_bag.glb | `convert.py`, 1024 px |
| `police_helicopter.glb` | dolphin_helicopter_as-365harbin_z-9.glb | `convert.py`, 1024 px, rig kept (baked to static parts at load in `src/fx/police-helicopters.js`) |
| `city_night.glb` | city_at_night_low_poly_skyscrapers.glb | `convert.py`, 1024 px |
| `roof_hvac*.glb`, `roof_tank.glb`, `roof_dish2.glb`, `roof_mast*.glb` | sci-fi_rooftops.glb | `extract_kit.py`; the pipe walkways were dropped (5 MB) |
| `brute.glb` | two-headed_chained_brute_-_dungeon_horror.glb | `convert_heavy.py --tris=140000 --smooth` (34k still looked torn) |
| `operating_room.glb` | charite_university_hospital_-_operating_room.glb | `convert_heavy.py`, 4.5 MB |
| `roof_scan.glb` | le_radeau_de_la_meduse_2019.glb | `convert_heavy.py --join --weld --tris=100000 --tex=512`, 7.1 MB |
| `roof_scan_heights.json` | roof_scan.glb | `heightmap.py` |

Draco compression would shrink the big four a lot, but Three.js' Draco decoder
isn't vendored in `lib/three` and adding it means a download - not done.

Not used: `boeing_737-800_cockpit.glb` (converted, then dropped - a whole
airliner flight deck doesn't fit the helicopter's cabin; see the handoff
notes); the supplied smoke `.glb` (3,459 separately animated planes - about
3,500 draw calls a frame; the level's fire/smoke are a custom shader instead).
