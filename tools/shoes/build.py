"""
Shoes for the figure (src/figure/shoes.js), from downloaded models.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P tools/shoes/build.py -- <source.glb> <out.glb> [triangles] [floor]

Each download is a scan or a model of a pair (or one shoe), tens of
megabytes with 4-8K textures. This keeps one shoe and makes it light enough
to stream into a menu:

  - one shoe: a pair is split where the gap between the two is, and the
    part on one side kept;
  - laid out the same way every time: sole on the floor (z = 0), the toe
    toward -Y in Blender (+Z in the game, which faces +Z), centred, one
    unit long - the game scales it to each figure's foot;
  - decimated to about `triangles` (12,000 by default);
  - textures down to 1024 px, written as JPEG.

The heel is told from the toe by height: the collar at the back stands
taller than the toe box.

`floor` (a fraction of the height, e.g. 0.05) is for scans that brought the
ground they stood on with them: everything in that bottom layer goes, then
any loose scraps not touching the shoe. (Not for modelled shoes: it would
cut the bottom off the sole.)
"""

import math
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
SOURCE, OUT = argv[0], argv[1]
TRIANGLES = int(argv[2]) if len(argv) > 2 else 12000
FLOOR = float(argv[3]) if len(argv) > 3 else 0.0
# "split": a pair the gap test can't separate - split by clustering the vertices.
SPLIT = len(argv) > 4 and argv[4] == "split"
TEXTURE = 1024


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def select(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def world_bounds(obj):
    xs, ys, zs = [], [], []
    for v in obj.data.vertices:
        xs.append(v.co.x)
        ys.append(v.co.y)
        zs.append(v.co.z)
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)

# Everything into one mesh, in world space.
objs = meshes()
for o in objs:
    select([o])
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
select(objs)
bpy.ops.object.join()
shoe = bpy.context.view_layer.objects.active
select([shoe])
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in [o for o in bpy.context.scene.objects if o != shoe]:
    bpy.data.objects.remove(o, do_unlink=True)
print(f"[shoes] {SOURCE}: {tri_count(shoe)} triangles")

# A big scan: down to something workable before anything else walks its vertices.
if tri_count(shoe) > 60000:
    mod = shoe.modifiers.new("pre", "DECIMATE")
    mod.ratio = 60000 / tri_count(shoe)
    bpy.ops.object.modifier_apply(modifier=mod.name)

# ---- A pair: keep one ----
# (Welded first: some files are loose triangles, which would make every
# triangle its own "part".)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.0005)
bpy.ops.mesh.separate(type="LOOSE")
bpy.ops.object.mode_set(mode="OBJECT")
parts = meshes()
boxes = []
for p in parts:
    bx, by, bz = world_bounds(p)
    boxes.append((p, bx, by, (len(p.data.vertices))))


def gap(axis):
    """The widest empty stretch between the parts along an axis: (width, where)."""
    spans = sorted((b[1 + axis][0], b[1 + axis][1]) for b in boxes)
    best = (0.0, None)
    reach = spans[0][1]
    for lo, hi in spans[1:]:
        if lo > reach and lo - reach > best[0]:
            best = (lo - reach, (lo + reach) / 2)
        reach = max(reach, hi)
    return best


lo_x = min(b[1][0] for b in boxes)
hi_x = max(b[1][1] for b in boxes)
lo_y = min(b[2][0] for b in boxes)
hi_y = max(b[2][1] for b in boxes)
size = max(hi_x - lo_x, hi_y - lo_y)
gx, gy = gap(0), gap(1)
axis, (width, cut) = (0, gx) if gx[0] >= gy[0] else (1, gy)
if cut is not None and width > size * 0.01 and not SPLIT:
    keep = [b[0] for b in boxes if (sum(b[1 + axis]) / 2) < cut]
    drop = [b[0] for b in boxes if b[0] not in keep]
    # (The side with more of the model, if they differ: a stray part shouldn't decide.)
    if sum(len(o.data.vertices) for o in drop) > sum(len(o.data.vertices) for o in keep):
        keep, drop = drop, keep
    for o in drop:
        bpy.data.objects.remove(o, do_unlink=True)
    print(f"[shoes] a pair: split along {'XY'[axis]} at {cut:.3f}, kept {len(keep)} parts")
