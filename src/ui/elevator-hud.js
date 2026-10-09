/**
 * HUD for the elevator rides.
 *
 * Built like the other level HUDs - its own DOM and stylesheet - and kept
 * small: a floor counter with speed, an alert line for what is happening
 * to the lift, the brake clamps still to lock (with the seconds left), and
 * the frame and label of the diagnostic monitor.
 *
 *   const hud = new ElevatorHud({ title: "SECTOR 01 -> 02" });
 *   hud.show();
 *   hud.setFloor(141, 12.5);
 *   hud.alert("GRAVITY FAULT", "danger");
 *   hud.dispose();
 */

function ensureStylesheet() {
  if (document.querySelector("link[data-elevator-hud]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./elevator-hud.css", import.meta.url).href;
  link.dataset.elevatorHud = "true";
  document.head.appendChild(link);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class ElevatorHud {
  /**
   * @param {object} [o]
   * @param {boolean} [o.panel]  the floor counter panel (off for cutscenes,
   *   whose floor display is in the cabin itself)
   */
  constructor({ container = document.body, eyebrow = "GRAVITY LIFT", title = "SECTOR 01 → 02", panel: showPanel = true } = {}) {
    ensureStylesheet();
    this.root = element("section", "elevator-ui");
    this.root.setAttribute("aria-label", "Lift status");
    this.root.hidden = true;

    const panel = element("div", "elv-panel");
    const head = element("div", "elv-head");
    head.append(element("span", "elv-eyebrow", eyebrow), element("span", "elv-title", title));
    const readout = element("div", "elv-readout");
    this.floorEl = element("strong", "elv-floor", "000");
    this.arrowEl = element("span", "elv-arrow", "▲");
    this.speedEl = element("span", "elv-speed", "0.0 m/s");
    readout.append(element("span", "elv-label", "FLOOR"), this.floorEl, this.arrowEl, this.speedEl);
    panel.append(head, readout);

    this.alertEl = element("div", "elv-alert");
    this.clampsEl = element("div", "elv-clamps");
    this.clampsEl.hidden = true;
    this.monitorEl = element("div", "elv-monitor");
    this.monitorEl.append(element("span", null, "DIAGNOSTIC // ORTHO"));
    this.monitorEl.hidden = true;
    this.fullLabel = element("div", "elv-diag-label", "DIAGNOSTIC VIEW // ORTHOGRAPHIC // TOP");
    this.fullLabel.hidden = true;
    panel.hidden = !showPanel;
    // Cutscenes: letterbox bars and subtitles.
    this.bars = [element("div", "elv-bar top"), element("div", "elv-bar bottom")];
    this.captionEl = element("div", "elv-caption");
    this.captionWho = element("span", "elv-caption-who");
    this.captionText = element("span", "elv-caption-text");
    this.captionEl.append(this.captionWho, this.captionText);
    this.root.append(...this.bars, panel, this.alertEl, this.clampsEl, this.monitorEl, this.fullLabel, this.captionEl);
    container.appendChild(this.root);
    this._floor = null;
  }

  show() {
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }

  setFloor(floor, speed) {
    const f = Math.max(0, Math.round(floor));
    if (f !== this._floor) {
      this._floor = f;
      this.floorEl.textContent = String(f).padStart(3, "0");
    }
    this.speedEl.textContent = `${Math.abs(speed).toFixed(1)} m/s`;
    this.arrowEl.textContent = speed < -0.2 ? "▼" : "▲";
    this.arrowEl.classList.toggle("down", speed < -0.2);
  }

  /** @param {string|null} text  null clears it. @param {"info"|"danger"|"good"} tone */
  alert(text, tone = "info") {
    this.alertEl.textContent = text ?? "";
    this.alertEl.className = `elv-alert ${text ? `show ${tone}` : ""}`;
  }

  /** Letterbox bars in (true) or out (false). */
  cinema(on) {
    for (const bar of this.bars) bar.classList.toggle("on", on);
  }

  /** A subtitle: who is speaking (or null) and what; pass null text to clear. */
  caption(who, text) {
    this.captionEl.classList.toggle("show", !!text);
    if (!text) return;
    this.captionWho.textContent = who ? `${who}: ` : "";
    this.captionText.textContent = text;
  }

  /** Clamps locked out of total, and seconds left (null: done). Pass null to hide. */
  setClamps(locked, total = 3, seconds = null) {
    if (locked === null) {
      this.clampsEl.hidden = true;
      return;
    }
    this.clampsEl.hidden = false;
    const pips = "\u25C6".repeat(locked) + "\u25C7".repeat(total - locked);
    this.clampsEl.textContent = `BRAKE CLAMPS ${pips}${seconds === null ? "" : `  ${Math.ceil(seconds)}s`}`;
    this.clampsEl.classList.toggle("done", locked === total);
  }

  /**
   * The picture-in-picture monitor's frame, over the rect the ride renders
   * into ({x, y, w, h}, CSS px from the bottom left), or null to hide it.
   * `full`: the diagnostic view is the whole screen (label only).
   */
  monitor(rect, full = false) {
    this.fullLabel.hidden = !full;
    if (!rect) {
      this.monitorEl.hidden = true;
      return;
    }
    const m = this.monitorEl;
    m.hidden = false;
    m.style.right = `${innerWidth - rect.x - rect.w}px`;
    m.style.bottom = `${rect.y}px`;
    m.style.width = `${rect.w}px`;
    m.style.height = `${rect.h}px`;
  }

  dispose() {
    this.root.remove();
  }
}
