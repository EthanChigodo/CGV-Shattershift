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
bottom of the actual view before a 0.45-second dramatic/audio-fade hold begins.
Game Over uses the existing event/UI immediately after that hold; its timing is
based on observed exit, not a fixed disappearance timer. The shot is normally
about 3.4 seconds. There is no black fade or second captured-frame death effect.

## Live Game Over background

`MeltdownGame.roofFallBackground` is true only for a completed exterior shot in
the `over` phase. The host's `deathKind` then skips `DeathFX.play`, whose normal
fall effect copies the last canvas frame. Other deaths still use that effect.
Removing the shot's black fade also removes the condition which made the host's
black-screen detector show a spurious loader. No new loading, scene switch,
capture or background image runs at this handoff. Legitimate level/menu loading
continues unchanged.

The same Roof scene, camera and compositor remain in the existing render loop.
Position, aim, FOV, player/weapon and run statistics remain frozen. Only the
lightweight decorative facade clock advances; gameplay timers and normal camera
controllers do not run behind results. The existing statistics, score, messages
and buttons are unchanged. The scoped `roof-fall-background` class uses a 32%
dark veil and a 5 px CSS `backdrop-filter` (plus the WebKit form): the live building
is blurred, not the foreground UI. Browsers without backdrop-filter retain the
darkened live scene and sharp UI without blur.

The host's existing phase listener applies `roof-fall-cinematic` synchronously
when the fall starts. Gameplay HUD panels, sphere wheel, vitals, gameplay prompts
and late toasts stay hidden during the shot and behind results. The results and
pause screens are not targeted. A new phase or leaving the Roof removes this
temporary class, restoring the player's normal HUD preferences on retry/menu.

Retry and menu use the existing reset/unload paths: remove the scoped class,
restore the launcher parent/pose and avatar animation, clear the shot/fade/audio,
then rebuild or dispose the Roof as usual. No additional listeners, render loops,
timers, screenshots or GPU resources are allocated for the results background.

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
node --test tests/rooftop-fall.test.mjs tests/rooftop-facade.test.mjs tests/ammo-recovery.test.mjs
node tests/rooftop-fall-browser.mjs --shots --full-game
py tools/serve.py 8000
```

The optional browser test uses installed Edge and Node 24's native CDP/WebSocket,
without installing dependencies. Set `ROOF_FALL_CHROMIUM` for another Chromium
executable. Screenshots go to a printed temporary directory outside the repo;
the isolated browser profile is removed on exit. It exercises real Roof movement,
shader compilation, side framing, horizontal body pose, detached faster bazooka,
camera lock, complete bottom exit, pause, delayed Game Over, weapon reattachment
on restart, hatch exclusion, cleanup, audio decoding, and the existing standalone
Roof checks. `--full-game` also opens the actual index/main.js under a server
subdirectory and checks direct live results, no capture/loading/compile calls at
death, unchanged statistics, camera persistence on resize, actual Retry/Menu
buttons, resource cleanup and hatch/other-level exclusion. Software WebGL
is not representative hardware performance or a listening test.

Open `http://localhost:8000/preview/meltdown.html?roof` for the isolated Roof,
or use `http://localhost:8000/` and select the Roof via the game's existing modes.
Walk off each open side with A/D. Check the arm/leg motion and facade, wait for
the camera to stop, then watch the body leave the bottom before Game Over. The
bazooka should tumble below the person and leave first. On the full game page,
the recognisable building must remain behind the sharp existing statistics panel
with a subtle blur: no captured picture, black screen or loader in between.
Retry must remove the overlay/blur and restore the original camera and controls;
Back to menu must release the Roof. Repeat with
both characters, pause/resume during the shot, and retry/return to menu using
the full game's existing buttons. Also check a hatch and a lethal enemy hit:
neither should play the cinematic. Space retains its existing Roof dodge/ladder
interaction; this feature does not add a new jumping mechanic.

Full-story playthrough, subjective blur/audio/animation quality and hardware FPS
on the target lab PC still need human playtesting. The existing
Playwright all-sector suite requires its separately installed test dependency.