elif SPLIT:
    # A pair set at an angle, or touching, or with its parts interleaved:
    # two clusters of the vertices themselves in the ground plane (k-means,
    # from the two ends of the widest spread); the one with more kept.
    import bmesh
    select(meshes())
    bpy.ops.object.join()
    whole = bpy.context.view_layer.objects.active
    bm = bmesh.new()
    bm.from_mesh(whole.data)
    pts = [(v.co.x, v.co.y) for v in bm.verts]
    mx = sum(p[0] for p in pts) / len(pts)
    my = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ax_, ay_ = math.cos(ang), math.sin(ang)
    proj = [(p[0] - mx) * ax_ + (p[1] - my) * ay_ for p in pts]
    ca = pts[proj.index(min(proj))]
    cb = pts[proj.index(max(proj))]
    side = [0] * len(pts)
    for _ in range(15):
        side = [0 if (p[0] - ca[0]) ** 2 + (p[1] - ca[1]) ** 2 <= (p[0] - cb[0]) ** 2 + (p[1] - cb[1]) ** 2 else 1 for p in pts]
        a = [p for p, k in zip(pts, side) if k == 0]
        b = [p for p, k in zip(pts, side) if k == 1]
        if not a or not b:
            break
        ca = (sum(p[0] for p in a) / len(a), sum(p[1] for p in a) / len(a))
        cb = (sum(p[0] for p in b) / len(b), sum(p[1] for p in b) / len(b))
    drop = 1 if side.count(0) >= side.count(1) else 0
    doomed = [v for v, k in zip(bm.verts, side) if k == drop]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(whole.data)
    bm.free()
    print(f"[shoes] a pair: vertex clusters, kept {side.count(1 - drop)} of {len(side)} vertices")
    # Slivers of the other shoe the line cut off: loose pieces not wholly
    # inside this one's box (5 mm to spare) - a centre test keeps a sliver
    # whose middle falls in a shoe set at an angle.
    select([whole])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    pieces = sorted(meshes(), key=lambda o: len(o.data.vertices), reverse=True)
    (mx0, mx1), (my0, my1), _ = world_bounds(pieces[0])
    gone = 0
    for o in pieces[1:]:
        (ax0, ax1), (ay0, ay1), _ = world_bounds(o)
        m = 0.005
        if not (ax0 >= mx0 - m and ax1 <= mx1 + m and ay0 >= my0 - m and ay1 <= my1 + m):
            bpy.data.objects.remove(o, do_unlink=True)
            gone += 1
    print(f"[shoes] {gone} slivers of the other shoe dropped")
