# Fracture Run - devlog script

**Target length: about 20 minutes** (the lecturer is happy with 10-25). The
script in full runs about 26 minutes, so everything is here to choose from;
**Fitting it to time** at the end says what to cut for 20, or for 15.

**How each scene is built.** The brief asks the devlog to explain *how we
handled lighting and effects, how the gameplay mechanics were designed, and
our original innovations*. So every scene follows the same three beats:

1. **What you do** - 10-20 s of play, so the marker sees it first.
2. **How it works** - the system behind it.
3. **How it looks** - the lighting, shaders and effects in that scene.

**Format of each scene below:** *Shots* (what to record), *Say* (draft
narration - read it naturally, change the words freely), and *Notes* (the
detail behind it, if someone asks or you want to go deeper). Narration is
always "we" - the game is the team's.

**Depth.** High to semi-medium: say *what* the technique is and *why* we
chose it, in one or two plain sentences, with the key idea named (Fresnel,
ray marching, instancing). No code on screen except where marked; a file
name on screen is enough to show it's ours.

---

## Before recording

- **Capture:** OBS at 1920x1080, 60 fps. Record the narration separately
  (a quiet room, one take per scene) and cut the footage to the voice.
- **Getting to scenes fast:** the **Chapters** screen jumps to any sector.
  The game's trailer mode (open the game with `?trailer` on the address)
  has a shot director, slow motion, god mode and a clean screen - use it
  for the cinematic shots; use normal play for anything explaining a
  mechanic, so the HUD shows.
- **Before / after shots:** Settings > Graphics turns effects, shadows and
  quality up and down. Recording the same moment twice - effects on, then
  off - is the clearest way to show what a shader adds.
- **Photo mode** (P, in the Foundry and the Skyline) gives free orbiting
  shots of a frozen moment.
- **Settings > HUD** hides panels one by one for clean shots.
- **Split the work:** one person captures each sector; one edits.
- **On-screen labels:** a small caption with the technique's name and its
  file (e.g. *Ray-traced glass - shaders/glass.js*) as it's explained helps
  the marker match it to the rubric.

---

## 0. Cold open - 0:00 (20 s)

