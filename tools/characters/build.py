#!/usr/bin/env python3
"""
Turn the team's Mixamo characters into game files (one GLB per role).

    python -I tools/characters/build.py --sources ~/characters-source okoro
    python -I tools/characters/build.py --sources ~/characters-source --all

Needs Blender's Python module: `pip install bpy` into a Python 3.11 venv (no
Blender install, no UI). See tools/characters/README.md.

Input - the hand-over layout from docs/characters-for-the-team.md:

    <sources>/<role>/<role>.fbx          the character, with skin, T-pose (.glb/.gltf also fine)
    <sources>/<role>/<role>@<clip>.fbx   each animation, without skin (.glb also fine)
    <sources>/<role>/sources.json        optional: extra clip files, renames, a height

Output:

    <out>/<role>.glb      the skinned model and every clip, one file
    <out>/manifest.json   the role added (the game only asks for what is listed)

What happens to a role, in order:
  1. The character is imported (FBX or glTF) and everything that is not its
     armature or a mesh it deforms is dropped.
  2. Each clip file is imported and its action moved onto that armature. A
     clip made on the same Mixamo character (the normal case) is used as it
     is; one from a different skeleton is retargeted - each bone takes the
     source bone's rotation away from its rest pose, the hips' travel scaled
     by hip height - so clips can be shared (patient_b uses patient_a's).
  3. Units and axes: the armature and meshes are baked to identity (metres,
     Z-up in Blender, which the glTF exporter writes as Y-up), facing -Y in
     Blender (+Z in the game), feet on the floor, hips over the origin, and
     scaled to the role's height (clips.json). Bone translations in every
     clip are scaled to match.
  4. Root motion: the hips' horizontal travel is taken out (the game moves
     the body); loops keep their sway, one-shots are pinned where they start,
     deaths keep their fall. The hips' height is kept.
  5. Each locomotion clip's ground speed is measured from its planted feet,
     so the game can play it at the rate the body really moves.
  6. Textures are capped (2048 px), meshes decimated over the triangle
     budget, and it is all exported as one GLB with embedded textures.
"""

import argparse
import glob
import json
import math
import os
import re
import statistics
import sys
import time

try:
    import bpy
    from bpy_extras import anim_utils
    from mathutils import Matrix, Quaternion, Vector
except ImportError:  # pragma: no cover
    sys.exit("This needs Blender's Python module: pip install bpy (Python 3.11). See tools/characters/README.md.")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
MODEL_EXT = (".fbx", ".glb", ".gltf")
FPS = 30


def log(*parts):
    print("[characters]", *parts, flush=True)


def warn(*parts):
    print("[characters] WARNING:", *parts, flush=True)


# --------------------------------------------------------------------------
# Config and names
# --------------------------------------------------------------------------


def load_config(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def clip_key(name, cfg):
    """'Armature|Zombie Walk' / 'Zombie-Walk' -> 'zombie_walk' -> the game's name ('walk')."""
    key = str(name).split("|")[-1].strip().lower()
    key = re.sub(r"[\s\-.]+", "_", key)
    key = re.sub(r"_+", "_", key).strip("_")
    return cfg["aliases"].get(key, key)


def role_settings(role, cfg):
    return cfg["roles"].get(role, {})


def essential_for(role, cfg):
    for prefix, clips in cfg["essential"].items():
        if role.startswith(prefix):
            return clips
    return []


# --------------------------------------------------------------------------
# Scene helpers
# --------------------------------------------------------------------------


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1


def import_file(path):
    """Import a model or clip; return (new objects, new actions, the fps its frames are in)."""
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    scene = bpy.context.scene
    scene.render.fps = FPS
    ext = os.path.splitext(path)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=False, automatic_bone_orientation=False)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        raise ValueError(f"not a model file: {path}")
    # The FBX importer switches the scene to the file's frame rate and keys
    # frames at it; remember it per action and put the scene back.
    fps = scene.render.fps / (scene.render.fps_base or 1)
    scene.render.fps = FPS
    scene.render.fps_base = 1
    objects = [o for o in bpy.data.objects if o not in before_objects]
    actions = [a for a in bpy.data.actions if a not in before_actions]
    for a in actions:
        a["source_fps"] = fps
    return objects, actions, fps


