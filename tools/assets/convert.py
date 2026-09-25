"""
Headless asset conversion for Shattershift Level 3.

    blender -b --factory-startup --python convert.py -- <src> <out.glb> [maxTex] [maxTris] [--info]

Opens a .blend / imports an .fbx / .obj, downsizes every texture to <= maxTex,
decimates any mesh over maxTris triangles, and exports one web-ready .glb with
JPEG textures. With --info it only prints a JSON summary of the scene.
"""
import bpy, sys, os, json, math

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
max_tex = int(argv[2]) if len(argv) > 2 else 1024
max_tris = int(argv[3]) if len(argv) > 3 else 20000
info_only = "--info" in argv

ext = os.path.splitext(src)[1].lower()
if ext == ".blend":
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=src)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=src)

def tri_count(obj):
    return sum(max(1, len(p.vertices) - 2) for p in obj.data.polygons)

only = next((a.split("=", 1)[1].split(",") for a in argv if a.startswith("--only=")), None)
in_layer = set(o.name for o in bpy.context.view_layer.objects)
meshes = [o for o in bpy.context.scene.objects
          if o.type == "MESH" and o.name in in_layer and (only is None or o.name in only)]
# A filtered-out object must not ride along into the export via selection.
if only is not None:
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    # Modular kits lay pieces out across the scene; bring the kept ones home.
    for o in meshes:
        if o.parent is None:
            o.location = (0, 0, 0)

summary = {"src": os.path.basename(src), "objects": [], "images": []}
for o in meshes:
    dims = o.dimensions
    summary["objects"].append({
        "name": o.name, "tris": tri_count(o), "dims": [round(d, 3) for d in dims],
        "materials": [s.material.name for s in o.material_slots if s.material],
    })
for img in bpy.data.images:
    summary["images"].append({"name": img.name, "size": list(img.size), "path": img.filepath})

if info_only:
    with open(out + ".json", "w") as f:
        json.dump(summary, f, indent=1)
    print("SUMMARY_JSON " + json.dumps(summary))
    sys.exit(0)

# 1. Downsize textures. glTF cannot carry EXR, so every image is re-encoded
#    to JPEG by the exporter anyway; shrinking first keeps the .glb small.
for img in bpy.data.images:
    w, h = img.size
    if w == 0 or h == 0:
        continue
    if max(w, h) > max_tex:
        s = max_tex / max(w, h)
        img.scale(max(1, int(w * s)), max(1, int(h * s)))

# 2. Decimate anything too heavy for a browser game.
for o in meshes:
    t = tri_count(o)
    if t > max_tris:
        mod = o.modifiers.new("web_decimate", "DECIMATE")
        mod.ratio = max(0.02, max_tris / t)

# 3. Export selected meshes only (no cameras/lights from the source scene).
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.hide_set(False)
    o.hide_viewport = False
    o.select_set(True)
if meshes:
    bpy.context.view_layer.objects.active = meshes[0]

os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_image_format="JPEG",
    export_jpeg_quality=82,
    export_cameras=False,
    export_lights=False,
    export_animations=False,
)
summary["out_bytes"] = os.path.getsize(out)
summary["tris_after"] = sum(min(tri_count(o), max_tris) for o in meshes)
print("SUMMARY_JSON " + json.dumps(summary))
