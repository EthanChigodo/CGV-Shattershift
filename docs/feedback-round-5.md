# Feedback round 5: the lecturer's review, continued

The team's round 4 already answers the lecturer's four points (`docs/feedback-round-4.md`, rows 63 to 66 and 71):

- **The 3-2-1.** After every cutscene and on unpausing, with no look back after a hit in the Labs.
- **The lasers and the camera.** A floor line under every grid, and the camera higher.
- **The launcher.** Its floating pieces are gone.
- **The spheres.** One sphere per sector, each needed: cryo's fire walls, shock's drones, and gravity throwing the roof's people off the ledge.

This round builds on that.

## Done

| # | Feedback | Change |
| --- | --- | --- |
| 1 | Play the game, find the most annoying things that cost you damage, and decide whether each was skill or bad design | **[The damage audit](damage-audit.md)**. Every Labs hazard was rendered from the chase camera 1 s and 0.5 s before reaching it, and judged on one question: does the picture give you what you need to decide? It records which hits were **design** (the lasers' depth, the camera angle, the camera inside the scenery, patients in the blackout, running before the camera faced forward) and which were **skill** (ducts, vents, glass gates, lit patients). The skill hits are left as hard as they were. Two of its fixes are new this round. |
| 2 | (From the audit) the camera went through the scenery: a glass gate's posts or a cleared grid filled the screen | Obstacles already behind you, between you and the chase camera, step out of its way (`meltdown/index.js`). |
| 3 | (From the audit) patients stalking you in the blackout hit you unseen | Their eyes catch the light: two small glows ride the head bone, so in the dark you see a pair of eyes in your lane (`meltdown/kit.js` `lurcher`). |
| 4 | Floating squares and circles by the launcher | Beside the team's fix (the sight's pieces and loose islands), the 3D exporter's own helper objects are stripped from the model as it loads: camera-target circles and layout boxes (`meltdown/assets.js`). |
| 5 | Use the sphere types more ("you have to freeze fire") | **[The right tool](problem-solving.md)**. A second question in each sector, beside the team's one sphere per sector:<br>• **The Foundry: the drop forge** (*when?*). Break its glass valve while the hammer is up, or time your run under it.<br>• **The Labs: the jammed shutter** (*how?*). Only a full charged shot blows it out; plain shots only dent it.<br>• **The Skyline: a sealed security door** (*which tool?*). Only shock opens it.<br>• **The Skyline: laser grids with junction boxes** (*is it worth it?*). Shock the box, or jump the grid.<br>• **The Roof: stranded supplies** (*where?*). Only a gravity well close to them pulls them in.<br>Each is drawn in its tool's colour with its sign, says what it wants the first time, and fails visibly with the wrong tool. Each pays a bonus and the tool's spheres back, and appears in the field manual and the run report. None soft-locks. |

## The lecturer's questions

### Is the leaderboard local only, or do others see the records?

**Global.** The boards live on the same server as the game, in `api/leaderboard.php` (round 4, row 61), so everyone who plays that copy sees the same records:

- the fastest escape;
- the story high score;
- the furthest Endless run in each sector;
- the longest hold on the Roof;
- the most trophies.

How it works:

- **Names are unique.** "Neo", "neo" and "N.E.O" count as one name. The server gives the browser that took the name a token, and the token proves it's you.
- **Storage.** The server uses MySQL if it's configured, SQLite if PHP has it, and a locked JSON file otherwise.
- **Offline.** It is local only if there's no server or no PHP. Then scores wait in the browser, only your best of each, and go up when the server answers.

### What would we call our innovation?

**The throw is a toolkit with physical rules, and the levels are built out of things that obey them.**

In most runners the verbs are dodge, jump and slide, and anything you shoot is just a target. In Fracture Run the four spheres are one physical language: glass shatters, ice freezes and puts out fire, electricity overloads, gravity pulls.

Every sector asks its questions in that language, in the order you unlock the tools:

- *when* (the forge);
- *which* (fire walls, drones, the sealed door);
- *how* (the charged shot);
- *is it worth it* (the junction box);
- *where* (gravity on the roof).

The rules hold everywhere, so what you learn carries over:

- cryo puts out fire walls in the Labs, fires on the Skyline, and freezes the Foundry's pistons;
- gravity drags in supplies, throws patients off a ledge and pulls a flying mutant out of the sky.

That turns a reflex game into reading a scene and choosing a tool at speed.

Behind it, and worth naming in the report:

- **Tests that play the game.** Bots run each level and answer every sphere-only obstacle with the right tool, and the tests fail if the right tool doesn't work. Fairness checks prove every obstacle can be passed.
- **The damage audit.** A repeatable method for telling skill from bad design.

## How we made it more problem solving

The full design is in [problem-solving.md](problem-solving.md). In short:

1. **Problems that need a decision, not just a reflex.** Which tool, how to throw it, when, where, and whether it's worth the spheres.
2. **Telegraphed.** The tool's colour and sign on the obstacle, stripes on the floor, one hint the first time (and the team's level cards before each sector), and a wrong-tool line that says what it needs.
3. **Mandatory and optional.** Some problems stand in the way (passable at a cost). Others are clever extras: the junction box, the crate.
4. **Escalating.** One tool and a timing question in the Foundry, up to a placement question with four tools on the Roof.
5. **Rewarded.** A bonus, the spheres back, and the count in the run report.
6. **Backed by the damage audit.** The hits that annoyed players were the ones where the game hid information, and those were fixed without making anything easier.