**Shots** (no narration, the game's own sound, fast cuts):
a drone frying with purple arcs and blowing up · a pane shattering into
shards in the Skyline · the lift's cable snapping and the cabin dropping ·
a gravity sphere throwing a patient off the roof · the helicopter lifting
off. Title card: **FRACTURE RUN**, then *Devlog - Driven by Design*.

---

## 1. What Fracture Run is - 0:20 (1 min)

**Shots:** the burning tower from the menu stage; quick cuts of each sector.

**Say:**
> Fracture Run is a 3D action runner set in Ascension Tower, a research
> building that's coming down tonight. You're Subject 07, a test subject
> who wakes up in the middle of it. Dr Okoro, a scientist, helps you
> escape; Dr Vale, who ran the experiment, wants it buried; and the
> building's AI, HALCYON, keeps announcing what's failing.
>
> The escape goes up through four sectors - the Foundry, the Labs, the
> Skyline and the Roof - joined by lifts that are part of the game, not
> loading screens. In each one you run, dodge and throw glass spheres that
> shatter things - and each sector adds a new kind of sphere you'll need.
>
> It runs in the browser. We built it on Three.js with no game engine and
> no build step: every level, camera, shader and system you'll see is our
> own code, and the leaderboard runs on a small PHP server.

**Notes:** Three.js r160, plain ES modules (no bundler). Deployed as a zip
to a LAMP server; `api/leaderboard.php` is the only server code.

---

## 2. Booting and the main menu - 1:20 (1.5 min)

**Shots:** opening the game from cold - the loading screen - the first screen
(face to face with Subject 07 on a rooftop) - the camera swinging round to
the burning tower - the main menu over it. Move through the menu with the
mouse, then with a controller.

**Say:**
> The first thing you see is the loading screen, and it's doing real work:
> it waits until the first models are in and the shaders behind it are
> compiled, so when the menu appears, it answers straight away.
>
> That came from a real problem. On a laptop's built-in graphics, one of our
> shaders took over a minute to compile and froze the game. The fix was to
> stop calculating noise inside the shader hundreds of times, and read it
> from a small noise texture instead - that took it from seventy seconds to
> under two. Every level now warms up its shaders behind the loading screen,
> one at a time.
>
> The menu isn't a video or a picture. It's a live 3D scene - the tower
> burning at three in the morning, seen from the roof across the street,
> with rain, police helicopters and their searchlights - rendered while you
> pick what to play.

**Notes:**
- `src/systems/warm-up.js` compiles shaders for the render target they're
  really drawn into, a breath between each.
- `src/figure/noise.js`: the noise texture (12 s -> 0.6 s and 70 s -> 1.7 s
  for the two worst shaders on an Intel UHD 620).
- The menu stage: `src/menu/`. Helicopter searchlights are an additive
  cone shader (`src/fx/police-helicopters.js`).
- The tab remembers where you were: a refresh brings you back to the same
  menu page, or the same spot in a run, paused.

---

## 3. Customise - 2:50 (1.5 min)

**Shots:** Single player > Customise. Turn the figure. Change complexion,
hair, outfit colour (show a fold of the scrubs staying shaded), headwear,
shoes, then the Launcher tab and a few finishes (Tiger, Galaxy, Carbon).
Show a locked kit item and its unlock hint. The name card at the top.

**Say:**
> Customise happens on the same rooftop stage - the camera comes round to
> your character. Everything you pick is the real game model, as it will
> look in every level.
>
> Recolouring an outfit sounds simple, but if you just tint the texture you
> lose the folds, the seams, and later the dirt and blood. So the colour is
> applied inside the character's own shader: it knows which garment a pixel
> belongs to and recolours only that, keeping all the shading. Complexion
> works the same way, as a tint on the skin.
>
> Headwear is built in code from simple shapes and sized to the head - we
> measure the model's head width and brow line, so a cap fits whichever
> character you play. The launcher has eleven finishes, real patterns like
> tiger print and camo, and two kits unlock for finishing the story and
> earning every trophy.

**Notes:** figure shader `src/figure/look.js` (garment from the atlas UV);
headwear `src/figure/outfit.js`; finishes `src/figure/launcher-skins.js`;
kits `src/figure/kits.js`; the studio `src/modes/locker/`.

---

## 4. The briefing - 4:20 (1.5 min)

**Shots:** New game > the briefing: the REC overlay and timecode, a chapter
title glitching in, the operating theatre (the surgical light, the
anaesthesia machine and its monitor), the labs set, the boardroom, the end
title cracking into place.

**Say:**
> The story opens with Okoro's recording - his confession of what the
> experiment was and why the tower is coming down. It's staged in the
> engine, not pre-rendered: real 3D sets with our characters in them.
>
> We wanted it to feel like found footage, so it's drawn through a camera
> overlay - a recording light, a running timecode, film grain and a
> vignette - and each chapter's title glitches onto the screen.
>
> The sets are dressed to be believable: the operating theatre has a twin
> surgical light on its arm, an anaesthesia machine with a live heart
> monitor, an instrument tray, a crash cart. Every line is voiced, and the
> subtitles follow the voice, so a line lasts exactly as long as it's said.

**Notes:** `src/story/prologue.js`, the sets in `src/story/stages/`
(`medical-props.js`). Voices made with VoxCPM2 / OmniVoice; music Kevin
MacLeod (CC BY) - see the credits.

---

## 5. Sector 01 - The Foundry - 5:50 (2.5 min)

**Shots:** the first stretch behind the player: changing lanes, jumping a
low barrier, sliding under a high one, throwing at a glass switch and the
gate opening. A pressure cell breaking, the combo climbing. The pistons in
the Rolling Floor, the moving walls, a hit (the lights flashing red). The
escape: gates closing, only the centre lane open, the Extraction Valve.
Okoro running ahead. A light shaft and a furnace mouth up close.

**Say - what you do:**
> The Foundry is where you learn the game. You run down three lanes - change
> lane, jump, slide - and throw glass spheres at anything made of cyan
> glass. The rule is simple and we never break it: cyan and glowing can be
> shattered; red and amber metal can't, you have to get past it.

**Say - how it works:**
> The idea of this level is that the route changes because of what you
> shoot. Glass switches open gates, lock down pistons and stop the moving
> walls. Three of them are needed to get out; the other three just make the
> next stretch easier, so a sharp player is rewarded and nobody gets stuck.
>
> There are also small glass cells all along the walls. Every break builds
> your combo up to times nine, and every cell gives a sphere back - so the
> only thing that drains your spheres is missing. When we simulated players
> who shot everything, they ran out before the final switch and couldn't
> finish, so you now get one sphere back every few seconds at zero.
>
> The machinery is built as a hierarchy: a piston is a housing, a shaft and
> a head, each moving relative to its parent, and it snaps out fast and
> retracts slowly so you can read its timing. Every obstacle's height was set
> against the player's body - a standing player, a sliding one - and we
> swept a player-sized box down all three lanes of the route to prove
> there's always a way through.
>
> The escape at the end is a test of lane discipline: the gates close as you
> reach them, and near the end only the centre lane is open.

**Say - how it looks:**
> It's meant to feel enclosed and loud: dark steel, hazard stripes and
> furnace orange. A light travels with you, the furnaces pool orange on the
> floor, and red strobes warn you. When you get hit, every light near you
> bleeds to alarm red and flickers, so you feel it from any camera.
>
> The beams of light under the ceiling lamps are a shader: a cone that's
> brightest near the lamp and fades softly toward the floor and at its edges,
> like dusty air catching light. The furnace fire is noise scrolling up
> through a fire colour ramp, and every furnace is drawn in one go - that's
> instancing. The embers drifting out are particles whose whole life is
> worked out on the graphics card.
>
> And your character gets dusty as you go: the same shader that colours the
> outfit spreads dirt with noise, and the dirt grows as the run goes on.

**Notes:**
- Route 764 m in three beats - Intake, the Rolling Floor, the Escape
  (`src/levels/foundry/`, design sheet `docs/level-2-foundry.md`). In the
  game the route is built straight (`straightRoute: true`); the curved
  junctions exist in the level's standalone preview only.
- Six switches (Route Gate, Intake Bypass, Piston Lock, Wall Retract,
  Pressure Bleed, Extraction Valve), 46 pressure cells, speed in three
  zones (6.8, 9.0, 11.6 m/s).
- Collision is box against box (`level.collide`), only the hazards within
  9 m - two or three tests, not forty.
- Camera: a chase camera 4.2 m up and 8.5 m behind (C: first person, at eye
  height), easing toward its place each frame (exponential smoothing) and
  aimed at a point 12 m ahead; shake on a hit; the view widens under
  Overdrive. The cutscenes and the exit lift have their own cameras.
- Movement: three lanes 3.2 m apart, eased into; a jump of 7.4 m/s against
  19 m/s² gravity (1.44 m high, 0.78 s in the air) with a jump buffer; a
  0.65 s slide that, pressed in the air, slams you down into it.
- Okoro's guide (`src/story/foundry-guide.js`) runs ahead, never into your
  lane close to you.
- One checkpoint per level; restarting there gives 75 / 50 / 25 integrity
  by difficulty, once.

---

## 6. The Gravity Fault - the lift to the Labs - 8:20 (2 min)

**Shots:** the doors closing; the lift's security camera of Okoro and 07; the
tremor and the left pane cracking - watch the cracks spread - then blowing
out; the cable snap, blackout, red beacon, freefall with things floating;
the brakes biting in a shower of sparks; the launcher crashing through the
roof and being picked up; the clamps with the diagnostic picture-in-picture.

**Say:**
> The brief asked for lifts that are part of the game, not a loading screen,
> and this is where it shows. Halfway up, the tower starts coming down
> around the lift.
>
> It's a sequence of phases, each with its own cameras, lights and physics.
> First a quiet moment through the lift's security camera - drawn at twelve
> frames a second with scanlines and grain, like real CCTV. Then the tremor:
> the glass cracks, and you watch the cracks spread from the impact point
> before the pane blows out.
>
> Then the cable snaps. For two seconds it's a real free fall, and inside
> the cabin everything goes weightless - you, the toolbox, the shards float
> up - until the brakes bite in a shower of sparks and everything slams
> down. A launcher falls through the roof from the lab above, and that's the
> weapon you carry from here on.
>
> To stop the brakes slipping you hit three brake clamps, and one of them is
> watched through a top-down diagnostic view - a second, orthographic camera
> drawn as a hologram in the corner of the screen.

**Say - how it looks:** *(cut if long)*
> The tower outside has no textures at all: its windows are a grid worked out
> in world space by a shader, so any building gets lit offices, dark glass,
> and floors burning below a fire line. The sparks are streaks drawn along
> their own velocity, cooling from white to orange.

**Notes:** `src/elevators/gravity-fault.js` (`PHASES`), cracks
`src/elevators/glass.js` (a crack texture revealed by a growing radius),
sparks `sparks.js`, the hologram `diagnostic.js` (one override material:
edges bright where surfaces turn away, scanlines), the facade `shaders.js`.
In the story the clamps are quick-time prompts with 1.2x longer windows.

---

## 7. Sector 02 - The Labs - 10:20 (3 min)

**Shots:** the breach - incubators bursting, Vale on the wall monitor. Running
with the fire behind you (press C to the cinematic camera, which runs ahead
and looks back, to show it). Firing the launcher;
holding for a charged shot (the bar, the screen pulling in, the air
stripes). A laser grid and its floor line. A fire wall: changing to cryo and
putting it out. The blackout: the flashlight beam through the smoke. The
patient at the bend - the struggle, then pushing it off. A patient burning
to ash. Okoro, the desk, the doors closing on him.

**Say - what you do:**
> The Labs turns the runner into a chase. The building is on fire behind
> you, and the fire is your health bar made visible - the lower your
> integrity, the closer it runs. Okoro runs ahead of you with his pistol,
> and you now have the launcher: tap to fire, or hold to charge a shot that
> flies faster, flatter and bursts bigger.

**Say - how it works:**
> This is where the spheres start to matter. Fire walls block the whole
> corridor - too tall to jump - and only a cryo sphere puts them out. That's
> deliberate: our lecturer told us the sphere types should be necessary,
> not optional, so every sector now has something only its sphere can
> handle. Every difficulty is guaranteed fire walls, so you can't skip the
> mechanic by luck.
>
> We also changed things from feedback. Laser grids were hard to judge in
> depth, so each one now has a glowing line on the floor beneath it and the
> camera sits higher, looking down at the floor ahead. And a hit is now a
> short stumble rather than a long pause - we tried a 3-2-1 after every hit
> and it broke up the run, so the countdown only comes back after cutscenes
> and when you unpause.
>
> At the first bend a patient comes out of the dark at you. It's a
> struggle - tap fast to push it off. You get one chance; lose it and it
> gets you.

**Say - how it looks:**
> The fire is made of camera-facing quads, each a flame shape licked
> sideways by moving noise and coloured like heated metal, from white to
> red. They're blended additively, so overlapping flames build up into a hot
> core without having to be sorted.
>
> When the experiment blows the power, the only light is emergency strips,
> fire and the beam from your launcher. That beam looks volumetric, but it's
> a cheap trick: a cone mesh with noise fixed in the world, so the smoke
> stays put as you sweep the light through it, and soft edges based on the
> viewing angle.
>
> Vale's face on the monitor is a second camera rendering her into a
> texture, which the screen then displays. And when a patient goes down, it
> burns away from the head down: a shader compares noise to a threshold that
> falls down the body, throws away the pixels past it, and leaves a band of
> glowing embers at the edge.
>
> Underneath it all, the Labs has its own grading pass driven by four
> gameplay numbers - heat, being hit, danger and darkness - so heat haze
> grows as the fire closes in and the edges of the screen close in near
> death. On high quality there's also ambient occlusion, which darkens
> corners and the gaps under desks.

**Notes:**
- Beats: Recovery Ward, Containment Corridor, Blacked Out, Stairwell Ascent;
  each drains integrity at its own rate (`src/levels/meltdown/index.js`).
- Fire `fire.js`, smoke `smoke.js`, flashlight `flashlight.js`, ash `ash.js`
  (spliced into Three's own material with `onBeforeCompile`), grading
  `post.js` (`uHeat`, `uHit`, `uDanger`, `uDark`), SSAO `ao.js` (depth
  buffer, 12 rotated samples).
- The charged shot: `src/systems/charge.js` (screen pull, colour split,
  crackle at full) and the air stripes `src/fx/charge-trail.js`.
- The story director: `src/story/labs-director.js`.
- Camera (`src/levels/meltdown/game.js` `_updateCamera`): four rigs on C -
  chase (default: about 7 m back, 3.3 m up, looking 14 m ahead), first person
  (1.65 m, head bob, a dip on landing), cinematic (ahead and to the side,
  looking back at you) and orbit. Each follows on a critically damped spring,
  so it glides round the route's real 90-degree turns (9 m radius). It leans
  into lane changes, widens with speed (72 to about 79 degrees, plus 9 under
  Overdrive) and has trauma shake (squared). The cutscenes are first person.
- Movement: the lanes are a critically damped spring too (no overshoot); a
  jump of 7.6 m/s, rising at 19 m/s² and falling at 27 (about 1.5 m high,
  0.74 s in the air); a 0.16 s input buffer; a 0.7 s slide; a mid-air slam
  at 16 m/s. Speed per beat: 8.2, 11, 9.4, 14 m/s. A hit knocks you to 22%
  speed and eases back over 0.6 s.
- Textures: drawn on a canvas at load (`textures.js`), with normal maps made
  by Sobel-filtering a height image; then Poly Haven CC0 photo sets
  (`photo-textures.js`) swap in as they load, decoded off the main thread,
  into materials prepared with stand-in maps so nothing recompiles.
- Lighting (`lighting.js`): a hemisphere and a key light that turn red as
  your integrity falls; a fixed pool of point lights bound to the nearest
  emitters; an environment map dimmed in the blackout; a shadow-casting key
  light over the player at High quality; bloom at a third of the resolution.

---

## 8. The quiet ride - the lift to the Skyline - 13:20 (1.5 min)

**Shots:** the doors closing on the burning Labs corridor and on Okoro; 07
turning to the glass, the city below; sliding down to sit; the static from
the bag; holding to open it, taking the radio out, tuning it (the dial
turning to 121.5, KESTREL ONE); the pilot's lines; putting it away; taking
the launcher; the chime; the doors opening on the skybridge.

**Say:**
> After the Labs comes the quiet moment the story needs. Okoro stayed behind
> so you could get out, and for the first time you're alone.
>
> We made it something you do, not just watch. Static crackles from his bag.
> You hold to open it, take out his radio and tune it in - the dial turns,
> the signal bars fill, the static clears - and it's the helicopter pilot,
> asking for the doctor, then telling whoever has the radio how to reach the
> roof. Each step waits for you, with no timer; the lift waits with you.
>
> The landings are real places built into the tower: the Labs corridor on
> fire as the doors close, and the Skyline's corridor where they open. And
> outside is the same city you'll see from the roof.

**Notes:** `src/elevators/quiet-ride.js` (`GATES`: each a held prompt),
`landings.js` (the tower built with real doorways), the city from
`src/levels/meltdown/city.js` and `cbd.js`.

---

## 9. Sector 03 - The Skyline - 14:50 (3 min)

**Shots:** a close-up of a glass pane - the city refracting through it, the
colour fringes at its edge; breaking it and the shards bouncing. A fire;
throwing cryo into it and it shrinking. Shooting a sprinkler's red bulb, the
water, the wet floor reflecting. The smoke thickening, the warning, breaking
a vent. A security drone: its red scan, the lock, changing lane, then a
shock sphere - frying, haywire, blowing up. The bridge collapsing behind you
in the chase. The three locks on the gate; the lift.

**Say - what you do:**
> The Skyline is the shader showcase: a glass skybridge between towers, high
> over the city, with the tower opposite being demolished.
>
> You manage two dangers here. Fire burns integrity - shoot a sprinkler's
> bulb to flood it, or freeze it with cryo. And smoke fills the bridge -
> break the covers off the air vents to pull it out. The HUD warns you as the
> air turns and tells you where the next vent is.
>
> The new sphere is shock, and it's the only thing that can bring down
> HALCYON's security drones. A drone flies ahead of you, sweeps your lane
> with a red scan, locks on and fires down it - you change lane to dodge,
> and hit it with shock to fry it. Glass and cryo just glance off its armour.

**Say - how it looks:**
> The glass is our favourite piece of work, because it's actual optics per
> pixel. The reflection comes from a live probe of the surroundings, and how
> much you see of it depends on the viewing angle - that's the Fresnel
> effect. Light passing through bends by Snell's law, with a slightly
> different amount for each colour, which is what gives those rainbow
> fringes at the edges. And thicker glass absorbs more light and looks
> greener, by the Beer-Lambert law.
>
> The fires are volumetric: instead of a flat sprite, the shader marches a
> ray through a box, sampling a noise density as it goes and turning
> temperature into colour. That's why you can see depth inside the flames,
> and because the fire's size is a uniform driven by the game, cryo and the
> sprinklers visibly shrink it.
>
> When glass breaks, the shards are worked out entirely on the graphics card:
> each shard's position is a formula of time - its flight, its spin, one
> bounce on the floor. The computer only spawns them, so hundreds of shards
> cost almost nothing.
>
> And the night sky has stars, a moon and a layer of clouds lit orange from
> below by the burning city, also ray-marched.

**Notes:**
- Beats: Containment Ward, Skybridge B, Resonance Atrium; the bridge
  collapses behind you from 262 to 528 m (`src/levels/causeway/`).
- Glass `shaders/glass.js` (Schlick Fresnel, Snell with dispersion,
  Beer-Lambert), the probe `probe.js`, fire `shaders/fire.js`, sky
  `shaders/sky.js`, particles `shaders/particles.js` (shards: Rodrigues'
  rotation, one bounce), wet floor `kit.js` `wetFloor()`. The full write-up
  is `docs/shaders-explained.md`.
- Drones `drones.js`: scan -> lock -> bolt down the locked lane; shock is
  checked against the sphere actually thrown (a charged glass shot bursts
  like shock but doesn't count).
- Serum capsules (power-ups) are a glass sphere ray-traced around a
  signed-distance-field ray march of the serum inside.
- The lift gate's three locks open only in order, each to a direct hit.

---

## 10. The Roof - 17:50 (3 min)

**Shots:** arriving on the roof in the rain; the over-the-shoulder camera
turning all the way round, then C for the top-down view; the tactical map in
the corner. Patients climbing out of hatches, a charge and a dodge; a
scientist's orb; the brute. A gravity sphere lifting patients and throwing
them off the open ledge. The red circle of a flying patient, a quick-shift
dodge; then a grab - the first-person struggle - winning and shooting it
off; (separately) losing, the bite, the eyes closing. The load-shedding
blackout: the city going dark district by district, the generator. A
building being demolished. The helicopter, the ladder, the ending.

**Say - what you do:**
> The roof is an arena: hold out until the helicopter can land. You move
> freely now, and the camera is over the shoulder - the mouse turns it all
> the way round - or top-down if you prefer. Patients climb out of the
> hatches and charge you; scientists throw energy orbs; the last wave brings
> a brute that shrugs off spheres.
>
> The last sphere is gravity, and here it's the answer to the brute: it opens
> a black hole that lifts everyone near it off their feet and flings them at
> the open ledge. The roof's two sides are open, so the edge is a weapon - for
> you and against you.
>
> Then there are the flying patients. A red circle marks where one will
> swoop; on Easy you can walk out of it, but on Hard it comes too fast and
> only the quick shift - a dodge - gets you out. If it grabs you, the view
> goes first person: you struggle up close, and if you win you shoot it off
> point-blank. If you lose, it bites, your eyes close, and it carries you
> away.

**Say - how it works:**
> Halfway through, the city's power goes out - load-shedding. District after
> district goes dark as a front rolls toward you, the roof's floodlights die,
> and the light is the helicopters, a red strobe, your launcher's torch and
> your spheres. Every light in the city reads one shared value - how far the
> outage has reached - so the whole city goes dark in one sweep without
> adding or removing a single light, which would freeze the game while
> shaders recompile.
>
> Around you, the city is at war with itself: buildings are demolished and
> topple, and the sky fills with smoke. The roof has its own tactical map -
> another orthographic camera, drawing the roof from straight above with
> flat icons on a layer the main camera never sees.

**Say - how it looks:** *(cut if long)*
> The rain is thousands of streaks in a single mesh, moved entirely in its
> vertex shader. The towers' windows are mapped in world space, so a
> four-hundred-metre tower gets four hundred metres of windows instead of a
> stretched texture.

**Notes:**
- `src/levels/meltdown/roof.js` (waves, the brute's armour, `LIFT` for
  gravity), `flying-zombies.js` (pacing per difficulty, `ENDLESS_RAMP`, the
  first-person struggle), `load-shedding.js` (`uGrid`), `weather.js`,
  `roof-map.js`, `demolition.js`, `city.js`.
- The ending: the helicopter, the ladder latch (a quick-time event), the
  ending cutscene and the credits (`src/story/ending-director.js`).

---

## 11. 3D effects recap - 20:50 (1.5 min)

**Shots:** a montage, each shot captioned with its technique: bloom on the
Foundry's lamps; heat haze; the hit flash; glass; volumetric fire; the
flashlight; ash dissolve; GPU shards; the shield bubble; the menu's
searchlights. Then the same scene with effects on and off.

**Say:**
> Under all of it is our own post-processing pipeline - we didn't use
> Three's built-in one. The scene is rendered into a high-dynamic-range
> image, then the glass and fire are layered on, then bloom - bright parts
> blurred at quarter resolution and added back - and finally a composite
> pass with heat haze, anti-aliasing, a slight colour split, filmic tone
> mapping, vignette and grain.
>
> Across the game there are more than thirty hand-written shaders. A few
> ideas come up again and again: Fresnel - things glow at their edges;
> noise - for fire, smoke, dirt and dissolves; instancing - drawing many
> copies at once; and doing the work on the graphics card instead of the
> processor, like the shards and the particles. We also extend Three's own
> materials rather than replacing them, so the ash, the wet floor and the
> character's wear keep proper lighting and shadows.

**Notes:** `src/fx/postfx.js`; the full list with where to see each:
`docs/shader-tour.md`.

---

## 12. Innovations - 22:20 (3 min)

**Shots for each, 15-20 s:**

**Spheres with a job, earned sector by sector.** An unlock card before a
sector (the pictures, the keys). *Say:*
> Your abilities grow with the story: each sector hands you a new sphere and
> a new ability, introduced on a card like a console game does, with what it
> does and which keys use it. And each sphere has a job only it can do -
> cryo for fire walls, shock for drones, gravity for the brute.

**Customisation** - a quick callback to section 3.

**Multiplayer.** The Arena (King of the Hill and Capture the Flag on the
roof, 2-4 players), the line-up, the podium; the split-screen Race. *Say:*
> We added local multiplayer. The Arena puts two to four players on the
> roof with one camera that pulls back as they spread out - hold the
> helipad, or capture the other team's core, with knock-offs over the open
> ledges. The Race is split screen: two players through the Foundry, the
> Labs or the Skyline, each aiming on their own half.

**Controller support.** A controller connecting (the card in its colour),
the prompts switching to its buttons, the menus driven with the D-pad. *Say:*
> Any controller works through the browser's Gamepad API. Rather than
> rewrite every level for it, we translate the controller into the keys and
> mouse the game already understands - so every level, lift and menu works.
> The prompts change to that controller's own button names, PlayStation or
> Xbox, and quick-time events become stick flicks that work the same on any
> pad.

**Touch screens.** A phone held sideways: swipes and taps in a runner, then
the Roof as a phone shooter - the stick, dragging to look, SHOOT, DODGE, the
sphere button. *Say:*
> And it plays on a phone. In the runners you swipe to move and tap where you
> want to throw. On the roof it becomes a phone shooter: a joystick on the
> left - fixed or floating, your choice - drag the right side to look, and
> buttons for shoot, focus, dodge and the next sphere. Like the controller,
> it's a translation layer over the same game.

**Global leaderboards.** The Leaderboards screen, choosing a unique name.
*Say:*
> There are global leaderboards - fastest escape, high scores, each Endless
> level - with unique names checked as you type. If the server can't be
> reached, your bests wait in the browser and go up when it answers.

**Everything else** - a fast montage: Endless mode (a new layout every run),
ghosts (racing your best run), trophies with a platinum, the 360-degree
photo mode, the run report, accessibility. *Say:*
> And around the core game: Endless modes laid out afresh every run, a ghost
> of your best run to race, trophies, a 360-degree photo mode, and
> accessibility options - reduced motion, longer reaction windows, holding
> instead of mashing, subtitle sizes and separate volume controls.

**Notes:** progression `src/systems/progression.js`, cards
`src/ui/unlock-card.js`; Arena `src/modes/arena/`, Race `src/modes/race/`;
controllers `src/systems/gamepads.js` (the pad bridge),
`input-glyphs.js`; touch `src/systems/touch-controls.js`; leaderboard
`src/systems/leaderboard.js` + `api/leaderboard.php` (SQLite, or a JSON
file where SQLite isn't available); ghosts `src/systems/ghosts.js`; photo
mode `src/fx/photo-mode.js` (a cube camera turned into a 360 image by a
shader).

---

## 13. How we built it - 25:20 (1 min) *(trim this first if over time)*

**Shots:** a feedback document scrolling; a test run in a terminal; a bot
playing a level by itself; the phone-sized test screen.

**Say:**
> We worked in rounds: build, playtest, take the lecturer's and testers'
> feedback, and log every change against it. To keep a game this size from
> breaking as it grew, we wrote automated checks - bots that play each level
> on their own, sweeps that prove every obstacle has a way through, and
> tests that drive the game with simulated touches at phone size. When
> something broke, a check usually told us before a player did.

**Notes:** `docs/feedback-round-*.md`; the checks in `tests/` (Playwright),
e.g. `tests/causeway/checks/bot.js`, `tests/meltdown/checks/fairness.js`,
`tests/touch/`.

---

## 14. Close - 26:20 (20 s)

**Shots:** the helicopter lifting off the roof; the title; *Driven by
Design* and the six names together; the credits for the music, voices and
models.

**Say:**
> That's Fracture Run - four sectors, two lifts, four spheres, and a lot of
> glass. Thanks for watching.

---

## Fitting it to time

The full script runs about **26 minutes** read at an easy pace with its
footage - over the lecturer's 25. To land at **about 20**:

- cut the lines marked *(cut if long)* (about 1.5 min),
- trim section 13 to two sentences (about 40 s),
- in section 12, show *Everything else* as a 10-second montage with one
  line (about 40 s),
- in each level, keep *what you do* and *how it looks* in full and shorten
  *how it works* to its first paragraph (about 3 min).

For **about 15 minutes**, also drop the Gravity Fault's *how it looks*
and shorten the briefing and the menu to 45 s each.

## Rubric checklist - where each part is covered

| Rubric area | Where in the devlog |
| --- | --- |
| Viewing (cameras, avatar) | Foundry chase camera and boom; Gravity Fault's CCTV and orthographic diagnostic; Roof over-the-shoulder / top-down / tactical map; first-person in the quiet ride and the struggle |
| Control & playability | Every *what you do*; controller and touch in section 12 |
| 3D effects | Every *how it looks*; recap in section 11 |
| Shaders | Glass, volumetric fire, ash dissolve, figure wear, GPU shards, flashlight, facade; section 11 |
| Gameplay & experience | The story through sections 4-10; spheres with a job; difficulty and checkpoints |
| Polish | Loading and warm-up (2), pause and countdown (7), settings and accessibility (12) |
| Innovation | Section 12 - progression, customisation, multiplayer, controllers, touch, leaderboards |