def armature_of(objects):
    arms = [o for o in objects if o.type == "ARMATURE"]
    if not arms:
        return None
    return max(arms, key=lambda o: len(o.data.bones))


def skinned_meshes(arm, objects):
    meshes = []
    for o in objects:
        if o.type != "MESH":
            continue
        deformed = any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers)
        parented = o.parent == arm
        if deformed or parented:
            meshes.append(o)
    return meshes


def remove_objects(objects):
    for o in list(objects):
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except ReferenceError:
            pass


def channelbag(action):
    if not action.slots:
        return None
    return anim_utils.action_get_channelbag_for_slot(action, action.slots[0])


def fcurves(action):
    cb = channelbag(action)
    return list(cb.fcurves) if cb else []


def frame_span(action):
    start, end = action.frame_range
    return float(start), float(end)


def assign(arm, action):
    arm.animation_data_create()
    arm.animation_data.action = action
    if action.slots:
        arm.animation_data.action_slot = action.slots[0]


def unassign(arm):
    if arm.animation_data:
        arm.animation_data.action = None


def bone_world_rest(arm, name):
    return arm.matrix_world @ arm.data.bones[name].matrix_local


def rot(matrix):
    return matrix.to_3x3().normalized().to_quaternion()


def find_bone(arm, *patterns):
    for pattern in patterns:
        rx = re.compile(pattern, re.I)
        for b in arm.data.bones:
            if rx.search(b.name):
                return b.name
    return None


def hips_of(arm):
    name = find_bone(arm, r"(^|:)hips$", r"pelvis", r"hips")
    if name:
        return name
    roots = [b for b in arm.data.bones if b.parent is None]
    return roots[0].name if roots else None


def feet_of(arm):
    return find_bone(arm, r"(^|:)leftfoot$", r"foot[._ ]?l$", r"l[._ ]?foot$"), find_bone(arm, r"(^|:)rightfoot$", r"foot[._ ]?r$", r"r[._ ]?foot$")


def hands_of(arm):
    return find_bone(arm, r"(^|:)lefthand$", r"(hand|palm)[._ ]?l$", r"l[._ ]?hand$"), find_bone(arm, r"(^|:)righthand$", r"(hand|palm)[._ ]?r$", r"r[._ ]?hand$")


def mesh_box(meshes):
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for m in meshes:
        mw = m.matrix_world
        for v in m.data.vertices:
            p = mw @ v.co
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def tri_count(meshes):
    return sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes)


# --------------------------------------------------------------------------
# Clips onto the character's armature
# --------------------------------------------------------------------------


def same_skeleton(src, dst):
    """Rest poses that match (the same Mixamo character): the action can be used as it is."""
    common = [b.name for b in dst.data.bones if b.name in src.data.bones]
    if len(common) < max(10, 0.8 * len(dst.data.bones)):
        return False
    hips = hips_of(dst)
    if not hips or hips not in src.data.bones:
        return False
    hs = bone_world_rest(src, hips).translation
    ht = bone_world_rest(dst, hips).translation
    scale_s = max(1e-6, hs.z) if abs(hs.z) > 1e-6 else 1
    scale_t = max(1e-6, ht.z) if abs(ht.z) > 1e-6 else 1
    for name in common:
        ws = bone_world_rest(src, name)
        wt = bone_world_rest(dst, name)
        if rot(ws).rotation_difference(rot(wt)).angle > math.radians(2):
            return False
        ps = (ws.translation - hs) / scale_s
        pt = (wt.translation - ht) / scale_t
        if (ps - pt).length > 0.02:
            return False
    return True


