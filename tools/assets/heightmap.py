"""
A walkable height map of a model (the roof scan), for the game's collision:
rays cast straight down on a grid, the highest hit per cell. Written in the
game's frame - glTF (x, y up, z) after assets.js loadOne() re-centres the
model (bottom-centre at the origin) - so the game can sample it directly.

    blender -b --factory-startup --python heightmap.py -- <model.glb> <out.json> [cell=0.25]

Out: { cell, x0, z0, nx, nz, size: [x, y, z], heights: [...] } - heights row
by row (z, then x), metres above the model's bottom; null where a ray hit
nothing (off the edge). Also writes <out>.png, a grey-scale picture of it.
"""
import bpy, sys, json, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
cell = float(argv[2]) if len(argv) > 2 else 0.25

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
depsgraph = bpy.context.evaluated_depsgraph_get()

verts, polys = [], []
for o in bpy.context.scene.objects:
    if o.type != "MESH":
        continue
    eo = o.evaluated_get(depsgraph)
    mesh = eo.to_mesh()
    base = len(verts)
    for v in mesh.vertices:
        verts.append(o.matrix_world @ v.co)
    for p in mesh.polygons:
        polys.append([base + i for i in p.vertices])
    eo.to_mesh_clear()
tree = BVHTree.FromPolygons(verts, polys)

lo = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
hi = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
# Blender (x, y, z) -> glTF (x, z, -y); loadOne() then puts the bottom-centre at the origin.
cx = (lo.x + hi.x) / 2
cz_gltf = -(lo.y + hi.y) / 2
bottom = lo.z
size = [hi.x - lo.x, hi.z - lo.z, hi.y - lo.y]

# The grid, in the game's frame.
x0 = lo.x - cx
z0 = -hi.y - cz_gltf
nx = int(math.ceil((hi.x - lo.x) / cell)) + 1
nz = int(math.ceil((hi.y - lo.y) / cell)) + 1
heights = []
top = hi.z + 5
down = Vector((0, 0, -1))
for j in range(nz):
    gz = z0 + j * cell
    by = -(gz + cz_gltf)  # back to Blender y
    for i in range(nx):
        gx = x0 + i * cell
        bx = gx + cx
        hit = tree.ray_cast(Vector((bx, by, top)), down, top - lo.z + 10)
        heights.append(None if hit[0] is None else round(hit[0].z - bottom, 3))

with open(out, "w") as f:
    json.dump({"cell": cell, "x0": round(x0, 3), "z0": round(z0, 3), "nx": nx, "nz": nz, "size": [round(s, 3) for s in size], "heights": heights}, f)

# A picture: black = nothing, grey by height.
img = bpy.data.images.new("hm", nx, nz)
hmax = max(h for h in heights if h is not None)
px = []
for j in range(nz):
    for i in range(nx):
        h = heights[(nz - 1 - j) * nx + i]
        g = 0 if h is None else 0.15 + 0.85 * h / hmax
        px += [g, g, g, 1]
img.pixels = px
img.filepath_raw = out.rsplit(".", 1)[0] + ".png"
img.file_format = "PNG"
img.save()
print("HEIGHTMAP", json.dumps({"nx": nx, "nz": nz, "x0": x0, "z0": z0, "size": size, "hmax": hmax}))
