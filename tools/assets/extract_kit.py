"""
Pull named pieces out of a modular kit scene (a Sketchfab .glb laid out side
by side) into one web-ready .glb each - for the sci-fi rooftop kit, whose
3,367 objects are a few dozen props (a hut, stair towers, water tanks,
dishes, air-conditioning units, pipe walkways, antennas).

    blender -b --factory-startup --python extract_kit.py -- <src.glb> <outdir> <out=Group:tris> [...] [--render]

- `Group` is the name (prefix) of a top-level group in the kit (they're named
  like "STC_3_3.Control_3029"; "STC_3_3" picks it).
- `tris` is that piece's triangle budget. Hard-surface parts are first
  planar-decimated (merging coplanar faces loses nothing), then collapsed if
  still over budget.
- Each piece is re-centred: bottom at y = 0, centred on x/z.
- Custom split normals are cleared and the piece is smooth-shaded by angle,
  so decimation can't leave the shredded, faceted look it otherwise does.
- `--render` writes <out>.png, a quick look at each piece.
"""
import bpy, sys, os, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, outdir = argv[0], argv[1]
render = "--render" in argv
specs = [a for a in argv[2:] if "=" in a and not a.startswith("--")]
os.makedirs(outdir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

def tris(o):
    return sum(max(1, len(p.vertices) - 2) for p in o.data.polygons)

def group_meshes(prefix):
    roots = [o for o in bpy.context.scene.objects if o.name.split(".")[0] == prefix or o.name.split("/")[0] == prefix]
    out = []
    for r in roots:
        for d in [r] + list(r.children_recursive):
            if d.type == "MESH" and d not in out:
                out.append(d)
    return out

report = []
for spec in specs:
    name, rest = spec.split("=", 1)
    prefix, budget = rest.split(":")
    budget = int(budget)
    meshes = group_meshes(prefix)
    if not meshes:
        report.append({"name": name, "error": "no meshes for " + prefix})
        continue
    # Copy the piece's meshes into a fresh object (the originals stay for the next spec).
    bpy.ops.object.select_all(action="DESELECT")
    copies = []
    for o in meshes:
        c = o.copy()
        c.data = o.data.copy()
        # Unparent first, then place: clearing the parent afterwards would
        # drop the parents' transforms (the kit's root carries a scale).
        c.parent = None
        c.matrix_world = o.matrix_world.copy()
        bpy.context.scene.collection.objects.link(c)
        copies.append(c)
    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(copies) > 1:
        bpy.ops.object.join()
    piece = bpy.context.view_layer.objects.active
    piece.name = name
    before = tris(piece)
    # Planar first: flat panels modelled with thousands of triangles collapse to a few.
    if before > budget:
        m = piece.modifiers.new("planar", "DECIMATE")
        m.decimate_type = "DISSOLVE"
        m.angle_limit = math.radians(2.0)
        m.use_dissolve_boundaries = False
        bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.quads_convert_to_tris()
        bpy.ops.object.mode_set(mode="OBJECT")
    mid = tris(piece)
    if mid > budget:
        m = piece.modifiers.new("collapse", "DECIMATE")
        m.ratio = max(0.002, budget / mid)
        bpy.ops.object.modifier_apply(modifier=m.name)
    # Clean shading: no stale custom normals, smooth only below 35 degrees.
    try:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception:
        pass
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    except Exception:
        pass
    # Bottom at 0, centred.
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for v in piece.data.vertices:
        w = piece.matrix_world @ v.co
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    piece.data.transform(__import__("mathutils").Matrix.Translation(-shift))
    piece.location = (0, 0, 0)
    out = os.path.join(outdir, name + ".glb")
    bpy.ops.object.select_all(action="DESELECT")
    piece.select_set(True)
    bpy.context.view_layer.objects.active = piece
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_apply=True,
                              export_image_format="JPEG", export_cameras=False, export_lights=False, export_animations=False)
    size = hi - lo
    report.append({"name": name, "group": prefix, "before": before, "after": tris(piece), "size": [round(size.x, 2), round(size.z, 2), round(size.y, 2)], "bytes": os.path.getsize(out)})
    if render:
        scene = bpy.context.scene
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.render.resolution_x = 700
        scene.render.resolution_y = 500
        for o in bpy.context.scene.objects:
            o.hide_render = o is not piece
        cam_data = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_data)
        scene.collection.objects.link(cam); scene.camera = cam
        span = max(size)
        centre = Vector((0, 0, size.z / 2))
        cam.location = centre + Vector((span * 1.1, -span * 1.3, span * 0.8))
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam_data.lens = 35
        scene.render.filepath = os.path.join(outdir, name + ".png")
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)
        for o in bpy.context.scene.objects:
            o.hide_render = False
    bpy.data.objects.remove(piece, do_unlink=True)

print("KIT_REPORT " + json.dumps(report))
