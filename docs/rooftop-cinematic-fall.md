# Rooftop exterior falling shot

Only the existing Roof combat phase can enter `roofFall`. `RoofLevel.exteriorAt`
uses the same +/-16 m footprint as `groundAt`; losing support inside a hatch is
remembered separately. An exterior fall is confirmed only when still outside,
descending faster than 1 m/s, and below -0.65 m. Ordinary airborne movement does
not qualify. Existing north/south parapets remain solid; no new exits are opened.

`roof-fall.js` owns the shot, independent of enemy AI. In 0.28 seconds the camera
transitions to an outside, side-facing view with the facade behind the body and
a 54-degree FOV. It follows downward, brakes between 2.0 and 2.4 seconds, then
locks position AND aim permanently. It does not tilt farther down to track the
departing body. Conservative projected bounds must entirely cross below the
bottom of the actual view before a 0.45-second dramatic hold and 0.5-second fade
can begin. Game Over uses the existing event/UI; its timing is based on observed
exit, not a fixed disappearance timer. The shot is normally about four seconds.

`PlayerAvatar.updateFall` uses the existing merged-mesh vertex rig: independently
changing shoulders/elbows, unequal hip/knee angles, and a near-horizontal,
belly-down body with small unstable pitch and roll. Rotation is about the hips,
not the toes. Reduced Motion attenuates flailing, not gravity. The ordinary rig has
zero falling weight; its animations and character appearance remain unchanged.

The actual held bazooka is detached into the scene with its world pose intact;
no cloned weapon, geometry or material is created. It tumbles with inherited
momentum and lower aerodynamic drag: player terminal speed 32 m/s, weapon 90 m/s,
both using the same 24 m/s² game gravity. It is visibly below the player and
leaves the frame first. Reset restores its original parent, local position,
rotation, scale and visibility. Normal weapon/shooting rules are unchanged.

The tower retains its existing box and dimensions. Its opaque Standard material
now includes world-space parallax offices, glass damage and lighting variety;
one instanced trim batch adds physical lintels/mullions to the upper floors.
There are no probes, render targets, transparent layers, reflection passes or
graphics settings. Normal Three lighting, tone mapping and fog still apply.
Details and limitations are in `rooftop-building-visuals.md`. No textures,
materials or geometry are created per frame.

## Audio

The shared `Level1Audio` owns one controllable scream and the existing wind bed.
The current character selects `assets/audio/sfx/scream-f.mp3` (2.309125 seconds)
or `scream-m.mp3` (4.8 seconds); the wind is
`assets/audio/sound-effects/wind1.wav` (59.998896 seconds). These durations were
decoded in the browser. The scream preserves its attack, then sustains the middle
using a 120 ms PCM overlap. The two derived buffers are cached and never alter
normal death screams. Distance attenuation begins after camera lock-off; all
cinematic audio fades during the post-exit hold. Pause freezes the scream playhead; a
late decode cannot survive reset/menu cleanup. Background music uses the current
game-over duck, without restarting its track.

No new audio is downloaded. Existing scream credits are in `docs/credits.md`.
The existing wind file's source/licence is marked pending there; this task does
not resolve that pre-existing attribution gap.

## Local verification

From the repository root:

```powershell
node --test tests/rooftop-fall.test.mjs tests/ammo-recovery.test.mjs
node tests/rooftop-fall-browser.mjs --shots
py tools/serve.py 8000
```

The optional browser test uses installed Edge and Node 24's native CDP/WebSocket,
without installing dependencies. Set `ROOF_FALL_CHROMIUM` for another Chromium
executable. Screenshots go to a printed temporary directory outside the repo;
the isolated browser profile is removed on exit. It exercises real Roof movement,
shader compilation, side framing, horizontal body pose, detached faster bazooka,
camera lock, complete bottom exit, pause, delayed Game Over, weapon reattachment
on restart, hatch exclusion, cleanup, audio decoding, and the existing standalone Roof checks. Software WebGL
is not representative hardware performance or a listening test.

Open `http://localhost:8000/preview/meltdown.html?roof` for the isolated Roof,
or use `http://localhost:8000/` and select the Roof via the game's existing modes.
Walk off each open side with A/D. Check the arm/leg motion and facade, wait for
the camera to stop, then watch the body leave the bottom before Game Over. The
bazooka should tumble below the person and leave first. Repeat with
both characters, pause/resume during the shot, and retry/return to menu using
the full game's existing buttons. Also check a hatch and a lethal enemy hit:
neither should play the cinematic. Space retains its existing Roof dodge/ladder
interaction; this feature does not add a new jumping mechanic.

Full-story menu/retry navigation, subjective audio/animation quality and
hardware FPS on the target lab PC still need human playtesting. The existing
Playwright all-sector suite requires its separately installed test dependency.
