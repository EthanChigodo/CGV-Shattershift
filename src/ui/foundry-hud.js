/**
 * Level 2 HUD - The Shifting Foundry.
 *
 * Builds its own DOM and stylesheet, so dropping it into the game is two lines
 * and nothing in index.html or styles.css has to change. It listens to the
 * level's events rather than reaching into the level, which keeps the
 * environment and the interface independent of each other.
 *
 *   const hud = new FoundryHud();
 *   hud.bind(level);          // subscribe to level events
 *   hud.show();
 *   hud.update({ distance, level, fps });
 *   hud.dispose();
 *
 * What it shows:
 *   - the beat banner as the player crosses into each section
 *   - three tower systems, filling in as switches are broken
 *   - a prompt when a live switch is close enough to shoot
 *   - chevrons before each 90-degree junction
 *   - the escape countdown, with a centre-lane warning as gates close
 *   - score toasts, and an optional dev readout with the FPS counter
 */

const SYSTEMS = ["ROUTE GATE", "PISTON LOCK", "EXTRACTION VALVE"];

function ensureStylesheet() {
  const href = new URL("./foundry-hud.css", import.meta.url).href;
  if (document.querySelector(`link[data-foundry-hud]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.foundryHud = "true";
  document.head.appendChild(link);
}

function element(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export class FoundryHud {
  /**
   * @param {{container?:HTMLElement, dev?:boolean, reducedMotion?:boolean}} options
   */
  constructor({ container = document.body, dev = false, reducedMotion = false } = {}) {
    ensureStylesheet();

    this.root = element("section", "foundry-ui");
    this.root.setAttribute("aria-label", "Foundry status");
    this.root.hidden = true;
    if (reducedMotion) this.root.classList.add("reduced-motion");

    /* Sector banner */
    this.banner = element("div", "fdy-banner");
    this.bannerLabel = element("span", null, "SECTOR 02");
    this.bannerName = element("strong", null, "THE SHIFTING FOUNDRY");
    this.banner.append(this.bannerLabel, this.bannerName, element("i"));

    /* Systems readout */
    this.systemsPanel = element("div", "fdy-systems");
    this.systemsPanel.append(element("span", null, "Tower systems"));
    this.systemRows = SYSTEMS.map((name) => {
      const row = element("div", "fdy-system");
      row.append(element("i"), element("span", null, name));
      this.systemsPanel.append(row);
      return row;
    });

    /* Switch prompt */
    this.prompt = element("div", "fdy-prompt");
    this.promptLabel = element("b", null, "SWITCH");
    this.promptRange = element("small", null, "SHOOT TO OPEN");
    this.prompt.append(element("i"), this.promptLabel, this.promptRange);

    /* Junction chevrons */
    this.junction = element("div", "fdy-junction");
    this.junction.append(element("u"), element("u"), element("u"));

    /* Escape panel */
    this.escape = element("div", "fdy-escape");
    const header = element("header");
    this.escapeClock = element("b", null, "26.0");
    header.append(element("span", null, "Containment"), this.escapeClock);
    this.escapeFill = element("div", "fdy-fill");
    const track = element("div", "fdy-track");
    track.append(this.escapeFill);
    this.escapeHint = element("small", null, "");
    this.escape.append(header, track, this.escapeHint);

    this.vignette = element("div", "fdy-vignette");

    /* Toasts and dev readout */
    this.toasts = element("div", "fdy-toasts");
    this.dev = element("div", "fdy-dev");
    this.dev.hidden = !dev;

    this.root.append(
      this.vignette,
      this.banner,
      this.systemsPanel,
      this.prompt,
      this.junction,
      this.escape,
      this.toasts,
      this.dev
    );
    container.append(this.root);

    this._unsubscribers = [];
    this._bannerTimer = null;
    this._junctionTimer = null;
    this._escapeActive = false;
    this._level = null;
    this._lastPromptKey = null;
  }

  /* ---------------------------------------------------------------- */
  /* Wiring                                                            */
  /* ---------------------------------------------------------------- */

  /** Subscribe to a FoundryLevel's events. Safe to call once per level. */
  bind(level) {
    this.unbind();
    this._level = level;

    const on = (name, fn) => this._unsubscribers.push(level.events.on(name, fn));

    on("beat", ({ name }) => this.showBanner("SECTOR 02", name));
    on("junction", ({ direction }) => this.showJunction(direction));

    on("system-restored", ({ label, online, total }) => {
      this.setSystems(online);
      this.toast(`${label} ONLINE`, `${online}/${total}`);
    });

    on("switch-broken", ({ label, points }) => this.toast(label, `+${points}`));
    on("switch-bonus", ({ label }) => this.toast(`${label} CLEAR`, ""));

    on("escape-start", ({ seconds }) => this.startEscape(seconds));
    on("escape-tick", ({ remaining }) => this.updateEscape(remaining));
    on("escape-end", ({ survived }) => this.endEscape(survived));

    on("complete", () => this.showBanner("SECTOR 02 COMPLETE", "EXTRACTION LIFT OPEN"));

    return this;
  }

  unbind() {
    for (const off of this._unsubscribers) off();
    this._unsubscribers = [];
    this._level = null;
  }

  show() {
    this.root.hidden = false;
    this.showBanner("SECTOR 02", "THE SHIFTING FOUNDRY");
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

  /* ---------------------------------------------------------------- */
  /* Pieces                                                            */
  /* ---------------------------------------------------------------- */

  showBanner(label, name, hold = 2600) {
    this.bannerLabel.textContent = label;
    this.bannerName.textContent = name;
    this.banner.classList.add("show");
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.banner.classList.remove("show"), hold);
  }

  setSystems(online) {
    this.systemRows.forEach((row, index) => row.classList.toggle("online", index < online));
  }

  showJunction(direction, hold = 2400) {
    this.junction.classList.remove("left", "right");
    this.junction.classList.add(direction, "show");
    clearTimeout(this._junctionTimer);
    this._junctionTimer = setTimeout(() => this.junction.classList.remove("show"), hold);
  }

  showPrompt(label, metresAway) {
    this.promptLabel.textContent = label;
    this.promptRange.textContent = `SHOOT // ${Math.max(0, Math.round(metresAway))}M`;
    this.prompt.classList.add("show");
  }

  hidePrompt() {
    this.prompt.classList.remove("show");
    this._lastPromptKey = null;
  }

  startEscape(seconds) {
    this._escapeSeconds = seconds;
    this._escapeActive = true;
    this.escape.classList.add("show");
    this.vignette.classList.add("show");
    this.escapeHint.textContent = "GATES CLOSING // HOLD THE CENTRE LANE";
    this.showBanner("CONTAINMENT FAILING", "RUN");
  }

  updateEscape(remaining) {
    if (!this._escapeActive) return;
    const ratio = Math.max(0, remaining / this._escapeSeconds);
    this.escapeClock.textContent = remaining.toFixed(1);
    this.escapeFill.style.transform = `scaleX(${ratio})`;
    const critical = remaining < 8;
    this.escape.classList.toggle("critical", critical);
    this.vignette.classList.toggle("critical", critical);
  }

  endEscape(survived) {
    this._escapeActive = false;
    this.escape.classList.remove("critical");
    this.vignette.classList.remove("show", "critical");
    this.escapeHint.textContent = survived ? "CONTAINMENT STABLE" : "CONTAINMENT LOST";
    setTimeout(() => this.escape.classList.remove("show"), survived ? 900 : 1600);
  }

  toast(text, value = "", life = 2200) {
    const node = element("div", "fdy-toast", `${text}${value ? `<b>${value}</b>` : ""}`);
    this.toasts.append(node);
    setTimeout(() => {
      node.classList.add("leaving");
      setTimeout(() => node.remove(), 320);
    }, life);
    // Never let toasts stack past the panel.
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  /* ---------------------------------------------------------------- */
  /* Per-frame                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * @param {{distance:number, fps?:number, renderer?:object, level?:object}} args
   */
  update({ distance, fps, renderer, level = this._level }) {
    if (this.root.hidden || !level) return;

    // Prompt for the nearest live switch in front of the player.
    const ahead = level.breakables
      .filter((mesh) => mesh.userData.alive && mesh.userData.routeDistance > distance - 3)
      .sort((a, b) => a.userData.routeDistance - b.userData.routeDistance)[0];

    if (ahead && ahead.userData.routeDistance - distance < 34) {
      const gap = ahead.userData.routeDistance - distance;
      this.showPrompt(ahead.userData.label, gap);
      this._lastPromptKey = ahead.uuid;
    } else if (this._lastPromptKey) {
      this.hidePrompt();
    }

    if (this.dev.hidden) return;
    const info = renderer?.info;
    this.dev.innerHTML = [
      `FPS <b>${fps !== undefined ? Math.round(fps) : "--"}</b>`,
      `DRAW <b>${info ? info.render.calls : "--"}</b>`,
      `TRIS <b>${info ? Math.round(info.render.triangles / 1000) + "k" : "--"}</b>`,
      `LIGHTS <b>${level.lights ? level.lights.pointLights.length + level.lights.spotLights.length : "--"}</b>`,
      `EMITTERS <b>${level.lights ? level.lights.emitterCount : "--"}</b>`,
      `ROUTE <b>${Math.round(distance)}m</b>`,
    ].join("<br>");
  }

  dispose() {
    this.unbind();
    clearTimeout(this._bannerTimer);
    clearTimeout(this._junctionTimer);
    this.root.remove();
  }
}

export default FoundryHud;
