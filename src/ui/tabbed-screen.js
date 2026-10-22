/**
 * A full-screen page with tabs along the top, as the Trophies & Stats and
 * the Field Manual are drawn - for Settings and the Credits: buttons
 * [data-st-tab="key"], panels [data-st-panel="key"]. Q / E switch tabs while
 * the screen is up (L1 / R1 come through the pad bridge: cycleTab).
 *
 *   const tabs = new TabbedScreen(section, { onShow: (key) => ... });
 *   tabs.open("gameplay");
 */

import { ensureTrophyStyles } from "./trophy-toast.js";

export class TabbedScreen {
  constructor(root, { onShow = null } = {}) {
    ensureTrophyStyles();
    this.root = root;
    this.onShow = onShow;
    this.buttons = [...root.querySelectorAll("[data-st-tab]")];
    this.panels = [...root.querySelectorAll("[data-st-panel]")];
    this.tab = this.buttons[0]?.dataset.stTab ?? null;
    for (const b of this.buttons) b.addEventListener("click", () => this.setTab(b.dataset.stTab));
    addEventListener("keydown", (e) => {
      if (!root.classList.contains("active") || e.repeat) return;
      // (Not while typing in a field.)
      if (e.target instanceof HTMLInputElement && e.target.type === "text") return;
      if (e.code === "KeyQ" || e.code === "KeyE") { e.preventDefault(); this.cycleTab(e.code === "KeyE" ? 1 : -1); }
    });
  }

  open(tab = this.tab) {
    this.setTab(tab, true);
  }

  cycleTab(step) {
    const keys = this.buttons.map((b) => b.dataset.stTab);
    this.setTab(keys[(keys.indexOf(this.tab) + step + keys.length) % keys.length]);
  }

  setTab(tab, force = false) {
    if (tab === this.tab && !force) return;
    this.tab = tab;
    for (const b of this.buttons) {
      const on = b.dataset.stTab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
      if (on) b.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    for (const p of this.panels) {
      const on = p.dataset.stPanel === tab;
      p.hidden = !on;
      // The panel slides in again each time.
      if (on) { p.classList.remove("tr-panel"); void p.offsetWidth; p.classList.add("tr-panel"); }
    }
    this.onShow?.(tab);
    this.root.querySelector(".tr-scroll")?.scrollTo({ top: 0 });
  }
}