def hierarchy(arm):
    order = []

    def walk(bone):
        order.append(bone)
        for c in bone.children:
            walk(c)

    for b in arm.data.bones:
        if b.parent is None:
            walk(b)
    return order


def retarget(src, action, dst, name, fps):
    """Bake `action` (on `src`) onto `dst`, bone by bone, by rotation away from rest."""
    scene = bpy.context.scene
    assign(src, action)
    start, end = frame_span(action)
    f0, f1 = int(math.floor(start)), int(math.ceil(end))
    common = {b.name for b in dst.data.bones if b.name in src.data.bones}
    hips = hips_of(dst)
    ws_rest = {n: bone_world_rest(src, n) for n in common}
    wt_rest = {n: bone_world_rest(dst, n) for n in common}
    ws_rest_q = {n: rot(m) for n, m in ws_rest.items()}
    wt_rest_q = {n: rot(m) for n, m in wt_rest.items()}
    # Hip travel scales with hip height (above the lowest foot).
    fs = [n for n in feet_of(src) if n]
    ft = [n for n in feet_of(dst) if n]
    src_floor = min((bone_world_rest(src, n).translation.z for n in fs), default=0)
    dst_floor = min((bone_world_rest(dst, n).translation.z for n in ft), default=0)
    ratio = 1.0
    if hips in common:
        hs = ws_rest[hips].translation.z - src_floor
        ht = wt_rest[hips].translation.z - dst_floor
        if abs(hs) > 1e-6:
            ratio = ht / hs
    dst_inv = dst.matrix_world.inverted()
    dst_inv_q = rot(dst_inv)
    order = hierarchy(dst)
    for pb in dst.pose.bones:
        pb.rotation_mode = "QUATERNION"

    keys = {}  # (bone, path) -> list of tuples per frame
    last_q = {}
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        ws = {n: src.matrix_world @ src.pose.bones[n].matrix for n in common}
        pose = {}
        for bone in order:
            n = bone.name
            if bone.parent:
                rest_rel = bone.parent.matrix_local.inverted() @ bone.matrix_local
                m = pose[bone.parent.name] @ rest_rel
            else:
                m = bone.matrix_local.copy()
            m_q = rot(m)
            if n in common:
                delta = rot(ws[n]) @ ws_rest_q[n].inverted()
                target = dst_inv_q @ (delta @ wt_rest_q[n])
                basis_q = m_q.inverted() @ target
            else:
                basis_q = Quaternion()
            basis_q.normalize()
            if n in last_q and last_q[n].dot(basis_q) < 0:
                basis_q.negate()
            last_q[n] = basis_q.copy()
            loc = Vector()
            if n == hips and n in common:
                travel = (ws[n].translation - ws_rest[n].translation) * ratio
                want = dst_inv @ (wt_rest[n].translation + travel)
                loc = m.to_3x3().inverted() @ (want - m.translation)
                keys.setdefault((n, "location"), []).append((f, tuple(loc)))
            keys.setdefault((n, "rotation_quaternion"), []).append((f, tuple(basis_q)))
            pose[n] = m @ Matrix.Translation(loc) @ basis_q.to_matrix().to_4x4()
    unassign(src)

    out = bpy.data.actions.new(name)
    slot = out.slots.new(id_type="OBJECT", name=dst.name)
    cb = anim_utils.action_ensure_channelbag_for_slot(out, slot)
    for (bone, prop), samples in keys.items():
        path = f'pose.bones["{bone}"].{prop}'
        for i in range(len(samples[0][1])):
            fc = cb.fcurves.new(path, index=i, group_name=bone)
            fc.keyframe_points.add(len(samples))
            flat = []
            for frame, value in samples:
                flat += [frame, value[i]]
            fc.keyframe_points.foreach_set("co", flat)
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
            fc.update()
    out["source_fps"] = fps
    return out


