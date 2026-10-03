"""
Headless conversion for very heavy Sketchfab scenes (millions of triangles,
thousands of objects, 8K textures) that convert.py can't bring down far enough.

    blender -b --factory-startup --python convert_heavy.py -- <src.glb> <out.glb> --tris=N [--tex=1024]
        [--drop=0.05] [--keep-x=a,b] [--join] [--no-morph] [--render=preview.png]

- `--tris=N`  total triangle budget; every mesh is decimated by one shared ratio
              (meshes under 64 tris are left alone).
- `--drop=S`  delete objects whose largest dimension is under S (scene units,
              after applying transforms) - screws, bolts and labels the game
              will never show.
- `--keep-x=a,b`  keep only objects whose centre x lies in [a, b] (the 737 file
              is the whole fuselage; the game needs the cockpit).
- `--join`    join all meshes per material, so a 3,000-object scene becomes a
              handful of draw calls.
- `--render=` also write a top-down and a 3/4 preview render (for reading a
              layout without opening Blender).
"""
import bpy, sys, os, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
opt = {a.split("=", 1)[0][2:]: (a.split("=", 1)[1] if "=" in a else True) for a in argv[2:] if a.startswith("--")}
budget = int(opt.get("tris", 60000))
max_tex = int(opt.get("tex", 1024))
drop = float(opt.get("drop", 0))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

def tris(o):
    return sum(max(1, len(p.vertices) - 2) for p in o.data.polygons)

def world_bounds(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
before = sum(tris(o) for o in meshes)

# 1. Drop what the game will never show.
keep_x = [float(v) for v in opt["keep-x"].split(",")] if "keep-x" in opt else None
# --keep-box=x0,x1,y0,y1,z0,z1: only objects centred inside it.
keep_box = [float(v) for v in opt["keep-box"].split(",")] if "keep-box" in opt else None
# --max-size=S: drop objects bigger than S (an outer shell around an interior).
max_size = float(opt["max-size"]) if "max-size" in opt else None
removed = 0
for o in list(meshes):
    lo, hi = world_bounds(o)
    size = max(hi - lo)
    c = (lo + hi) / 2
    cx = c.x
    outside = keep_box and not (keep_box[0] <= c.x <= keep_box[1] and keep_box[2] <= c.y <= keep_box[3] and keep_box[4] <= c.z <= keep_box[5])
    if (drop and size < drop) or (keep_x and not (keep_x[0] <= cx <= keep_x[1])) or outside or (max_size and size > max_size):
        bpy.data.objects.remove(o, do_unlink=True)
        removed += 1
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]

# 2. Bake transforms into the meshes and drop the empties' hierarchy, so a
#    join or a decimate works in world space.
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.hide_set(False)
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
# Linked (instanced) mesh data can't take a transform; make each single-user.
bpy.ops.object.make_single_user(object=True, obdata=True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o.type == "EMPTY":
        bpy.data.objects.remove(o, do_unlink=True)
# With the transforms baked, anything still reaching outside the keep box goes too.
if keep_box:
    for o in list(meshes):
        lo, hi = world_bounds(o)
        if lo.x < keep_box[0] - 0.5 or hi.x > keep_box[1] + 0.5 or lo.y < keep_box[2] - 0.5 or hi.y > keep_box[3] + 0.5 or lo.z < keep_box[4] - 0.5 or hi.z > keep_box[5] + 0.5:
            meshes.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
            removed += 1

# 3. Join per material.
if opt.get("join"):
    by_mat = {}
    for o in meshes:
        key = o.material_slots[0].material.name if o.material_slots and o.material_slots[0].material else "_"
        by_mat.setdefault(key, []).append(o)
    joined = []
    for key, group in by_mat.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        if len(group) > 1:
            bpy.ops.object.join()
        group[0].name = "part_" + key[:24]
        joined.append(group[0])
    meshes = joined

# 3b. Stray vertices outside the keep box (some sources hide a few far away) go.
if keep_box:
    import bmesh
    for o in meshes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        far = [v for v in bm.verts if not (keep_box[0] - 0.5 <= v.co.x <= keep_box[1] + 0.5 and keep_box[2] - 0.5 <= v.co.y <= keep_box[3] + 0.5 and keep_box[4] - 0.5 <= v.co.z <= keep_box[5] + 0.5)]
        if far:
            bmesh.ops.delete(bm, geom=far, context="VERTS")
            bm.to_mesh(o.data)
        bm.free()

# 3c. --weld: merge coincident vertices first. Scans come as many separate
#     patches; decimating them unwelded pulls the patches apart and leaves
#     holes all over the surface. (UVs live on face corners, so they survive.)
if opt.get("weld"):
    import bmesh
    # One object (several materials) so patches weld across texture borders too.
    if len(meshes) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        meshes = [bpy.context.view_layer.objects.active]
    for o in meshes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=float(opt.get("weld-dist", 0.002)) if isinstance(opt.get("weld"), bool) else float(opt["weld"]))
        bm.to_mesh(o.data)
        bm.free()

