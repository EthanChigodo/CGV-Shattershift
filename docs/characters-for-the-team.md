# Realistic characters: what the team makes, what we wire in

The game's people today are placeholder models posed by code. They have no real animation clips. This brief replaces them with realistic, textured, rigged characters that have real motion-capture animation: the same workflow the other group used, done more carefully.

**Who does what**

- **The team** generates each character with an AI 3D tool, then rigs and animates it on Mixamo (free, an Adobe account).
- **We** convert the files, put them in the game, map every game moment to a clip, and add the skin, hair and lighting shaders.

You do **not** need Blender or any 3D skills beyond the steps below.

---

## 1. The cast

Make one model per row. The **file name** is the folder and file name to use (section 4).

| File name | Who | Look | Priority |
| --- | --- | --- | --- |
| `subject07_female` | **Subject 07, female** (the player) | A woman in her 20s. Pale-blue hospital scrub top and trousers over her own grey t-shirt (visible at the neck), a hospital wristband, pale clogs or bare feet. Hair tied back or shoulder length. | Essential |
| `subject07_male` | **Subject 07, male** (the player) | A man in his 20s. Same clothes: scrubs over a grey t-shirt, wristband, clogs. Short hair. | Essential |
| `okoro` | **Dr. Okoro**, the good scientist who wakes you | A Nigerian man, about 50, kind face, short greying hair, glasses. White lab coat over a shirt and tie, ID badge. | Essential |
| `vale` | **Dr. Vale**, the villain (on monitors in the Labs; the helicopter pilot at the end) | A man about 45, clean-cut, cold expression. Dark suit or black turtleneck under an open lab coat. | Essential |
| `patient_a` | **Escaped test subject** (the "zombies") | Thin, sickly grey skin, hospital gown, bare feet, bandages, IV marks. Messy hair. | Essential |
| `patient_b` | **Escaped test subject**, second variant | As above but a woman, or older, so the crowd is not all one person. | Essential |
| `patient_brute` | **The brute** (the roof's last wave) | A big, heavy-set subject: broad shoulders, torn gown, restraints still on the wrists. | Nice to have |
| `scientist_labcoat` | **HALCYON scientist** (roof enemy) | Lab coat, safety goggles, gloves; carries a small gadget like a stun pistol. | Essential |
| `scientist_hazmat` | **HALCYON scientist in a radiation suit** (roof enemy) | Yellow or orange hazmat suit with a respirator, radio on the chest. | Nice to have |

Nine models in total; seven are essential.

---

## 2. Making each model (Meshy, Tripo, Modly or similar)

1. **Start from one picture.** Generate or find a full-body image of the character with these properties:
   - standing straight in a **T-pose or A-pose**, arms away from the body, legs slightly apart;
   - **facing the camera**, whole body in frame, feet visible;
   - **plain background**, soft even light, no strong shadows;
   - nothing in the hands. The game adds weapons.

   A prompt that works well: *"full body character, T-pose, front view, realistic, PBR textures, neutral lighting, plain grey background, [the look from the table]"*.

2. **Turn the picture into 3D** with the tool's *image to 3D*. Pick **realistic** or **PBR** style, not cartoon.

3. **Check it before moving on.** You need all of these:
   - the hands have separate fingers, or at least a clean mitten shape;
   - the face reads as a face;
   - the back of the model is not a mess.

   If anything fails, regenerate.

4. **Export** as **FBX**, or as **GLB** if the tool only offers that. Use these settings:
   - **15 000 to 30 000 triangles**. Most tools have a "remesh" or "target face count" setting.
   - **one 2048 × 2048 texture set**: colour, plus normal and roughness if offered.

> **Skin and hair (the two Subject 07 models only).** The player picks a skin tone and hair colour in the menu, and the game recolours the model. So make Subject 07 with natural, mid-tone skin and **dark hair**. If the tool lets you keep hair as a separate material, do that. If not, that's fine, we handle it.

---

## 3. Rigging and animating on Mixamo (mixamo.com, free)

For **each** model:

1. **Upload Character** → choose the FBX (or OBJ/GLB as the site allows).
2. Place the markers: chin, wrists, elbows, knees, groin. Set **Skeleton LOD** to *Standard (65)*. Then **Next**.
3. If the preview walks properly, **Next** again. If the arms twist, re-place the markers.
4. **Download the character itself first**:
   - Format: **FBX Binary (.fbx)**
   - Skin: **With Skin**
   - Pose: **T-pose**
   - Save it as `<file name>.fbx`, for example `okoro.fbx`.
5. **Then each animation.** Search Mixamo for the name, click it, and tick **In Place** if the box is there. Download with:
   - Format: **FBX Binary**
   - Skin: **Without Skin**
   - Frames per second: **30**
   - Save it as `<file name>@<clip>.fbx`, for example `okoro@talking.fbx`.

Mixamo names change a little over time. If an exact name is missing, take the closest one: any fast run works for *run*.

### Subject 07 (both models)

| Clip name (`@…`) | Search Mixamo for | Where the game uses it | Priority |
| --- | --- | --- | --- |
| `idle` | Breathing Idle | menus, cutscenes, standing on the roof | Essential |
| `run` | Running *or* Fast Run | the Labs corridor, the roof | Essential |
| `jump` | Running Jump *or* Jump | jumping ducts, barriers, laser grids | Essential |
| `slide` | Running Slide | sliding under barriers | Essential |
| `strafe_left` | Left Strafe | changing lanes, moving on the roof | Essential |
| `strafe_right` | Right Strafe | changing lanes, moving on the roof | Essential |
| `hit` | Hit Reaction *or* Stumble Backwards | hit by a patient or an obstacle | Essential |
| `throw` | Throw *or* Throwing | throwing a sphere | Essential |
| `die` | Falling Back Death *or* Dying | a death | Essential |
| `fall` | Falling Idle | off a ledge, down a hatch | Essential |
| `dodge` | Sprinting Forward Roll *or* Dodging | the roof's dodge | Nice to have |
| `aim` | Rifle Aiming Idle | holding the launcher | Nice to have |
| `climb` | Climbing Ladder | the helicopter's ladder | Nice to have |
| `hang` | Hanging Idle | hanging from the ladder | Nice to have |
| `kneel` | Kneeling *or* Kneel | Okoro's death scene (grief) | Nice to have |
| `wake` | Getting Up *or* Stand Up | waking in the ward bed | Nice to have |
| `cheer` | Victory *or* Cheering | the escape | Nice to have |

### Dr. Okoro

| Clip | Search for | Use | Priority |
| --- | --- | --- | --- |
| `idle` | Standing Idle | cutscenes | Essential |
| `talk` | Talking | every conversation | Essential |
| `walk` | Walking | leading you out | Essential |
| `run` | Running | the escape | Essential |
| `point` | Pointing *or* Waving | showing the way | Nice to have |
| `die` | Dying *or* Death From The Front | his sacrifice in the Labs | Essential |

### Dr. Vale

| Clip | Search for | Use | Priority |
| --- | --- | --- | --- |
| `idle` | Standing Idle | monitors | Essential |
| `talk` | Talking *or* Arguing | monitors, the cockpit | Essential |
| `sit` | Sitting Idle *or* Sitting Talking | the pilot's seat | Essential |
| `laugh` | Laughing | his laugh | Nice to have |

### Patients and the brute

| Clip | Search for | Use | Priority |
| --- | --- | --- | --- |
| `idle` | Zombie Idle | waiting, swaying | Essential |
| `walk` | Zombie Walk | stalking | Essential |
| `run` | Zombie Running | the charge | Essential |
| `attack` | Zombie Attack *or* Zombie Punching | reaching you | Essential |
| `scream` | Zombie Scream | wind-up before the charge | Essential |
| `hit` | Zombie Reaction Hit | hit by a sphere | Essential |
| `die` | Zombie Dying *or* Zombie Death | going down | Essential |
| `climb` | Climbing *or* Zombie Stand Up | climbing out of the roof hatches | Nice to have |
| `crawl` | Zombie Crawl | the floor of the Labs | Nice to have |

### Scientists (lab coat and hazmat)

| Clip | Search for | Use | Priority |
| --- | --- | --- | --- |
| `idle` | Pistol Idle *or* Standing Idle | holding position | Essential |
| `walk` | Walking *or* Pistol Walk | moving on the roof | Essential |
| `shoot` | Shooting *or* Pistol Shoot | firing the gadget | Essential |
| `hit` | Hit Reaction | hit by a sphere | Essential |
| `die` | Dying | going down | Essential |
| `run` | Terrified *or* Running | fleeing | Nice to have |

---

## 4. Handing the files over

Put everything for one character in one folder named after it. For example:

```
characters-source/
  okoro/
    okoro.fbx            the character, with skin, T-pose
    okoro@idle.fbx       each animation, without skin
    okoro@talk.fbx
    okoro@walk.fbx
    ...
    okoro.png            optional: the picture you generated it from
  subject07_female/
    subject07_female.fbx
    subject07_female@run.fbx
    ...
```

Then do **one** of these:

- **Best:** on your fork (`siphokazi-tech6/CGV-Shattershift`), make a branch called `characters-source`, put the `characters-source/` folder at the top of the repo, commit and push. Tell me when it's there. I fetch it, convert it and commit only the small final game files to `main`. The raw FBX files never go into `main`.
- **Or:** zip the folder and share it where I can download it with a plain link (a public GitHub release or repo). Logins such as Google Drive or OneDrive won't work from my side.

Send characters as they are ready. One finished character is more useful than nine half-done ones. **Subject 07 female first**, then Okoro and `patient_a`.

---

## 5. Checklist per character

- [ ] Full body, T-pose or A-pose, realistic textures, 15–30k triangles, one 2k texture set
- [ ] Rigged on Mixamo; the preview walk looks right (no twisted arms, no stretched fingers)
- [ ] `<name>.fbx` downloaded **With Skin**, T-pose
- [ ] Every *Essential* clip downloaded **Without Skin**, 30 fps, In Place where offered, named `<name>@<clip>.fbx`
- [ ] Folder named exactly as in the cast table

---

## 6. What happens on our side

For the curious, and for the report:

- **Conversion.** One small script converts each folder into one optimised game file:
  - the textured, rigged model plus every clip;
  - metres, feet on the floor, facing forward;
  - textures capped at 2k.
- **Animation.** The game plays each clip on the real skeleton (three.js `AnimationMixer`):
  - smooth blends between clips;
  - the run's speed matched to how fast the character moves, so feet don't slide;
  - hits and throws played over the run;
  - deaths hold their last frame.
- **Looks.** Skin gets a soft-light shader so it doesn't look plastic, hair gets a sheen, and the player's skin and hair take the colours picked in the menu. The fire, glass and damage effects stay as they are.
- **Fallback.** Until a character arrives, the game keeps today's model for that role, so nothing breaks while files come in one at a time.
