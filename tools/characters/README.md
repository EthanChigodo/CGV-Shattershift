# Characters: from the team's Mixamo files to the game

The team makes the characters (docs/characters-for-the-team.md). This folder
turns what they hand over into the files the game loads:

```
characters-source/<role>/<role>.fbx           the character, With Skin, T-pose   (.glb also fine)
characters-source/<role>/<role>@<clip>.fbx    one animation each, Without Skin    (.glb also fine)
        |
        |  python -I tools/characters/build.py --sources characters-source <role>
        v
assets/characters/<role>.glb                  model + every clip, metres, Y-up, facing +Z, feet at 0
assets/characters/manifest.json               the role listed -> the game uses it
```

A role that is not in `manifest.json` keeps today's model and procedural
animation, so characters can arrive one at a time. The manifest committed
now is empty: the game is unchanged until the first build.

## Setup (once)

Blender's Python module, no Blender install:

```
python3.11 -m venv ~/bpy-venv           # bpy needs Python 3.11
~/bpy-venv/bin/python -m pip install bpy
```

## Build

```
git fetch https://github.com/siphokazi-tech6/CGV-Shattershift characters-source
git worktree add ../characters-source FETCH_HEAD        # the team's branch, beside this checkout

~/bpy-venv/bin/python -I tools/characters/build.py --sources ../characters-source/characters-source subject07_female
~/bpy-venv/bin/python -I tools/characters/build.py --sources ../characters-source/characters-source --all
```

Options: `--out DIR` (default `assets/characters/`), `--max-tris 40000`
(decimates above it), `--max-texture 2048`, `--image-format AUTO|JPEG|WEBP`.

It prints each clip as it lands (`as is` for the same skeleton, `retargeted`
for a borrowed one), the height and triangle count, and which of the brief's
essential clips are missing (the game poses those moments procedurally).

## What it does

1. Imports the character (FBX or glTF) and keeps only its armature and the
   meshes it deforms.
2. Imports each `<role>@<clip>` file. Clip names come from the file name and
   go through `clips.json` `aliases` (so `okoro@talking.fbx` or a Mixamo
   name like `Zombie Walk` still lands as `talk` / `walk`). A clip made on
   the same Mixamo character is used as is; one from another skeleton is
   **retargeted** bone by bone (rotation away from the rest pose, hip travel
   scaled by hip height). `share_clips_from` in `clips.json` uses that to
   fill a role's missing clips from another (patient_b and the brute from
   patient_a).
3. Bakes every transform into the data: metres, Z-up in Blender (written as
   Y-up), facing the game's +Z, feet on the floor, hips over the origin,
   scaled to the role's height. Bone translations in every clip follow.
4. Root motion: the hips' horizontal travel comes out (the game moves the
   body). Loops keep their sway; one-shots are pinned where they start;
   deaths keep their fall (`clips.json` `root`). Hip height always stays.
5. Measures each locomotion clip's ground speed from its planted feet into
   the manifest, so the game plays a walk or run at the rate the body
   really moves (no skating).
6. Caps textures, decimates over budget, exports one GLB with embedded
   textures, and updates `manifest.json`.

## Extra sources (optional)

A `sources.json` in a role folder can add clips from anywhere, rename the
character file's own actions, or override the height:

```json
{
  "main": "okoro_v2.glb",
  "main_actions": { "SambaDance": "cheer" },
  "clips": { "run": { "file": "../patient_a/patient_a@run.fbx" } },
  "height": 1.8
}
```

## Check it before it ships

Build into the git-ignored dev folder and look:

```
~/bpy-venv/bin/python -I tools/characters/build.py --sources ... --out assets/characters/dev okoro
python tools/serve.py
#  http://localhost:4173/preview/characters.html?characters=dev   turntable, every clip, hit/die, skin and hair swatches
#  http://localhost:4173/index.html?characters=dev                 the whole game with them
```

`?characters=off` forces today's models; the same value in
`localStorage["fractureRun.characters"]` sticks. Only same-origin folders are
accepted. When it looks right, build again without `--out` and commit
`assets/characters/<role>.glb` and `manifest.json` (never the FBX sources).

## In the game (src/figure/rigged.js)

- `ROLE_SLOTS` maps roles onto the game's slots: `subject07_female/male` ->
  the player, `okoro`, `vale`, `patient_a/b` (dealt out in turn) ->
  patients, `patient_brute` -> the roof's brute, `scientist_labcoat` /
  `scientist_hazmat` -> the roof scientists.
- `ClipRig` takes the calls the game already makes on `HumanoidRig`
  (`pose`, `rotate`, `apply`, `bones`...) and plays clips: crossfades,
  walk/run synced to speed, hits over the motion, deaths held on the last
  frame. A moment with no clip is posed procedurally on the same skeleton.
- `RiggedBody` drives the player from the same state as the old shader rig
  (run, jump, slide, strafe, fall, climb, hang, throw...), keeps both hands
  on the launcher with two-bone IK, and tints skin and hair.
- Materials named `Skin` / `Hair` (or listed under a role's `materials` in
  the manifest) are tinted and shaded as such; a one-material AI model is
  judged per texel (skin's band of hue and saturation; dark texels on the
  head are hair). Skin gets wrap lighting with a warm scatter band, hair
  Kajiya-Kay highlights, cloth stays rough with a faint sheen.

Checks: `node tests/characters/run.js` (the stand-in part runs when
`CHARACTERS_FIXTURE` points at a built folder).
