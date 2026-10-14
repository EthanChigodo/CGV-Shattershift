# Feedback round 2 - the lecturer's notes

What the lecturer raised after playing the hosted build, and what changed.

| # | Feedback | Change |
| --- | --- | --- |
| 1 | In the runner section it is too easy to stay in the middle lane for long stretches without risk | Measured first: in the Foundry only 8 of its obstacles touched the middle lane, and the last 315 m had none. The Foundry's filler now lays mostly **pairs that block two lanes and leave one open - usually a side lane** - and lone obstacles favour the middle; pistons come alone (never between you and the open lane). The escape keeps the side lanes for its gates but now puts things to jump or slide in the middle. 64 lane obstacles instead of ~23. (The Labs already threatened the middle every ~45 m on average; the Skyline has its bridge collapse.) |
| 2 | Credits should be easy to reach from the main menu or settings | A **Credits** button on the main menu, and **View credits** in Settings: the same content as the end roll (team, cast, every model with author and licence, music and sound, libraries), as a page to read. |
| 3 | Performance ok but could be better (the Foundry most); add settings to turn off shadows etc. | Settings > Graphics: **Shadows** on/off, **Visual effects** (bloom, screen glow, grading) on/off, **Resolution** 100 / 85 / 70 / 50 %. Below High the Foundry uses 5 + 2 pooled lights instead of 8 + 3. |
| 4 | After being hit, a 3-second counter to time you back in - you start moving before the camera faces forward | After every restart (retry a sector, run again) the game waits until you are in control, then holds still for **3, 2, 1, GO**. |
| 5 | Running out of bullets - no way to get more? | Every level now gives **one sphere back every 2.5 s while you have none** (the Skyline already did). In the Labs you can also **run into** a sphere crystal or a serum to take it, not only shoot it. |
| 6 | So many checkpoints make it too easy; show a progress screen instead (Cuphead) | The mid-Labs checkpoints are gone. A death in the story shows **a line of how far you got**: the level's sections marked, where you died, your best so far. |
| + | A final stats page: all the ways you died across the levels, failed quick-time events | The "you got out" screen has a **run report**: time, deaths and hits per level, every way you died (with counts), quick-time events passed / failed. It covers a whole run from Start story, retries included. |

The Foundry's balance check now steers its test bots through the lanes like a player would (they used to run the whole level in the middle lane, which the level then had to allow). It still requires a skilled run with no hits and a run that never jumps or slides to finish.

## Follow-up (team playtest)

- **One checkpoint per runner level** (the lecturer's "too many" was the old one-per-section): the Foundry's Rolling Floor, the Labs' blackout, the Skyline's atrium (after the bridge chase); the roof has none. Die past it and the death screen offers **Retry from checkpoint** - you resume right there, counted in with **3, 2, 1, GO** - or **Restart sector**. A retry from the start has no countdown. The progress line marks the checkpoint with a flag.
- **The end screen redesigned**: a death is red and broken (chromatic-split title that glitches in), a way out is gold (a light sweeping the title); the score counts up; the stats are cards; the progress line is a lit route map with a pulsing marker. `R` retries, `Esc` goes to the menu.
- **Serum cards in the Foundry**: the serum cells hang overhead, and running under one never collected it (only shooting did), so the first-time card never appeared for a runner. Running under one now takes it.
- **The Foundry, harder and faster to draw**: faster throughout (7.8 / 10.2 / 12.6 m/s, was 6.8 / 9.0 / 11.6). The glass cells used real transmission, which makes Three.js render the whole scene a second time every frame - plain clear-coated glass now (a Foundry frame went from ~73 to ~51 ms on the test machine); the pooled lights are 6 + 2 on High (was 8 + 3) and 4 + 2 below.
- **One crosshair everywhere**: the Labs and the roof used their own green ring; they now use the Foundry's and the Skyline's crosshair (lines and a dot in the sphere's colour, hot over a target), keeping their two warnings (amber when weakened, flashing red when overheated).
- **The roof camera no longer shakes with the cursor at the top of the screen (or dragged off it)**: near the horizon the aim point ran off for kilometres, the camera leaned after it, which moved the aim again. The aim now stays within 22 m of the player, and the pointer is held inside the window.
- **The end screen fits on one page**: the verdict, score and buttons on the left; the route map and the run report beside them (one column on a narrow window).
- **Cryo looks like frost, not like shock**: a faceted ice shell that spreads without a pulse, a frost patch with crystal branches that stays on the floor for a couple of seconds, a crown of ice spikes that shoots up and melts back, and a steady cold light (shock keeps its throbbing shell, shockwave ring and flickering flash).

## Difficulty and two new power-ups

The story (and its chapters) can be played on **Easy, Normal or Hard**, picked on the main menu's loadout card and kept in the browser. Normal is the game as it was; Endless keeps its own ramp. One table (`src/systems/difficulty.js`) is read by every level:

| | Easy | Normal | Hard |
| --- | --- | --- | --- |
| Runner speed (Foundry, Labs, Skyline, and the Skyline's collapse) | x0.88 | x1 | x1.14 |
| Filler obstacles (Foundry, Labs) | 25 % fewer | as designed | 35 % more |
| Damage (hits, fire, smoke) | x0.65 | x1 | x1.35 |
| One sphere back when empty | every 1.6 s | 2.5 s | 3.5 s |
| Halfway checkpoint | yes | yes | none |
| Roof: time between waves / patients' speed / helicopter's wait | x1.3 / x0.9 / x0.85 | x1 | x0.72 / x1.15 / x1.2 |

Hard also brings things the other difficulties never see:

- **Foundry - slag carts**: a tub of molten metal rolling to and fro across all three lanes on floor rails. Take the lane it is leaving, or jump it.
- **Labs - fire waves**: three floor vents erupting one after another, so the fire rolls across the corridor; and the patients **stalk you in every section**, not only in the dark.
- **Skyline**: more solid hazards and ceiling collapses in the gaps, every other plain pane reinforced, the sculptures swinging faster.
- **Roof**: an extra patient in the first two waves, two more climbers in the last, and a **brute in the second wave** as well as the third.

The Foundry's escape clock scales with the pace, so it is as tight at every difficulty. The Foundry balance check now also plays Hard: a skilled run must finish it with at most two hits (it takes none). Story best times are kept per difficulty; the run report says which it was.

**Two new serums**, in every level and in the field manual:

- **Unlimited spheres** (blue, a figure of eight in the capsule): every throw is free for 10 s - cryo and shock too. Six spheres circle the edge of the screen while it runs.
- **Restoration** (green, a ring of spheres): +20 spheres and integrity back to full, at once. Its card and banner say "works at once" rather than a time.

Where they are: the Foundry's serum cells cycle through all five; the Skyline has a restoration just before the bridge chase and unlimited spheres in the atrium; the Labs' blackout has a restoration (in the dark, where spheres go fastest) and the stairwell an unlimited spheres; the roof's supply drops can carry either; the Skyline's Endless picks from all six serums.

**Thermal sight is now Thermal Aegis**: it still shows heat through the smoke and the dark, and now fire can't burn you either - in the Skyline you walk through the flames, in the Labs the fire vents' flames pass over you, a burning obstacle only knocks you (no burn), and the fire behind you drains you a quarter as fast; on the roof a gas canister's fireball does a third of its damage (just the shove).
