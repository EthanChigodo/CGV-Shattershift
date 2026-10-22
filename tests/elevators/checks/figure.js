/**
 * Checks for the player figure's skin tones and hair colours (src/figure/look.js).
 *
 * Each check gets a fresh page with the game loaded and the menus closed,
 * and returns { failures: string[], notes: object }.
 */

/** The complexion (Customise, src/modes/locker/): saved, applied to the figure, shown on the Subject 07 card. */
export const skinTone = {
  name: "skin tone choice",
  async run(page) {
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      const w0 = performance.now();
      while (!d.playerBody?.look && performance.now() - w0 < 30000) await new Promise((resolve) => setTimeout(resolve, 200));
      const { SKIN_TONES } = await import("/src/figure/look.js");
      const tones = Object.keys(SKIN_TONES);
      d.applyLook({ skin: "dark" });
      const u = d.playerBody.look.uniforms;
      const card = [...document.querySelectorAll(".dossier-row")].find((row) => /complexion/i.test(row.textContent))?.textContent ?? "";
      const dark = { on: u.uToneOn.value, tone: u.uTone.value.getHexString(), saved: localStorage.getItem("fractureRun.skinTone"), card };
      d.applyLook({ skin: "light" });
      const light = { on: u.uToneOn.value };
      return { tones, dark, light };
    });
    const failures = [];
    if (r.tones.join() !== "light,medium,brown,dark") failures.push(`tones: ${r.tones}`);
    if (r.dark.on !== 1 || r.dark.tone !== "4d3427") failures.push(`the dark tone was not applied: ${JSON.stringify(r.dark)}`);
    if (r.dark.saved !== "dark" || !/dark/i.test(r.dark.card)) failures.push(`the choice was not saved or shown: ${JSON.stringify(r.dark)}`);
    if (r.light.on !== 0) failures.push("going back to light did not restore the model's own skin");
    return { failures, notes: {} };
  },
};

/**
 * The hair colour (Customise, src/modes/locker/; HAIR_COLOURS in
 * src/figure/look.js): a pick is saved, applied to the body at once and
 * again after a reload, shown on the Subject 07 card, re-dyes
 * only the hair (a render of the figure changes on the head and nowhere
 * below it), and leaves the skin tone alone.
 */
export const hairColour = {
  name: "hair colour choice",
  async run(page) {
    const waitBody = async () => page.evaluate(async () => {
      const d = globalThis.__dbg;
      const w0 = performance.now();
      while (!d.playerBody?.look && performance.now() - w0 < 30000) await new Promise((resolve) => setTimeout(resolve, 200));
      return !!d.playerBody?.look;
    });
    await waitBody();
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      const { HAIR_COLOURS } = await import("/src/figure/look.js");
      const u = d.playerBody.look.uniforms;
      const toneBefore = [u.uToneOn.value, u.uTone.value.getHexString()].join();
      d.applyLook({ hair: "blue" });
      const expected = new d.THREE.Color(HAIR_COLOURS.blue.color).getHexString();
      const card = [...document.querySelectorAll(".dossier-row")].find((row) => /hair/i.test(row.textContent))?.textContent ?? "";
      const blue = { on: u.uHairOn.value, dye: u.uHair.value.getHexString(), expected, saved: localStorage.getItem("fractureRun.hairColour"), card };
      const toneAfter = [u.uToneOn.value, u.uTone.value.getHexString()].join();

      // A render of the figure, natural then blue: what changed, and where.
      const THREE = d.THREE;
      const { PlayerAvatar } = await import("/src/levels/meltdown/player.js");
      const a = new PlayerAvatar();
      a.hold = 0;
      a.setModel(d.playerBodyTemplate);
      a.update(0.016, { speed: 0 });
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2));
      a.root.rotation.y = Math.PI;
      scene.add(a.root);
      const cam = new THREE.PerspectiveCamera(30, 0.5, 0.1, 20);
      cam.position.set(0, 0.95, 4.2);
      cam.lookAt(0, 0.9, 0);
      const W = 96;
      const H = 192;
      const target = new THREE.WebGLRenderTarget(W, H);
      const grab = (hair) => {
        a.setHairColour(hair);
        d.renderer.setRenderTarget(target);
        d.renderer.render(scene, cam);
        const px = new Uint8Array(W * H * 4);
        d.renderer.readRenderTargetPixels(target, 0, 0, W, H, px);
        d.renderer.setRenderTarget(null);
        return px;
      };
      const before = grab("natural");
      const after = grab("blue");
      target.dispose();
      // Rows count from the bottom; the frame spans -0.18 m to 2.08 m. The
      // head and long hair are above 1.45 m (row 0.72); the chest and down,
      // below 1.2 m (row 0.61), must not change at all.
      let head = 0;
      let below = 0;
      let blueness = 0;
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const i = (y * W + x) * 4;
          const diff = Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]);
          if (diff < 12) continue;
          if (y > H * 0.72) {
            head += 1;
            blueness += after[i + 2] - after[i];
          } else if (y < H * 0.61) below += 1;
        }
      }
      return { labels: Object.keys(HAIR_COLOURS), blue, toneBefore, toneAfter, head, below, blueness: head ? blueness / head : 0 };
    });
    // After a reload the saved colour is on the body without a click.
    await page.goto(page.url(), { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction(() => globalThis.__dbg?.causeway, null, { timeout: 60000 });
    await waitBody();
    const reloaded = await page.evaluate(() => {
      const u = globalThis.__dbg.playerBody.look.uniforms;
      const out = { on: u.uHairOn.value, dye: u.uHair.value.getHexString() };
      globalThis.__dbg.applyLook({ hair: "natural" });
      out.naturalOn = u.uHairOn.value;
      out.naturalSaved = localStorage.getItem("fractureRun.hairColour");
      return out;
    });
    const failures = [];
    if (r.labels.length < 8 || r.labels[0] !== "natural") failures.push(`colours: ${r.labels}`);
    if (r.blue.on !== 1 || r.blue.dye !== r.blue.expected) failures.push(`blue was not applied: ${JSON.stringify(r.blue)}`);
    if (r.blue.saved !== "blue" || !/electric blue/i.test(r.blue.card)) failures.push(`the choice was not saved or shown: ${JSON.stringify(r.blue)}`);
    if (r.toneBefore !== r.toneAfter) failures.push(`picking a hair colour changed the skin tone: ${r.toneBefore} -> ${r.toneAfter}`);
    if (r.head < 40) failures.push(`the render barely changed on the head (${r.head} px)`);
    if (r.below > 0) failures.push(`the dye reached below the head (${r.below} px changed)`);
    if (r.blueness <= 0) failures.push(`the re-dyed hair is not blue (${r.blueness.toFixed(1)})`);
    if (reloaded.on !== 1 || reloaded.dye !== r.blue.expected) failures.push(`not kept after a reload: ${JSON.stringify(reloaded)}`);
    if (reloaded.naturalOn !== 0 || reloaded.naturalSaved !== "natural") failures.push("natural did not restore the model's own hair");
    return { failures, notes: { changedOnHead: r.head, changedBelow: r.below, blueness: Math.round(r.blueness) } };
  },
};