def take_clip(dst, src, action, name, fps, shared=False):
    """Put `action` (imported with `src`) on `dst` as clip `name`."""
    if src is dst or same_skeleton(src, dst):
        # The same rig: its curves address the same bone names already.
        action.name = name
        out = action
        how = "as is"
    else:
        out = retarget(src, action, dst, name, fps)
        how = "retargeted"
    out.name = name
    out.use_fake_user = True
    log(f"  clip {name:<13} {how}{' (shared)' if shared else ''}, {frame_span(out)[1] - frame_span(out)[0]:.0f} frames")
    return out


def longest(actions):
    real = [a for a in actions if frame_span(a)[1] - frame_span(a)[0] >= 2]
    return max(real, key=lambda a: frame_span(a)[1] - frame_span(a)[0]) if real else None


# --------------------------------------------------------------------------
# Units, axes, floor
# --------------------------------------------------------------------------


def scale_locations(actions, factor):
    if abs(factor - 1) < 1e-9:
        return
    for action in actions:
        for fc in fcurves(action):
            if not fc.data_path.endswith(".location"):
                continue
            for kp in fc.keyframe_points:
                kp.co.y *= factor
                kp.handle_left.y *= factor
                kp.handle_right.y *= factor
            fc.update()


def bake(arm, meshes, actions, extra=None):
    """Bake object transforms (and `extra`) into the data: everything ends at identity."""
    extra = extra or Matrix.Identity(4)
    ma = extra @ arm.matrix_world
    for m in meshes:
        world = extra @ m.matrix_world
        m.parent = None
        m.data.transform(world, shape_keys=True)
        m.matrix_world = Matrix.Identity(4)
    arm.data.transform(ma)
    arm.matrix_world = Matrix.Identity(4)
    for m in meshes:
        m.parent = arm
        m.matrix_parent_inverse = Matrix.Identity(4)
        m.matrix_basis = Matrix.Identity(4)
        for mod in m.modifiers:
            if mod.type == "ARMATURE":
                mod.object = arm
    s = ma.to_scale()
    scale_locations(actions, (s.x + s.y + s.z) / 3)
    bpy.context.view_layer.update()


def retime(actions):
    for action in actions:
        fps = float(action.get("source_fps", FPS))
        if abs(fps - FPS) < 0.01:
            continue
        k = FPS / fps
        start = frame_span(action)[0]
        for fc in fcurves(action):
            for kp in fc.keyframe_points:
                for v in (kp.co, kp.handle_left, kp.handle_right):
                    v.x = start + (v.x - start) * k
            fc.update()
        action["source_fps"] = FPS


# --------------------------------------------------------------------------
# Root motion and speed
# --------------------------------------------------------------------------


def strip_root(action, arm, hips, mode, loop):
    if mode == "keep" or not hips:
        return
    path = f'pose.bones["{hips}"].location'
    cb = channelbag(action)
    curves = {fc.array_index: fc for fc in cb.fcurves if fc.data_path == path} if cb else {}
    if len(curves) < 3:
        return
    rest = arm.data.bones[hips].matrix_local.to_3x3()
    inv = rest.inverted()
    start, end = frame_span(action)
    frames = list(range(int(math.floor(start)), int(math.ceil(end)) + 1))
    world = [rest @ Vector([curves[i].evaluate(f) for i in range(3)]) for f in frames]
    first, last = world[0], world[-1]
    span = max(1e-6, frames[-1] - frames[0])
    reach = max(math.hypot(w.x - first.x, w.y - first.y) for w in world)
    if reach < 0.12 and mode != "detrend_y":
        return  # already in place
    out = []
    for f, w in zip(frames, world):
        w = w.copy()
        k = (f - frames[0]) / span
        if loop:
            w.x -= (last.x - first.x) * k
            w.y -= (last.y - first.y) * k
            if mode == "detrend_y":
                w.z -= (last.z - first.z) * k
        else:
            w.x, w.y = first.x, first.y
        out.append(inv @ w)
    for i in range(3):
        fc = curves[i]
        fc.keyframe_points.clear()
        fc.keyframe_points.add(len(frames))
        flat = []
        for f, v in zip(frames, out):
            flat += [f, v[i]]
        fc.keyframe_points.foreach_set("co", flat)
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
        fc.update()


