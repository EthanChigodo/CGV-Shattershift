/**
 * Checks for the player figure's skin tones (src/figure/look.js).
 *
 * Each check gets a fresh page with the game loaded and the menus closed,
 * and returns { failures: string[], notes: object }.
 */

/** The start screen's skin swatches: saved, and applied to the figure. */
export const skinTone = {
  name: "skin tone choice",
  async run(page) {
    const r = await page.evaluate(async () => {
      const d = globalThis.__dbg;
      const w0 = performance.now();
      while (!d.playerBody?.look && performance.now() - w0 < 30000) await new Promise((resolve) => setTimeout(resolve, 200));
      const buttons = [...document.querySelectorAll("#skinPick [data-skin]")].map((b) => b.dataset.skin);
      document.querySelector('#skinPick [data-skin="dark"]').click();
      const u = d.playerBody.look.uniforms;
      const dark = { on: u.uToneOn.value, tone: u.uTone.value.getHexString(), saved: localStorage.getItem("fractureRun.skinTone"), picked: document.querySelector("#skinPick .picked")?.dataset.skin };
      document.querySelector('#skinPick [data-skin="light"]').click();
      const light = { on: u.uToneOn.value };
      return { buttons, dark, light };
    });
    const failures = [];
    if (r.buttons.join() !== "light,medium,brown,dark") failures.push(`swatches: ${r.buttons}`);
    if (r.dark.on !== 1 || r.dark.tone !== "4d3427") failures.push(`the dark tone was not applied: ${JSON.stringify(r.dark)}`);
    if (r.dark.saved !== "dark" || r.dark.picked !== "dark") failures.push(`the choice was not saved or shown: ${JSON.stringify(r.dark)}`);
    if (r.light.on !== 0) failures.push("going back to light did not restore the model's own skin");
    return { failures, notes: {} };
  },
};
