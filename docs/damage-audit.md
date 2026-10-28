# Damage audit: skill or design?

The lecturer's feedback (round 8):

> "I would also recommend playing the game and identifying the most annoying things that caused you to take damage. Then have a thought on whether these were skill-based issues or bad game design. One such example could be the camera angle; while running past the lasers, it is hard to judge the depth of the next grid of lasers."

**Method.** For every kind of hazard in the Labs, we rendered what the player sees from the chase camera 1.0 s and 0.5 s before reaching it, which is the window in which you decide to jump, slide or change lane. We then asked one question per hazard: *does the picture give you what you need to make that decision?*

- If it does and you still got hit, the hit was **skill**: you saw it and misjudged it.
- If it doesn't, the hit was **design**: the game didn't show you enough.

We also replayed the moments the lecturer named: running off before the camera turns forward after a hit, and after the zombie's quick-time event.

## What hurt, and why

| Hazard / moment | What the player saw | Verdict | Fix |
| --- | --- | --- | --- |
| **Laser grids** (low: jump; high: slide; sweeping) | Three thin beams floating in the corridor. Nothing on the floor said *where* the grid was, and the camera sat low and almost level, so you couldn't tell 6 m from 9 m. | **Design** | A hot line on the floor directly under every grid, with a soft glow pool round it. A faint sheet of light fills the band the beams close off, so the grid reads as a wall you go over or under. The camera sits higher and tips further down (below). |
| **Chase camera angle** | 2.8 m up, looking almost straight ahead: very little floor between you and the next obstacle, which is what depth is judged from. | **Design** | Raised to 3.45 m and aimed lower and slightly further ahead. You see the floor up to the obstacle and the next one beyond it. |
| **Camera inside the scenery** | As the camera passed a glass gate's posts or a grid you had already cleared, the posts or beams filled the screen for a moment. | **Design** | Obstacles already behind you, between you and the camera, step out of its way. |
| **Lurchers in the blackout** | In the dark stretch, a patient that stalks your lane was invisible 1 s before it hit. You couldn't react to what you couldn't see. | **Design** | Patients' eyes catch the light: two small glows ride the head bone, so in the dark you see a pair of eyes in your lane. |
| **Running off before the camera faces forward** (after a hit; after the zombie's quick-time event) | After a hit the camera swings round to show the fire behind you. The run carried on while it was still swinging back, and the next obstacle arrived before you could see it. Same after the quick-time event. | **Design** | A hit all but stops you while you look back. Once the camera faces forward, the world holds and counts **3, 2, 1**. Control coming back from any cutscene or quick-time event does the same. |
| **Fallen ducts** (jump onto, off the far side) | Readable: a big object on the floor with its top visible. | Skill | — |
| **Fire vents** (erupt on a cycle) | Readable: the grate glows before each burst. | Skill: reading the rhythm | — |
| **Glass gates** | Readable: a cyan rim; crashing through costs integrity, by design. | Skill: shoot it or take the hit | — |
| **Patients lunging in the light** | Readable: they step out from the side before committing. | Skill | — |

Images of the lasers before and after, the blackout and the camera inside the scenery are in [`damage-audit/`](damage-audit/).

## What this says about the design

The hits players found *annoying* were never the hard ones. They were the ones where the game hid the information:

- **where** something was (the lasers' depth);
- **whether** something was there (the blackout);
- **when** you were back in control (the camera still turning).

Every fix gives that information back without making anything easier. The lasers are as tall, as fast and as dense as before. The difference is that a miss is now your misjudgement, not the camera's.

## Checks

The Labs' own checks still pass after these changes: route, **fairness** (every obstacle can be passed), the roof, and a full playthrough. We also confirmed the countdown in real time: hit → look back → camera forward → 3, 2, 1 → run.
