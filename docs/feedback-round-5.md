# Feedback round 5: the lecturer's review

## Done

| # | Feedback | Change |
| --- | --- | --- |
| 1 | A 3, 2, 1 before play resumes after taking damage. In level 2 especially, you start running before the camera looks forward again; the same after the zombie's quick-time event, while the camera is still moving | In the Labs a hit now **all but stops you** while you look back at the fire. Once the camera faces forward again and settles (a third of a second), the world holds and counts **3, 2, 1**, a little quicker than the restart countdown. The same happens whenever control comes back from **any cutscene, story scene or quick-time event**. You never get control while the camera is still turning. (`main.js` `requestResumeCountdown`, `watchSceneHandback`; `src/levels/meltdown/game.js` `stumbling`) |
| 2 | Play the game, find the most annoying things that cost you damage, and decide whether each was skill or bad design. For example, the camera angle past the lasers makes it hard to judge how deep the next grid is; tilting the camera up might help | **[The damage audit](damage-audit.md)**. Every Labs hazard was rendered from the chase camera 1 s and 0.5 s before reaching it, and judged on one question: does the picture give you what you need to decide? Five of the hits were **design**, and each one is fixed:<br>• **The lasers.** A hot line on the floor under every grid, a glow pool round it, and a faint sheet of light filling the band the beams close off.<br>• **The camera.** Higher (3.45 m, was 2.8 m) and tipped further down, so you see the floor between you and the next obstacle.<br>• **The scenery.** Obstacles you have passed no longer fill the screen as the camera goes through them.<br>• **The blackout.** Patients' eyes catch the light.<br>• **The restart.** The countdown above.<br>The rest of the hits (ducts, vents, glass gates, lit patients) were **skill**: readable, and left as hard as they were. |
| 3 | Weird floating particles by the bazooka: squares and circles ("no, no! Those were sealed!") | They were the 3D exporter's helper objects left inside the launcher model: camera-target circles and layout boxes. The game now strips them when it loads the model. (`src/levels/meltdown/assets.js`) |
| 4 | Use the weapon (sphere) types in play more, e.g. you have to freeze fire. Otherwise there's no reason to swap | **[The right tool](problem-solving.md)**. Every sector now has obstacles that only the right sphere, or the right way of throwing it, gets you past for free:<br>• **The Foundry: the drop forge.** Break its valve while the hammer is up.<br>• **The Labs: fire walls.** Only cryo puts them out.<br>• **The Labs: the jammed shutter.** Only a full charged shot blows it out.<br>• **The Skyline: a sealed door and laser grids.** Only shock opens the door or kills a grid at its junction box.<br>• **The Roof.** Only gravity reaches the stranded supplies, or drags patients over an open ledge.<br>Each problem is drawn in its tool's colour and says what it wants the first time you meet it. The wrong tool visibly fails and says what's needed. Solving one pays a bonus and gives the tool's spheres back, and nothing soft-locks: each can be passed without the tool, at a cost. |

## The lecturer's questions

### Is the leaderboard local only, or do others see the records?

**Global.** The boards live on the same server as the game, in `api/leaderboard.php`, so everyone who plays that copy sees the same records:

- the fastest escape;
- the story high score;
- the furthest Endless run in each sector;
- the longest hold on the Roof;
- the most trophies.

How it works:

- **Names are unique.** "Neo", "neo" and "N.E.O" count as one name. The server hands a token to the browser that took the name, and that token proves it's you.
- **Storage.** The server uses MySQL if it's configured, SQLite if PHP has it, and a locked JSON file otherwise.
- **Offline.** It is local only if there's no server or no PHP. Then scores wait in the browser, only your best of each, and go up when the server answers.

### What would we call our innovation?

**The throw is a toolkit with physical rules, and the levels are built out of things that obey them.**

In most runners the verbs are dodge, jump and slide, and anything you shoot is just a target. In Fracture Run the four spheres are one physical language: glass shatters, ice freezes and puts out fire, electricity overloads, gravity pulls.

Every sector asks a new question in that language, in the order you unlock the tools:

- *when* (the forge);
- *which* (fire walls, the sealed door);
- *how* (the charged shot);
- *is it worth it* (the junction box);
- *where* (gravity on the roof).

The rules hold everywhere, so what you learn carries over:

- cryo puts out a fire wall in the Labs, a fire on the Skyline, and freezes the Foundry's pistons;
- gravity drags in supplies and drags patients over a ledge.

That turns a reflex game into reading a scene and choosing a tool at speed.

Behind it, and worth naming in the report:

- **Tests that play the game.** Bots run each level and solve every problem with the right tool, and the tests fail if the right tool doesn't work. Fairness checks prove every obstacle can be passed.
- **The damage audit.** A repeatable method for telling skill from bad design.

## How we made it more problem solving

The full design is in [problem-solving.md](problem-solving.md). In short:

1. **Problems that need a decision, not just a reflex.** Which tool, how to throw it, when, where, and whether it's worth the spheres.
2. **Telegraphed.** The tool's colour and sign on the obstacle, stripes on the floor, one hint the first time, a distance countdown in the Labs, and a wrong-tool line that says what it needs.
3. **Mandatory and optional.** Some problems stand in the way (passable at a cost). Others are clever extras: the junction box, the crate, the ledge.
4. **Escalating.** One tool and a timing question in the Foundry, up to a placement question with four tools on the Roof.
5. **Rewarded.** A bonus, the spheres back, and the count in the run report.
6. **Backed by the damage audit.** The hits that annoyed players were the ones where the game hid information, and those were fixed without making anything easier.