def measure_speed(action, arm):
    """Ground speed (m/s) from the planted feet: how fast a foot on the floor slides back."""
    feet = [n for n in feet_of(arm) if n]
    if not feet:
        return None
    scene = bpy.context.scene
    assign(arm, action)
    start, end = frame_span(action)
    frames = list(range(int(math.floor(start)), int(math.ceil(end)) + 1))
    tracks = {n: [] for n in feet}
    for f in frames:
        scene.frame_set(f)
        for n in feet:
            tracks[n].append(arm.matrix_world @ arm.pose.bones[n].head)
    unassign(arm)
    samples = []
    for points in tracks.values():
        low = min(p.z for p in points)
        for a, b in zip(points, points[1:]):
            if a.z < low + 0.03 and b.z < low + 0.03:
                samples.append(math.hypot(b.x - a.x, b.y - a.y) * FPS)
    if len(samples) < 3:
        return None
    return round(statistics.median(samples), 3)


# --------------------------------------------------------------------------
# Textures and polygons
# --------------------------------------------------------------------------


def cap_textures(limit):
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) <= limit or w == 0:
            continue
        k = limit / max(w, h)
        img.scale(max(1, int(w * k)), max(1, int(h * k)))
        img.pack()
        log(f"  texture {img.name}: {w}x{h} -> {img.size[0]}x{img.size[1]}")


def decimate(meshes, budget):
    total = tri_count(meshes)
    if total <= budget:
        return total
    ratio = budget / total
    for m in meshes:
        bpy.context.view_layer.objects.active = m
        mod = m.modifiers.new("Budget", "DECIMATE")
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    after = tri_count(meshes)
    log(f"  decimated {total} -> {after} triangles (budget {budget})")
    return after


# --------------------------------------------------------------------------
# One role
# --------------------------------------------------------------------------


def find_main(folder, role, extra):
    if extra.get("main"):
        return os.path.join(folder, extra["main"])
    for ext in MODEL_EXT:
        path = os.path.join(folder, role + ext)
        if os.path.exists(path):
            return path
    return None


def clip_files(folder, role, cfg):
    out = {}
    for path in sorted(glob.glob(os.path.join(folder, f"{role}@*"))):
        if os.path.splitext(path)[1].lower() not in MODEL_EXT:
            continue
        stem = os.path.splitext(os.path.basename(path))[0].split("@", 1)[1]
        out.setdefault(clip_key(stem, cfg), {"file": path})
    return out


