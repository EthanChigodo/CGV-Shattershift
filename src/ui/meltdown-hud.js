/**
 * Level 3 HUD - The Meltdown.
 *
 * Built the same way as Level 2's FoundryHud - its own DOM and stylesheet, so
 * dropping it into the game is two lines - but deliberately sparser. Per the
 * design brief, only ball count and vitality are ever shown continuously; the
 * hidden phase timer is never rendered as a persistent clock, only surfaced
 * through the level's own evac-sign events and, briefly, a toast.
 *
 *   const hud = new MeltdownHud();
 *   hud.bind(level);
 *   hud.show();
 *   hud.update({ fps });
 *   hud.dispose();
 */

function ensureStylesheet() {
  const href = new URL("./meltdown-hud.css", import.meta.url).href;
  if (document.querySelector(`link[data-meltdown-hud]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.meltdownHud = "true";
  document.head.appendChild(link);
}

function element(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export class MeltdownHud {
  constructor({ container = document.body, dev = false, reducedMotion = false } = {}) {
    ensureStylesheet();

    this.root = element("section", "meltdown-ui");
    this.root.setAttribute("aria-label", "Meltdown status");
    this.root.hidden = true;
    if (reducedMotion) this.root.classList.add("reduced-motion");

    this.banner = element("div", "mlt-banner");
    this.bannerLabel = element("span", null, "SECTOR 03");
    this.bannerName = element("strong", null, "THE MELTDOWN");
    this.banner.append(this.bannerLabel, this.bannerName);

    this.vignette = element("div", "mlt-vignette");
    this.damage = element("div", "mlt-damage");

    this.vitals = element("div", "mlt-vitals");
    this.ballsStat = element("div", "mlt-stat balls");
    this.ballsStat.append(element("span", null, "Balls"), element("strong", null, "0"));

    this.vitalityStat = element("div", "mlt-stat vitality");
    this.vitalityFill = element("div", "mlt-fill");
    const vitalityTrack = element("div", "mlt-track");
    vitalityTrack.append(this.vitalityFill);
    this.vitalityValue = element("strong", null, "100");
    this.vitalityStat.append(element("span", null, "Vitality"), vitalityTrack);
    this.vitalityStat.append(this.vitalityValue);

    this.vitals.append(this.ballsStat, this.vitalityStat);

    this.toasts = element("div", "mlt-toasts");
    this.dev = element("div", "mlt-dev");
    this.dev.hidden = !dev;

    this.prompt = element("div", "mlt-prompt");
    this.loading = element("div", "mlt-loading");
    this.loadingFill = element("i");
    this.loadingLabel = element("span", null, "LOADING MODELS");
    this.loading.append(this.loadingLabel, this.loadingFill);
    this.loading.hidden = true;

    this.summary = element("div", "mlt-summary");
    this.summaryCard = element("div", "mlt-summary-card");
    this.summaryEyebrow = element("span", null, "SECTOR 03");
    this.summaryTitle = element("h2", null, "THE MELTDOWN");
    this.summaryRows = element("div", "mlt-summary-rows");
    this.summaryCard.append(
      this.summaryEyebrow,
      this.summaryTitle,
      this.summaryRows,
      element("small", null, "PRESS R TO RUN AGAIN")
    );
    this.summary.append(this.summaryCard);

    this.root.append(this.vignette, this.damage, this.banner, this.vitals, this.prompt, this.toasts, this.dev, this.loading, this.summary);
    container.append(this.root);

    this._unsubscribers = [];
    this._bannerTimer = null;
    this._level = null;
    this._lastBalls = null;
  }

  bind(level) {
    this.unbind();
    this._level = level;
    const on = (name, fn) => this._unsubscribers.push(level.events.on(name, fn));

    on("beat", ({ name }) => this.showBanner("SECTOR 03", name));
    on("impact", ({ strength }) => this.flashDamage(strength));
    on("sign", ({ remaining }) => this.toast("EXIT", `${remaining}S`, "sign"));
    on("sack-broken", ({ spheres }) => this.toast("SACK", `+${spheres}`));
    on("sack-hit", () => this.toast("SACK HIT", ""));
    on("powerup", ({ label }) => this.toast(label, "", "power"));
    on("duct-cleared", () => this.toast("DUCT CLEARED", ""));
    on("hazard-fall", ({ kind }) => {
      if (kind === "chunk") this.toast("CEILING!", "", "warn", 1200);
      if (kind === "shelf") this.toast("SHELF TIPPING", "", "warn", 1200);
    });
    on("hall", ({ name }) => this.showBanner("ENTERING", name, 2200));
    on("patient-lurch", () => this.toast("PATIENT", "IN THE LANE", "warn", 1300));
    on("patient-down", () => this.toast("DOWN", ""));
    on("warp-start", () => this.showBanner("STRUCTURAL FAILURE", "SOMETHING BROKE LOOSE"));
    on("timer-expired", () => this.toast("STRUCTURE FAILING", "", "warn"));
    on("complete", () => this.showBanner("SECTOR 03 CLEARED", "ROOF ACCESS"));

    return this;
  }

  unbind() {
    for (const off of this._unsubscribers) off();
    this._unsubscribers = [];
    this._level = null;
  }

  show() {
    this.root.hidden = false;
    this.showBanner("SECTOR 03", "THE MELTDOWN");
    return this;
  }

  hide() {
    this.root.hidden = true;
    return this;
  }

  setReducedMotion(enabled) {
    this.root.classList.toggle("reduced-motion", Boolean(enabled));
  }

  setDevVisible(visible) {
    this.dev.hidden = !visible;
  }

  showBanner(label, name, hold = 2600) {
    this.bannerLabel.textContent = label;
    this.bannerName.textContent = name;
    this.banner.classList.add("show");
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.banner.classList.remove("show"), hold);
  }

  flashDamage() {
    this.damage.classList.remove("hit");
    void this.damage.offsetWidth;
    this.damage.classList.add("hit");
  }

  /** @param {number} value 0..1, how close the fire is - drives the vignette. */
  setDanger(value) {
    const ratio = Math.max(0, Math.min(1, value));
    this.vignette.style.opacity = String(ratio * 0.7);
    this.vignette.classList.toggle("critical", ratio > 0.75);
  }

  setVitality(value, max = 100) {
    const ratio = Math.max(0, Math.min(1, value / max));
    this.vitalityFill.style.transform = `scaleX(${ratio})`;
    this.vitalityValue.textContent = String(Math.round(value));
    this.vitalityStat.classList.toggle("hurt", ratio <= 0.6 && ratio > 0.3);
    this.vitalityStat.classList.toggle("critical", ratio <= 0.3);
  }

  /** Context prompt above the vitals, e.g. "MASH SPACE". Pass null to hide. */
  setPrompt(text) {
    if (text === this._promptText) return;
    this._promptText = text;
    this.prompt.textContent = text ?? "";
    this.prompt.classList.toggle("show", Boolean(text));
  }

  /** 0..1 while models stream in; null hides it. */
  setLoading(ratio) {
    this.loading.hidden = ratio === null || ratio >= 1;
    if (ratio !== null) this.loadingFill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
  }

  setBalls(count) {
    if (count === this._lastBalls) return;
    this.ballsStat.querySelector("strong").textContent = String(count);
    this.ballsStat.classList.toggle("empty", count <= 0);
    this._pop(this.ballsStat);
    this._lastBalls = count;
  }

  _pop(node) {
    node.classList.remove("pop");
    void node.offsetWidth;
    node.classList.add("pop");
  }

  showSummary({ title, eyebrow = "SECTOR 03", rows = [], failed = false }) {
    this.summaryEyebrow.textContent = eyebrow;
    this.summaryTitle.textContent = title;
    this.summaryCard.classList.toggle("failed", failed);
    this.summaryRows.replaceChildren();
    for (const [label, value, isTotal] of rows) {
      const row = element("div", `mlt-summary-row${isTotal ? " total" : ""}`);
      row.append(element("span", null, label), element("b", null, String(value)));
      this.summaryRows.append(row);
    }
    this.summary.classList.add("show");
  }

  hideSummary() {
    this.summary.classList.remove("show");
  }

  toast(text, value = "", kind = "", life = 2200) {
    const node = element("div", `mlt-toast ${kind}`.trim(), `${text}${value ? `<b>${value}</b>` : ""}`);
    this.toasts.append(node);
    setTimeout(() => {
      node.classList.add("leaving");
      setTimeout(() => node.remove(), 320);
    }, life);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  update({ fps, renderer } = {}) {
    if (this.root.hidden || this.dev.hidden) return;
    const info = renderer?.info;
    this.dev.innerHTML = [
      `FPS <b>${fps !== undefined ? Math.round(fps) : "--"}</b>`,
      `DRAW <b>${info ? info.render.calls : "--"}</b>`,
      `TRIS <b>${info ? Math.round(info.render.triangles / 1000) + "k" : "--"}</b>`,
    ].join("<br>");
  }

  dispose() {
    this.unbind();
    clearTimeout(this._bannerTimer);
    this.root.remove();
  }
}

export default MeltdownHud;
