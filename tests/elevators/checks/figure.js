/**
 * Checks for the player figure's skin tones (src/figure/look.js).
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
