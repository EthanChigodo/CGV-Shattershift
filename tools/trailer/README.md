# The trailer

Everything here makes the game's trailer out of the game itself. The outputs go to `dist/trailer/` (not committed).

## 1. Trailer mode: record it yourself

Open the game with `?trailer` on the end of its address (for example `http://localhost:4180/index.html?trailer`). It plays exactly as normal, plus these keys:

| Key | What it does |
| --- | --- |
| `` ` `` | Clean frame: hides every bit of UI and adds letterbox bars |
| `,` `.` | Previous / next camera shot: game, front, low, side, orbit, drone, flyby, top |
| `-` `=` | Slower / faster time: 1, 0.5, 0.25, 0.1 |
| `/` | Autopilot: dodges, jumps, slides, shoots, answers quick-time events |
| `;` | God mode: can't die, never runs out of spheres, no serum tint on screen |

Record the screen with [OBS Studio](https://obsproject.com) (free) at 1080p60. The code is in `src/trailer/director.js` (the camera shots) and the "Trailer mode" section of `main.js` (god mode, autopilot).

## 2. The automatic rough cut

Needs Node, Playwright (as the tests do) and [ffmpeg](https://ffmpeg.org) (set `FFMPEG` to its path if it isn't on your PATH).

```bash
node tools/trailer/capture.mjs --scout
node tools/trailer/capture.mjs
node tools/trailer/cards.mjs
node tools/trailer/assemble.mjs
```

1. `capture.mjs --scout`: three stills per shot in `dist/trailer/scout/`, to check the framing quickly.
2. `capture.mjs`: renders every shot in `shots.mjs` frame by frame on the GPU (1920x1080, 30 fps), so it is smooth however slow the machine is: each frame is read back raw and piped into ffmpeg, giving `dist/trailer/clips/<name>.mp4`. About an hour and a half on a laptop. `--only a,b` re-renders some. It uses Chrome's OpenGL backend (`TRAILER_ANGLE` to change it): the Direct3D one, headless on an Intel laptop GPU, returned a frame in seven or so with blocks of it black. It still checks each clip for such frames and lists any it finds (`--deglitch` paints them over with the frame before).
3. `cards.mjs`: the title cards in `cards.html` as transparent PNGs in `dist/trailer/cards/`.
4. `assemble.mjs`: cuts it all together with the game's own music and sounds into `dist/trailer/fracture-run-trailer.mp4`. The edit is the `EDIT` list at the top of the file: change a clip, its start or length, its card or its sound and run it again (a minute or two).

The clips are also good raw material for editing the trailer by hand in DaVinci Resolve or CapCut instead.

## Music and sound

The rough cut uses only audio already in the game and in its credits: the briefing's piano (Leberch) for the opening, the menu's trap loop (Holizna, 165 BPM: every cut after the title lands on a bar) from the title on, and the game's glass, whoosh and crash effects. A different track would need its own licence and a line in the credits.
