/**
 * The cutscene player: subtitles at the right times, events in order and
 * once, hold-Esc skips the talking but never a reaction, a failed reaction
 * retries from just before it, and the wake-up plays through cleanly.
 */

export const name = "cutscene";

export async function run(page) {
  const result = await page.evaluate(async () => {
    const out = [];
    const check = (label, ok, detail = "") => out.push([label, !!ok, detail]);
    const s = __story;
    const p = s.player;
    const sub = () => (document.querySelector(".story-sub").classList.contains("show") ? document.querySelector(".story-sub .line").textContent : null);
    const runTo = (t, dt = 1 / 30) => {
      let guard = 0;
      while (p.t < t && p.active && guard++ < 20000) s.step(1, dt);
    };
    const events = [];
    const off = p.on("event", (name, data) => events.push([name, !!data.skipped]));

    // ---- Lines and events -------------------------------------------------
    const scene = {
      id: "test",
      lines: [
        { who: "okoro", text: "First line.", at: 0.5, hold: 1 },
        { who: "sfx", text: "[a direction]", at: 2, hold: 1 },
      ],
      events: [{ at: 1.2, name: "b" }, { at: 0.2, name: "a" }, { at: 4, name: "c" }],
      reactions: [{ at: 5, id: "r1", spec: { kind: "press", keys: ["KeyE"], window: 1 }, lead: 1.5 }],
      duration: 7,
    };
    p.stop();
    p.play(scene);
    check("letterbox and HUD hiding on play", document.querySelector(".story-layer").classList.contains("letterbox") && document.body.classList.contains("story-cutscene"));
    runTo(0.6);
    check("a line shows at its time", sub() === "First line.", sub());
    check("the speaker's name shows", document.querySelector(".story-sub .who").textContent === "DR. OKORO");
    runTo(1.6);
    check("a line clears after its hold", sub() === null, sub());
    runTo(2.2);
    check("stage directions drop their brackets", sub() === "a direction" && document.querySelector(".story-sub").classList.contains("direction"), sub());
    check("events fire in time order", events.map((e) => e[0]).join() === "a,b", events.map((e) => e[0]).join());

    // ---- Skip: runs to the reaction, firing what it jumps over ------------
    p.skipHeld = true;
    s.step(30, 1 / 30); // 1 s held (the ring needs 0.7 s)
    p.skipHeld = false;
    check("hold Esc skips up to the reaction, not past it", p.state === "reaction" && Math.abs(p.t - 5) < 0.05, `${p.state} ${p.t.toFixed(2)}`);
    check("skipped events still fire, flagged", events.some((e) => e[0] === "c" && e[1]), JSON.stringify(events));
    p.skipHeld = true;
    s.step(30, 1 / 30);
    p.skipHeld = false;
    check("a reaction can't be skipped", p.state === "reaction" || p.state === "failed", p.state);

    // ---- Fail, retry, succeed ---------------------------------------------
    while (p.state === "reaction") s.step(1, 1 / 30);
    check("too slow -> failed", p.state === "failed", p.state);
    const failedT = p.t;
    s.step(10, 1 / 30);
    check("a failed scene holds still", Math.abs(p.t - failedT) < 1e-6);
    p.retry();
    check("retry rewinds by the reaction's lead", p.state === "playing" && Math.abs(p.t - 3.5) < 0.05, `${p.state} ${p.t.toFixed(2)}`);
    const cAgain = events.filter((e) => e[0] === "c").length;
    runTo(5);
    s.step(1, 1 / 30);
    check("events after the retry point fire again", events.filter((e) => e[0] === "c").length === cAgain + 1);
    check("the reaction comes round again", p.state === "reaction", p.state);
    s.press("KeyE");
    s.step(1, 1 / 30);
    runTo(8);
    check("then the scene finishes", p.state === "done", p.state);
    check("letterbox and HUD hiding cleared at the end", !document.querySelector(".story-layer").classList.contains("letterbox") && !document.body.classList.contains("story-cutscene"));

    // ---- Esc from the keyboard --------------------------------------------
    p.play({ id: "esc", lines: [{ who: "okoro", text: "x", at: 0, hold: 5 }], duration: 5 });
    dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    s.step(30, 1 / 30);
    dispatchEvent(new KeyboardEvent("keyup", { code: "Escape" }));
    check("holding the real Esc key skips", p.state === "done", `${p.state} ${p.t.toFixed(2)}`);

    // ---- The wake-up, start to finish -------------------------------------
    events.length = 0;
    s.start("wake");
    const okoroStart = s.okoro.root.position.clone();
    let lines = 0;
    const offLine = p.on("line", () => (lines += 1));
    let maxLids = 0;
    runTo(1);
    maxLids = Math.max(maxLids, parseFloat(document.querySelector(".story-lid.top").style.height));
    runTo(1000, 1 / 20);
    offLine();
    check("wake-up: plays to the end", p.state === "done", p.state);
    check("wake-up: cues in order", events.map((e) => e[0]).join() === "monitor,okoro-lean,sit-up,stand,okoro-go", events.map((e) => e[0]).join());
    check("wake-up: every line shown", lines >= 8, lines);
    check("wake-up: eyes start shut", maxLids > 40, maxLids);
    check("wake-up: ends standing", Math.abs(s.camera.position.y - 1.6) < 0.15, s.camera.position.y.toFixed(2));
    check("wake-up: Okoro heads for the door", s.okoro.root.position.distanceTo(okoroStart) > 0.5, s.okoro.root.position.distanceTo(okoroStart).toFixed(2));
    check("wake-up: canvas blur cleared", !s.renderer.domElement.style.filter, s.renderer.domElement.style.filter);
    off();
    return out;
  });
  const failures = result.filter(([, ok]) => !ok).map(([label, , detail]) => `${label}${detail !== "" ? ` (${detail})` : ""}`);
  return { failures, notes: { cases: result.length } };
}
