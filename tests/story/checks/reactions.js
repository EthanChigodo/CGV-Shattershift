/**
 * Reaction button hits: every kind succeeds when played right and fails
 * when it should, the options do what they say, and the ladder gets harder.
 * Pure logic (a ReactionHits with no UI), then the prompt on screen.
 */

export const name = "reactions";

export async function run(page) {
  const result = await page.evaluate(async () => {
    const { ReactionHits, reactionLadder, latchReaction, sprintReaction, REACTION_KEYS } = await import("/src/story/reaction.js");
    const out = [];
    const check = (label, ok, detail = "") => out.push([label, !!ok, detail]);
    const fresh = (opts) => new ReactionHits(null, opts);
    const tick = (h, seconds, dt = 1 / 60) => {
      for (let t = 0; t < seconds - 1e-9; t += dt) h.update(dt);
      return h.state;
    };

    // press
    let h = fresh().start({ kind: "press", keys: ["KeyE"], window: 2 });
    tick(h, 1);
    h.keyDown("KeyE");
    check("press: right key in time succeeds", h.state === "success", h.state);
    h = fresh().start({ kind: "press", keys: ["KeyE"], window: 2 });
    h.keyDown("KeyQ");
    check("press: another reaction key fails", h.state === "fail" && h.failReason === "wrong key", `${h.state} ${h.failReason}`);
    h = fresh().start({ kind: "press", keys: ["KeyE"], window: 2 });
    const used = h.keyDown("KeyW");
    check("press: movement keys are ignored (not consumed)", h.state === "running" && !used, `${h.state} ${used}`);
    h = fresh().start({ kind: "press", keys: ["KeyE"], window: 2 });
    tick(h, 1.95);
    const before = h.state;
    tick(h, 0.1);
    check("press: times out after its window", before === "running" && h.state === "fail" && h.failReason === "too slow", `${before} -> ${h.state}`);

    // combo
    h = fresh().start({ kind: "combo", keys: ["KeyQ", "KeyE"], window: 1.7 });
    h.keyDown("KeyE");
    tick(h, 0.4);
    h.keyDown("KeyQ");
    check("combo: both keys, any order", h.state === "success", h.state);
    h = fresh().start({ kind: "combo", keys: ["KeyQ", "KeyE"], window: 1.7 });
    h.keyDown("KeyQ");
    tick(h, 1.8);
    check("combo: one key isn't enough", h.state === "fail", h.state);

    // sequence
    h = fresh().start({ kind: "sequence", keys: ["KeyZ", "KeyX", "KeyC"], window: 1 });
    for (const k of ["KeyZ", "KeyX", "KeyC"]) {
      tick(h, 0.9); // each key gets its own window
      h.keyDown(k);
    }
    check("sequence: in order, a fresh window per key", h.state === "success", h.state);
    h = fresh().start({ kind: "sequence", keys: ["KeyZ", "KeyX", "KeyC"], window: 1 });
    h.keyDown("KeyX");
    check("sequence: out of order fails", h.state === "fail", h.state);

    // mash
    h = fresh().start({ kind: "mash", keys: ["Space"], time: 3, gain: 0.1, decay: 0.3 });
    let presses = 0;
    while (h.state === "running" && presses < 40) {
      h.keyDown("Space");
      h.keyUp("Space");
      presses += 1;
      tick(h, 0.1);
    }
    check("mash: fast presses fill the bar", h.state === "success", `${h.state} after ${presses}`);
    h = fresh().start({ kind: "mash", keys: ["Space"], time: 3, gain: 0.1, decay: 0.3 });
    for (let i = 0; i < 40 && h.state === "running"; i += 1) {
      h.keyDown("Space");
      h.keyUp("Space");
      tick(h, 0.45);
    }
    check("mash: too slow drains and fails", h.state === "fail", h.state);
    h = fresh().start(sprintReaction());
    for (let i = 0; i < 30; i += 1) {
      h.keyDown("KeyA");
      h.keyUp("KeyA");
      tick(h, 0.05);
    }
    check("alternating mash: the same key over and over does nothing", h._s.bar < 0.1, h._s.bar.toFixed(2));
    h = fresh().start(sprintReaction());
    for (let i = 0; i < 30 && h.state === "running"; i += 1) {
      const k = i % 2 ? "KeyD" : "KeyA";
      h.keyDown(k);
      h.keyUp(k);
      tick(h, 0.08);
    }
    check("alternating mash: A, D, A, D sprints", h.state === "success", h.state);

    // options
    h = fresh({ longWindows: true }).start({ kind: "press", keys: ["KeyE"], window: 2 });
    tick(h, 3);
    h.keyDown("KeyE");
    check("longer windows: 1.6x the time", h.state === "success", h.state);
    h = fresh({ holdInsteadOfMash: true }).start({ kind: "mash", keys: ["Space"], time: 3.5 });
    check("hold instead of mash: becomes a hold", h._s.kind === "hold", h._s.kind);
    h.keyDown("Space");
    tick(h, 1.5);
    check("hold instead of mash: holding fills it", h.state === "success", h.state);

    // chains and the ladder
    const kinds = [0, 1, 2, 3].map((i) => reactionLadder(i));
    check("ladder: press, combo, sequence, sequence+mash", kinds.map((k) => k.kind + (k.then ? "+" + k.then.kind : "")).join(",") === "press,combo,sequence,sequence+mash", kinds.map((k) => k.kind).join(","));
    check("ladder: more keys each step", kinds.map((k) => k.keys.length).join(",") === "1,2,3,4");
    check("ladder: windows get shorter", kinds[0].window > kinds[1].window && kinds[1].window > kinds[2].window && kinds[2].window > kinds[3].window);
    check("ladder: distinct keys from the reaction pool", kinds.every((k) => new Set(k.keys).size === k.keys.length && k.keys.every((c) => REACTION_KEYS.includes(c))));
    const last = reactionLadder(3, () => 0.3);
    h = fresh().start(last);
    for (const k of last.keys) h.keyDown(k);
    const mid = h._s.kind;
    for (let i = 0; i < 30 && h.state === "running"; i += 1) {
      h.keyDown("Space");
      h.keyUp("Space");
      tick(h, 0.05);
    }
    check("chain: the sequence hands over to the mash, then succeeds", mid === "mash" && h.state === "success", `${mid} ${h.state}`);
    const latch = latchReaction();
    check("latch: two keys, under a second each", latch.keys.length === 2 && latch.window < 1);

    // On screen: the shared UI shows and clears the prompt.
    const s = __story;
    s.reactions.start({ kind: "sequence", keys: ["KeyQ", "KeyE"], window: 2 });
    const shown = document.querySelector(".story-react").classList.contains("show");
    const keyCount = document.querySelectorAll(".story-react .story-key").length;
    s.press("KeyQ");
    const firstDone = document.querySelectorAll(".story-react .story-key.done").length;
    s.press("KeyE");
    check("ui: prompt shows the keys and marks progress", shown && keyCount === 2 && firstDone === 1, `${shown} ${keyCount} ${firstDone}`);
    check("ui: keyboard events reach the reaction", s.reactions.state === "success", s.reactions.state);
    return out;
  });
  const failures = result.filter(([, ok]) => !ok).map(([label, , detail]) => `${label}${detail ? ` (${detail})` : ""}`);
  return { failures, notes: { cases: result.length } };
}