# 4. One shared decimation ratio for the whole scene.
total = sum(tris(o) for o in meshes)
ratio = min(1.0, budget / max(1, total))
if ratio < 1:
    for o in meshes:
        if tris(o) < 64:
            continue
        m = o.modifiers.new("web_decimate", "DECIMATE")
        m.ratio = max(0.004, ratio)
        m.use_collapse_triangulate = True
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            if m.type == "DECIMATE":
                bpy.ops.object.modifier_apply(modifier=m.name)
after = sum(tris(o) for o in meshes)

# Decimation leaves the source's custom split normals pointing anywhere,
# which renders as a shredded, faceted surface: clear them and re-shade
# (smooth below --smooth degrees, default 35).
smooth = float(opt.get("smooth", 35))
for o in meshes:
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    try:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception:
        pass
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(smooth))
    except Exception:
        pass

# 5. Textures.
for img in bpy.data.images:
    w, h = img.size
    if w and h and max(w, h) > max_tex:
        s = max_tex / max(w, h)
        img.scale(max(1, int(w * s)), max(1, int(h * s)))

lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    a, b = world_bounds(o)
    lo = Vector(map(min, lo, a)); hi = Vector(map(max, hi, b))

# 6. Optional preview renders (Workbench, so it's quick and needs no lights).
if opt.get("render"):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1000
    centre = (lo + hi) / 2
    span = max(hi - lo)
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    base = opt["render"].rsplit(".", 1)[0]
    shots = {
        "top": (centre + Vector((0, 0, span * 1.4)), (0, 0, 0)),
        "persp": (centre + Vector((span * 0.9, -span * 0.9, span * 0.7)), None),
        "side": (centre + Vector((0, -span * 1.5, (hi.z - lo.z) * 0.4)), None),
    }
    for name, (pos, rot) in shots.items():
        cam.location = pos
        if rot is None:
            d = centre - pos
            cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        else:
            cam.rotation_euler = rot
        cam_data.type = "ORTHO" if name == "top" else "PERSP"
        cam_data.ortho_scale = span * 1.1
        cam_data.lens = 30
        cam_data.clip_end = span * 20
        scene.render.filepath = f"{base}_{name}.png"
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)

bpy.ops.object.select_all(action="DESELECT")
for o in bpy.context.scene.objects:
    if o.type in ("MESH", "ARMATURE"):
        o.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB", use_selection=True, export_apply=True,
    export_image_format="JPEG", export_jpeg_quality=82, export_cameras=False,
    export_lights=False, export_animations=False, export_skins=True,
    export_morph=not opt.get("no-morph"),
)
print("SUMMARY_JSON " + json.dumps({
    "src": os.path.basename(src), "removed": removed, "before": before, "after": after,
    "parts": len(meshes), "bounds": [[round(v, 2) for v in lo], [round(v, 2) for v in hi]],
    "bytes": os.path.getsize(out),
}))