elif len(boxes) > 1 and min(hi_x - lo_x, hi_y - lo_y) > 0.6 * size:
    # No clean gap, but too square for one shoe: a pair set at an angle or
    # touching. Two clusters of the parts' centres (weighted by size), the
    # bigger kept.
    pts = [((b[1][0] + b[1][1]) / 2, (b[2][0] + b[2][1]) / 2, b[3], b[0]) for b in boxes]
    a = max(pts, key=lambda p: p[2])
    c = max(pts, key=lambda p: (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2)
    ca, cc = (a[0], a[1]), (c[0], c[1])
    for _ in range(12):
        ga = [p for p in pts if (p[0] - ca[0]) ** 2 + (p[1] - ca[1]) ** 2 <= (p[0] - cc[0]) ** 2 + (p[1] - cc[1]) ** 2]
        gc = [p for p in pts if p not in ga]
        if not ga or not gc:
            break
        wa = sum(p[2] for p in ga)
        wc = sum(p[2] for p in gc)
        ca = (sum(p[0] * p[2] for p in ga) / wa, sum(p[1] * p[2] for p in ga) / wa)
        cc = (sum(p[0] * p[2] for p in gc) / wc, sum(p[1] * p[2] for p in gc) / wc)
    if ga and gc:
        keep = ga if sum(p[2] for p in ga) >= sum(p[2] for p in gc) else gc
        for p in pts:
            if p not in keep:
                bpy.data.objects.remove(p[3], do_unlink=True)
        print(f"[shoes] a pair (no gap): two clusters, kept {len(keep)} of {len(pts)} parts")
parts = meshes()
select(parts)
bpy.ops.object.join()
shoe = bpy.context.view_layer.objects.active

# ---- A scanned floor: off, and the scraps it leaves ----
if FLOOR > 0:
    import bmesh
    (x0, x1), (y0, y1), (z0, z1) = world_bounds(shoe)
    cut = z0 + (z1 - z0) * FLOOR
    bm = bmesh.new()
    bm.from_mesh(shoe.data)
    doomed = [f for f in bm.faces if all(v.co.z < cut for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(shoe.data)
    bm.free()
    select([shoe])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    scraps = sorted(meshes(), key=lambda o: len(o.data.vertices), reverse=True)
    main = scraps[0]
    (mx0, mx1), (my0, my1), (mz0, mz1) = world_bounds(main)
    keep = [main]
    for o in scraps[1:]:
        (ax0, ax1), (ay0, ay1), (az0, az1) = world_bounds(o)
        cx, cy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
        if mx0 <= cx <= mx1 and my0 <= cy <= my1 and len(o.data.vertices) > len(main.data.vertices) * 0.03:
            keep.append(o)
    for o in scraps:
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    select(keep, main)
    bpy.ops.object.join()
    shoe = bpy.context.view_layer.objects.active
    print(f"[shoes] floor cut at {FLOOR:.0%} of the height; kept {len(keep)} parts")

# ---- Decimate ----
tris = tri_count(shoe)
if tris > TRIANGLES:
    mod = shoe.modifiers.new("decimate", "DECIMATE")
    mod.ratio = TRIANGLES / tris
    select([shoe])
    bpy.ops.object.modifier_apply(modifier=mod.name)
print(f"[shoes] {tri_count(shoe)} triangles after decimating")

# ---- Lay it out: length along Y, toe to -Y, sole at z = 0, one unit long ----
vs = [v.co.copy() for v in shoe.data.vertices]
mx = sum(v.x for v in vs) / len(vs)
my = sum(v.y for v in vs) / len(vs)
sxx = sum((v.x - mx) ** 2 for v in vs)
syy = sum((v.y - my) ** 2 for v in vs)
sxy = sum((v.x - mx) * (v.y - my) for v in vs)
# The length along Y: the turn that gives the smallest box round the shoe
# in the ground plane (steadier than the principal axis, which a heavy heel
# collar pulls off line), its longer side then onto Y.
best = None
for deg in range(0, 180):
    t = math.radians(deg)
    c, sn = math.cos(t), math.sin(t)
    us = [v.x * c + v.y * sn for v in vs]
    ws = [-v.x * sn + v.y * c for v in vs]
    lu, lw = max(us) - min(us), max(ws) - min(ws)
    if best is None or lu * lw < best[0]:
        best = (lu * lw, t, lu, lw)
_, angle, lu, lw = best
# (angle is where the box's first side lies; the length is the longer side.)
if lw > lu:
    angle += math.pi / 2
turn = math.pi / 2 - angle
shoe.rotation_euler = (0, 0, turn)
select([shoe])
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
(x0, x1), (y0, y1), (z0, z1) = world_bounds(shoe)
length = y1 - y0
# Heel or toe: the end that stands taller is the heel (the collar).
quarter = length * 0.25
tall_lo = max((v.co.z for v in shoe.data.vertices if v.co.y < y0 + quarter), default=z0)
tall_hi = max((v.co.z for v in shoe.data.vertices if v.co.y > y1 - quarter), default=z0)
# Heel at +Y (toe at -Y): if the low-Y end is the taller one, turn it round.
if tall_lo > tall_hi:
    shoe.rotation_euler = (0, 0, math.pi)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
(x0, x1), (y0, y1), (z0, z1) = world_bounds(shoe)
shoe.location = (-(x0 + x1) / 2, -(y0 + y1) / 2, -z0)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
s = 1.0 / (y1 - y0)
shoe.scale = (s, s, s)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
(x0, x1), (y0, y1), (z0, z1) = world_bounds(shoe)
print(f"[shoes] laid out: {x1 - x0:.3f} wide, {y1 - y0:.3f} long, {z1 - z0:.3f} high")
shoe.name = "Shoe"
shoe.data.name = "Shoe"

# ---- Textures ----
for img in bpy.data.images:
    if img.size[0] > TEXTURE or img.size[1] > TEXTURE:
        w, h = img.size
        k = TEXTURE / max(w, h)
        img.scale(max(1, int(w * k)), max(1, int(h * k)))
        print(f"[shoes] {img.name}: {w}x{h} -> {img.size[0]}x{img.size[1]}")

select([shoe])
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_animations=False,
    export_image_format="JPEG",
    export_jpeg_quality=82,
    export_yup=True,
)
print(f"[shoes] wrote {OUT}")
