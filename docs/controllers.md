# Controllers (PlayStation and Xbox)

A DualShock 4, a DualSense, an Xbox pad - or any pad the browser reports with the "standard" mapping - plays the whole game: every level, every cutscene prompt and every menu, without touching the keyboard or the mouse. Plug it in or pair it at any time and press a button; a toast names it (`CONTROLLER CONNECTED - DualSense`). The keyboard and mouse keep working alongside: whichever you touched last is the one the game talks about.

## The map

Buttons are given PlayStation / Xbox.

### In play

| Pad | Foundry, Labs, Skyline | The Roof |
| --- | --- | --- |
| Left stick or d-pad left / right | Change lane (held: keeps going) | Walk (the stick is analog: push it gently to walk slowly) |
| Left stick or d-pad up / down | Skyline: sprint / brake. Foundry and Labs: jump / slide | Walk |
| Right stick | Aim: the crosshair moves like a mouse, faster the further you push, faster still held at full tilt; with aim assist on, it slows over a target and drifts onto it | Aim the way it points, from Subject 07 (twin-stick); let it go and you aim the way you walk. With aim assist on, the enemy nearest that line |
| R2 / RT | Throw (the Foundry, by hand) or fire | Fire - hold it, the launcher keeps firing |
| L2 / LT (hold) | Focus: slow time | Focus |
| L1 / LB, R1 / RB | Previous / next sphere type | Sphere type |
| ✕ / A | Jump | Dodge; at the ledge, jump for the ladder |
| ○ / B | Slide (in the air: slam down into it) | - |
| △ / Y | Change camera | - |
| □ / X | Quick-time prompts only | |
| Options / Menu | Pause | Pause |
| Create / View | The VIEW menu: choose what the HUD shows | |
| L3 / LS (click) | Hide the whole HUD | |
| R3 / RS (click) | Photo mode (Foundry, Skyline) | |

The Gravity Fault lift's brake clamps (the demo ride) aim with the right stick and fire with R2.

### Cutscenes and quick-time prompts

- **Options / Menu**: tap to pause, hold to skip the talking (as `Esc` on the keyboard).
- **Prompts** draw the pad's own buttons while a pad is in use. Each reaction key has its button: `R` △/Y, `F` □/X, `Z` ✕/A, `X` ○/B, `G` L1/LB, `T` R1/RB; "tap Space fast" is ✕/A; the sprint off the falling bridge ("alternate A D") is left / right on the stick or d-pad. While a prompt is up those buttons answer it instead of doing their usual job, and pressing one it did not ask for is a wrong key - as a stray letter is on the keyboard.

### Menus

Over any menu (the main menu and its pages, pause, settings, chapters, Endless, the field manual, credits, the end screen, the briefing's first screen, the serum card, the VIEW menu, photo mode's panel) the pad moves a focus ring:

| Pad | |
| --- | --- |
| D-pad or left stick | Move the ring to the nearest control that way (held: repeats). On a slider or a list (quality, subtitle size...), left / right change it |
| ✕ / A | Press it: a button, a tick box, the next option of a list |
| ○ / B | Back (as `Esc`): out of a page, resume from pause, close the VIEW menu, leave photo mode |
| L1 / LB, R1 / RB | Switch tabs (the pause menu's Moves / Spheres / Power-ups, the field manual's sectors) |
| Right stick | Scroll a long page (the d-pad steps through one too) |
| Options / Menu | As `Esc` |

The ring starts on each screen's main action (Continue or New game, Resume, Run again, Got it) and comes back to where it was when you return to a screen. In photo mode the right stick orbits the camera and the triggers zoom (R2 in, L2 out).

## Settings > Controller

- **Stick aim sensitivity** (50-200%), separate from the mouse's.
- **Invert the aim stick's up and down** (also photo mode's tilt).
- **Vibration**: the pad rumbles when glass breaks, when you are hit, at an explosion and at a death (where the browser and the pad support it: `GamepadHapticActuator` "dual-rumble").
- The connected pad, and its buttons as listed above.

They are kept in the browser (`localStorage` `fractureRun.controller`); *Reset to defaults* resets them too.

## How it works

Nothing in the levels knows about pads. `src/systems/pad-input.js` reads the pads once a frame (through `src/systems/gamepad.js`, which names buttons by position, PlayStation-style) and turns them into the input the game already handles:

- **Buttons become keyboard events** with the same `code`s, dispatched on `window` - so the story's capture-phase listeners (the reaction prompts in `src/story/reaction.js`, hold-to-skip in `src/story/cutscene.js`) hear them first, exactly as they hear real keys. A press sends `keydown`, the release `keyup`, so holds work (sprint, hold-to-skip, "hold instead of mash").
- **The right stick is a virtual mouse**: `pointermove` / `pointerdown` / `pointerup` on the game canvas (not `window`: the handlers look at what was clicked). R2 and L2 are its left and right buttons. The mouse's sensitivity setting is undone so the stick's own setting applies.
- **The roof** takes the left stick as an analog vector (`MeltdownGame.padMove`, read where the roof reads WASD), so walking is smooth in any direction rather than eight-way; the right stick places the crosshair on the screen where "a few metres from the hero, that way" is, and the roof aims at it as it would at the mouse.
- **Menus** are spatial navigation over the visible, enabled controls of the top layer, with a ring drawn by `src/ui/pad-input.css` (`outline: 3px solid var(--hazard)` on `.pad-focus`, only while `<html>` has `pad-active`).
- **Prompts** follow the device: while a pad is in use `<html>` carries `pad-active` and `pad-ps` / `pad-xbox` / `pad-generic`, and `src/systems/key-glyphs.js` rewrites every key named on the page - each `<kbd>` by its text, and the key names in HUD lines, hints and the manual ("SPACE - JUMP THE DUCT", "USE GLASS (Q/E)", "(Space or W)") - and puts them back when the keyboard or mouse is used. No markup has to change for it; `[data-pad-hide]` hides keyboard-only words while a pad is in use, `[data-pad-keep]` opts an element out. The reaction prompts ask it for their keys' glyphs directly (`padGlyph(code)`), since they must be exactly the buttons the pad sends them from.
- **Rumble** wraps the shared sound effects (`padInput.feel(level1Audio, {...})`): every glass break, hit, blast and death in every level already plays one of them.
- **Connecting** a pad mid-game just works (the pads are polled); if the pad in use disconnects mid-run, the game pauses.

The pad pressed last drives; another connected pad takes over when you use it. `padInput.enabled = false` leaves the pads to a mode that reads them itself.

## Checks

```text
node tests/controllers/run.js            # menus, skyline, foundry, roof
```

A pretend pad (`tests/controllers/fake-pad.js`) stands in for `navigator.getGamepads`. The checks drive the menus (activate, back, tabs, sliders, Settings > Controller), the glyphs (✕ on a DualSense, A on an Xbox pad, keys again after the mouse), aiming, throwing, Focus, sphere type, the quick-time prompts, pause on Options and rumble in the Skyline, lanes in the Foundry, and analog walking, twin-stick aim, fire and the dodge on the roof. Pictures of the ring and the prompts go to `tests/controllers/shots/`.
