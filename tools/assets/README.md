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

Not used: the supplied smoke `.glb` (3,459 separately animated planes - about
3,500 draw calls a frame; the level's fire/smoke are a custom shader instead).