def build_role(role, sources, out_dir, cfg, args):
    folder = os.path.join(sources, role)
    if not os.path.isdir(folder):
        raise SystemExit(f"no folder {folder}")
    extra_path = os.path.join(folder, "sources.json")
    extra = load_config(extra_path) if os.path.exists(extra_path) else {}
    settings = {**role_settings(role, cfg), **{k: v for k, v in extra.items() if k in ("height", "materials", "share_clips_from")}}
    main = find_main(folder, role, extra)
    if not main:
        raise SystemExit(f"{role}: no {role}.fbx / .glb in {folder}")
    started = time.time()
    log(f"{role}: {os.path.relpath(main, sources)}")
    reset()

    objects, main_actions, main_fps = import_file(main)
    arm = armature_of(objects)
    if not arm:
        raise SystemExit(f"{role}: {main} has no skeleton. Rig it on Mixamo first (docs/characters-for-the-team.md, section 3).")
    meshes = skinned_meshes(arm, objects)
    if not meshes:
        raise SystemExit(f"{role}: {main} has a skeleton but no skinned mesh. Download it 'With Skin'.")
    keep = {arm, *meshes}
    remove_objects([o for o in objects if o not in keep and not any(k.parent == o for k in keep)])
    unassign(arm)
    for o in [o for o in bpy.data.objects if o not in keep]:
        if o.type != "ARMATURE" and not o.children:
            remove_objects([o])
    arm.name = "Armature"
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"

    clips = {}
    renames = extra.get("main_actions", {})
    for action in main_actions:
        start, end = frame_span(action)
        name = renames.get(action.name) or clip_key(action.name, cfg)
        if end - start < 2 or re.fullmatch(r"t_?pose|layer0|mixamo_com", name):
            continue
        if action.name not in renames and name not in cfg["clips"]:
            continue
        if name in clips:
            continue
        clips[name] = take_clip(arm, arm, action, name, main_fps)

    wanted = clip_files(folder, role, cfg)
    for name, spec in extra.get("clips", {}).items():
        wanted[name] = {"file": os.path.normpath(os.path.join(folder, spec["file"])), "action": spec.get("action")}
    shared_from = settings.get("share_clips_from")
    if shared_from and os.path.isdir(os.path.join(sources, shared_from)):
        for name, spec in clip_files(os.path.join(sources, shared_from), shared_from, cfg).items():
            if name not in wanted and name not in clips:
                wanted[name] = {**spec, "shared": True}

    for name, spec in sorted(wanted.items()):
        if name in clips and not spec.get("action"):
            continue
        objs, acts, fps = import_file(spec["file"])
        src = armature_of(objs)
        action = None
        if spec.get("action"):
            action = next((a for a in acts if a.name == spec["action"] or clip_key(a.name, cfg) == clip_key(spec["action"], cfg)), None)
        action = action or longest(acts)
        if not src or not action:
            warn(f"{role}: {os.path.basename(spec['file'])} has no animation, skipped")
            remove_objects(objs)
            continue
        clips[name] = take_clip(arm, src, action, name, fps, shared=spec.get("shared", False))
        for a in acts:
            if a is not action and a not in clips.values():
                bpy.data.actions.remove(a)
        remove_objects(objs)

    # Nothing else is exported.
    for a in list(bpy.data.actions):
        if a not in clips.values():
            bpy.data.actions.remove(a)
    actions = list(clips.values())
    retime(actions)

    # Units and axes: bake to identity (metres if the file said so).
    bake(arm, meshes, actions)
    # Facing: the character's left hand on +X faces -Y (the game's +Z).
    hl, hr = hands_of(arm)
    turn = Matrix.Identity(4)
    if hl and hr and arm.data.bones[hl].head_local.x < arm.data.bones[hr].head_local.x:
        turn = Matrix.Rotation(math.pi, 4, "Z")
        log("  turned to face forward")
    lo, hi = mesh_box(meshes)
    height = hi.z - lo.z
    if height < 1e-4:
        raise SystemExit(f"{role}: the mesh is flat")
    head = arm.data.bones[hips_of(arm)].head_local if hips_of(arm) else (lo + hi) / 2
    want = float(settings.get("height") or 1.75)
    k = want / height
    log(f"  height {height:.3f} (file units) -> {want:.2f} m")
    extra_m = Matrix.Scale(k, 4) @ turn @ Matrix.Translation((-head.x, -head.y, -lo.z))
    bake(arm, meshes, actions, extra_m)
    if arm.data.bones[hips_of(arm)].head_local.z < 0.3 if hips_of(arm) else False:
        warn(f"{role}: the hips are near the floor in the rest pose - is it lying down?")

    # Root motion, speeds.
    hips = hips_of(arm)
    loops = set(cfg["loops"])
    meta = {}
    for name, action in clips.items():
        base = re.sub(r"_?\d+$", "", name)
        mode = cfg["root"].get(base, cfg["root"]["default"])
        strip_root(action, arm, hips, mode, base in loops)
        start, end = frame_span(action)
        entry = {"duration": round((end - start) / FPS, 3), "loop": base in loops}
        if base in cfg["locomotion"]:
            speed = measure_speed(action, arm)
            if speed:
                entry["speed"] = speed
        meta[name] = entry
    bpy.context.scene.frame_set(0)
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)

    cap_textures(args.max_texture)
    tris = decimate(meshes, args.max_tris)

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{role}.glb")
    for o in bpy.data.objects:
        o.select_set(o in keep)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_range=False,
        export_optimize_animation_size=True,
        export_anim_slide_to_zero=True,
        export_skins=True,
        export_all_influences=False,
        export_morph=False,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format=args.image_format,
        export_jpeg_quality=88,
        export_image_quality=88,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )
    size = os.path.getsize(out_path)
    missing = [c for c in essential_for(role, cfg) if c not in clips]
    log(f"  wrote {os.path.relpath(out_path, REPO) if out_path.startswith(REPO) else out_path}: {size / 1e6:.1f} MB, {tris} triangles, {len(clips)} clips, {time.time() - started:.0f} s")
    if missing:
        warn(f"{role}: missing essential clips: {', '.join(missing)} (the game poses those moments procedurally)")
    materials = sorted({m.name for o in meshes for m in o.data.materials if m})
    return {
        "file": f"{role}.glb",
        "slot": settings.get("slot"),
        "height": round(want, 3),
        "triangles": tris,
        "materials": settings.get("materials") or {},
        "materialNames": materials,
        "clips": dict(sorted(meta.items())),
        "built": time.strftime("%Y-%m-%d"),
    }


