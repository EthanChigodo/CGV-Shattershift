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

## Not external

- Fire and smoke: custom GLSL shaders (`src/levels/meltdown/fire.js`).
- Audio: synthesized live with the Web Audio API (`src/audio/meltdown-audio.js`) - no sample files.
- All wall/floor/signage textures: generated on canvas at runtime (`src/levels/meltdown/textures.js`).
- Three.js r160 (MIT) and its examples/jsm add-ons (GLTFLoader, EffectComposer, UnrealBloomPass, OutputPass, RoomEnvironment, BufferGeometryUtils), loaded from jsDelivr.
