/**
 * The Trophies & Stats screen (index.html #trophiesScreen), two tabs:
 *
 *   TROPHIES     how far along you are (a ring to the platinum, each tier's
 *                count, the latest), filters, then every trophy as a card -
 *                its badge, what it's for, and when you earned it or how
 *                far along you are. Hidden ones keep their secret until earned.
 *   STATISTICS   the big four first (trophies, escapes, best escape, time
 *                played), then the rest in sections, most telling first.
 *
 * Mouse, keyboard (Q / E the tabs) or controller (L1 / R1; the D-pad moves
 * over the cards and the sections, the page scrolling with it).
 *
 *   const room = new TrophyRoom(section, { stats: () => model });
 *   room.open("trophies");
 */

import { TROPHIES, TIERS, progress } from "../systems/trophies.js";
import { trophyBadge, cupIcon, kitToken } from "./trophy-art.js";
import { KITS, KIT_ORDER, kitUnlocked } from "../figure/kits.js";
import { ensureTrophyStyles } from "./trophy-toast.js";

const FILTERS = [["all", "All"], ["single", "Single player"], ["multi", "Multiplayer"], ["earned", "Earned"], ["locked", "Not yet"]];
const dateOf = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export class TrophyRoom {
  constructor(root, { stats }) {
    ensureTrophyStyles();
    this.root = root;
    this.stats = stats;
    this.tab = "trophies";
    this.filter = "all";
    this.panels = {
      trophies: root.querySelector('[data-tr-panel="trophies"]'),
      stats: root.querySelector('[data-tr-panel="stats"]'),
    };
    for (const b of root.querySelectorAll("[data-tr-tab]")) b.addEventListener("click", () => this.setTab(b.dataset.trTab));
    // Q / E switch tabs while the screen is up (L1 / R1 come through the pad bridge).
    addEventListener("keydown", (e) => {
      if (!root.classList.contains("active") || e.repeat) return;
      if (e.code === "KeyQ" || e.code === "KeyE") { e.preventDefault(); this.cycleTab(e.code === "KeyE" ? 1 : -1); }
    });
  }

  open(tab = this.tab) {
    this.setTab(tab, true);
  }

  cycleTab(step) {
    const tabs = ["trophies", "stats"];
    this.setTab(tabs[(tabs.indexOf(this.tab) + step + tabs.length) % tabs.length]);
  }

  setTab(tab, force = false) {
    if (tab === this.tab && !force) return;
    this.tab = tab;
    for (const b of this.root.querySelectorAll("[data-tr-tab]")) {
      const on = b.dataset.trTab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }
    for (const [key, panel] of Object.entries(this.panels)) panel.hidden = key !== tab;
    if (tab === "trophies") this._trophies();
    else this._stats();
    this.root.querySelector(".tr-scroll")?.scrollTo({ top: 0 });
  }

  /* ---- Trophies ---- */

  _trophies() {
    const s = progress.summary();
    const latest = progress.latest();
    const tierChip = (key) => {
      const [got, of] = s.counts[key];
      return `<span class="tr-chip tier-${key}" style="--tc:${TIERS[key].colour}">${cupIcon()}<b>${got}</b><small>/ ${of}</small><em>${TIERS[key].label}</em></span>`;
    };
    const plat = TROPHIES.find((t) => t.tier === "platinum");
    this.panels.trophies.innerHTML = `
      <section class="tr-summary">
        <div class="tr-ring${progress.has("platinum") ? " done" : ""}" style="--p:${s.percent}">${trophyBadge(plat)}<em>${s.percent}<small>%</small></em></div>
        <div class="tr-sum-text">
          <b>${s.earned} of ${s.total} trophies</b>
          <small>${progress.has("platinum") ? "Platinum earned. Fracture proof." : "Earn every trophy for the platinum."}</small>
          <div class="tr-chips">${["bronze", "silver", "gold", "platinum"].map(tierChip).join("")}</div>
        </div>
        <div class="tr-latest">${latest
          ? `<small>LATEST</small><div>${trophyBadge(latest)}<span><b>${latest.name}</b><em>${dateOf(progress.earned[latest.id])}</em></span></div>`
          : `<small>LATEST</small><p>None yet. Play to earn your first.</p>`}</div>
      </section>
      <h3 class="tr-group">Kits <small>Looks you earn - wear them in Customise, and in the Arena and the Race</small></h3>
      <div class="tr-grid tr-kits">${KIT_ORDER.map((k) => this._kit(KITS[k])).join("")}</div>
      <div class="segmented tr-filters" role="group" aria-label="Show">${FILTERS.map(([k, label]) => `<button type="button" class="head-button${k === this.filter ? " picked" : ""}" data-filter="${k}" aria-pressed="${k === this.filter}">${label}</button>`).join("")}</div>
      <div class="tr-list">${this._cards()}</div>`;
    for (const b of this.panels.trophies.querySelectorAll("[data-filter]")) {
      b.addEventListener("click", () => { this.filter = b.dataset.filter; this._trophies(); this.panels.trophies.querySelector(`[data-filter="${this.filter}"]`)?.focus(); });
    }
  }

  _kit(kit) {
    const got = kitUnlocked(kit.key);
    return `<article class="tr-card tr-kit${got ? " got" : ""}" tabindex="0" style="--tc:${kit.colour}">
      <div class="tr-art">${kitToken(kit, { locked: !got })}</div>
      <div class="tr-body">
        <header><b>${kit.name}</b><span class="tr-tier">${got ? "Unlocked" : "Locked"}</span></header>
        <p>${kit.blurb} ${kit.items.join(" · ")}.</p>
        <footer>${got ? `<span class="tr-earned">In Customise now</span>` : `<span class="tr-locked">${kit.how} to unlock</span>`}</footer>
      </div>
    </article>`;
  }

  _cards() {
    const keep = (t) => {
      const got = progress.has(t.id);
      if (this.filter === "single") return t.mode === "single";
      if (this.filter === "multi") return t.mode === "multi";
      if (this.filter === "earned") return got;
      if (this.filter === "locked") return !got;
      return true;
    };
    const groups = [
      ["all", "", TROPHIES.filter((t) => t.mode === "all")],
      ["single", "Single player", TROPHIES.filter((t) => t.mode === "single")],
      ["multi", "Multiplayer <small>Earned as Player 1 - the first controller in</small>", TROPHIES.filter((t) => t.mode === "multi")],
    ];
    let html = "";
    for (const [, title, list] of groups) {
      const shown = list.filter(keep);
      if (!shown.length) continue;
      if (title) html += `<h3 class="tr-group">${title}</h3>`;
      html += `<div class="tr-grid">${shown.map((t) => this._card(t)).join("")}</div>`;
    }
    return html || `<p class="tr-empty">Nothing here yet.</p>`;
  }

  _card(t) {
    const got = progress.has(t.id);
    const secret = t.hidden && !got;
    const tier = TIERS[t.tier];
    const pr = progress.progressOf(t);
    let foot;
    if (got) foot = `<span class="tr-earned">${cupIcon()}Earned ${dateOf(progress.earned[t.id])}</span>`;
    else if (pr && !secret) foot = `<span class="tr-bar"><i style="width:${(pr.value / pr.goal) * 100}%"></i></span><span class="tr-count">${pr.value.toLocaleString()} / ${pr.goal.toLocaleString()}</span>`;
    else foot = `<span class="tr-locked">Not earned yet</span>`;
    return `<article class="tr-card tier-${t.tier}${got ? " got" : ""}${secret ? " secret" : ""}" tabindex="0" style="--tc:${tier.colour}">
      <div class="tr-art">${trophyBadge(t, { mark: !secret })}</div>
      <div class="tr-body">
        <header><b>${secret ? "Hidden trophy" : t.name}</b><span class="tr-tier">${cupIcon()}${tier.label}</span></header>
        <p>${secret ? "Keep playing to reveal it." : t.text}</p>
        <footer>${foot}</footer>
      </div>
    </article>`;
  }

  /* ---- Statistics ---- */

  _stats() {
    const m = this.stats();
    this.panels.stats.innerHTML = `
      <section class="tr-hero">${m.hero.map((h) => `<div class="tr-big" tabindex="0" style="--tc:${h.colour ?? "#7ef4f1"}"><small>${h.label}</small><b>${h.value}</b>${h.note ? `<em>${h.note}</em>` : ""}</div>`).join("")}</section>
      <div class="tr-sections">${m.sections.map((sec) => `
        <section class="tr-sec" tabindex="0">
          <h3>${sec.title}${sec.note ? `<small>${sec.note}</small>` : ""}</h3>
          <dl>${sec.rows.map((r) => `
            <div class="tr-row${r.bar !== undefined ? " has-bar" : ""}">
              <dt>${r.colour ? `<i style="background:${r.colour}"></i>` : ""}${r.label}</dt>
              <dd>${r.value}${r.note ? `<small>${r.note}</small>` : ""}</dd>
              ${r.bar !== undefined ? `<span class="tr-bar"><i style="width:${Math.round(Math.max(0, Math.min(1, r.bar)) * 100)}%${r.colour ? `;background:${r.colour}` : ""}"></i></span>` : ""}
            </div>`).join("")}</dl>
        </section>`).join("")}</div>`;
  }
}