def update_manifest(out_dir, results):
    path = os.path.join(out_dir, "manifest.json")
    data = {"version": 1, "roles": {}}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    data.setdefault("roles", {})
    for role, entry in results.items():
        data["roles"][role] = entry
    data["roles"] = dict(sorted(data["roles"].items()))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    log(f"manifest: {path} ({len(data['roles'])} roles)")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Convert the team's Mixamo characters into game GLBs.")
    parser.add_argument("roles", nargs="*", help="role folders to build (e.g. okoro patient_a)")
    parser.add_argument("--all", action="store_true", help="every role folder in --sources")
    parser.add_argument("--sources", default=os.path.join(REPO, "characters-source"), help="the hand-over folder (characters-source/)")
    parser.add_argument("--out", default=os.path.join(REPO, "assets", "characters"), help="where the GLBs and manifest.json go")
    parser.add_argument("--config", default=os.path.join(HERE, "clips.json"))
    parser.add_argument("--max-tris", type=int, default=40000, help="decimate above this many triangles")
    parser.add_argument("--max-texture", type=int, default=2048, help="largest texture side, px")
    parser.add_argument("--image-format", default="AUTO", choices=["AUTO", "JPEG", "WEBP"], help="texture encoding in the GLB")
    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    sources = os.path.abspath(os.path.expanduser(args.sources))
    roles = args.roles
    if args.all:
        roles = sorted(d for d in os.listdir(sources) if os.path.isdir(os.path.join(sources, d)) and not d.startswith((".", "_")))
    if not roles:
        parser.error("name a role, or --all")
    unknown = [r for r in roles if r not in cfg["roles"]]
    if unknown:
        warn(f"not in clips.json roles (the game won't use them): {', '.join(unknown)}")
    results = {}
    failed = []
    for role in roles:
        try:
            results[role] = build_role(role, sources, os.path.abspath(args.out), cfg, args)
        except SystemExit as error:
            warn(str(error))
            failed.append(role)
    if results:
        update_manifest(os.path.abspath(args.out), results)
    if failed:
        sys.exit(f"failed: {', '.join(failed)}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
