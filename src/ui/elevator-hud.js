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

let grain = null;

/** A small tile of grey noise for the feed's grain (made once). */
function grainImage() {
  if (grain) return grain;
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d");
  const img = g.createImageData(96, 96);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grain = c.toDataURL();
  return grain;
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
    this.monitorEl.append(element("span", null, "Diagnostic · orthographic"));
    this.monitorEl.hidden = true;
    this.fullLabel = element("div", "elv-diag-label", "Diagnostic view · orthographic, from above");
    this.fullLabel.hidden = true;
    panel.hidden = !showPanel;
    // Cutscenes: letterbox bars and subtitles.
    this.bars = [element("div", "elv-bar top"), element("div", "elv-bar bottom")];
    this.captionEl = element("div", "elv-caption");
    this.captionWho = element("span", "elv-caption-who");
    this.captionText = element("span", "elv-caption-text");
    this.captionEl.append(this.captionWho, this.captionText);
    // A security camera's feed: scanlines, grain, its name, REC and a clock.
    this.feedEl = element("div", "elv-feed");
    this.feedEl.hidden = true;
    this.feedName = element("span", "elv-feed-name", "ASCENSION TOWER · LIFT 03 · CAM 2");
    this.feedRec = element("span", "elv-feed-rec", "● REC");
    this.feedTime = element("span", "elv-feed-time");
    this.feedEl.append(element("div", "elv-feed-grain"), this.feedName, this.feedRec, this.feedTime);
    this.root.append(...this.bars, this.feedEl, panel, this.alertEl, this.clampsEl, this.monitorEl, this.fullLabel, this.captionEl);
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
    // (The rides' alerts still carry the old "A // B" separators.)
    this.alertEl.textContent = String(text ?? "").replace(/\s*\/\/\s*/g, " · ");
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
    // The speaker sits small over the line (elevator-hud.css), so no colon.
    this.captionWho.textContent = who ?? "";
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

  /**
   * The security camera's feed over the picture, or null to hide it.
   * @param {{floor:number, seconds:number, glitch?:boolean}|null} f
   *   the floor, seconds into the ride (the clock), the feed breaking up
   */
  feed(f) {
    if (!f) {
      if (!this.feedEl.hidden) {
        this.feedEl.hidden = true;
        this.root.classList.remove("feed-on");
      }
      return;
    }
    if (this.feedEl.hidden) {
      this.feedEl.hidden = false;
      this.root.classList.add("feed-on");
      if (!this.feedEl.style.getPropertyValue("--grain")) this.feedEl.style.setProperty("--grain", `url(${grainImage()})`);
    }
    // Late at night, the clock running from when the ride began.
    const t = Math.floor(23 * 3600 + 41 * 60 + 7 + f.seconds);
    const two = (n) => String(n).padStart(2, "0");
    this.feedTime.textContent = `${two(Math.floor(t / 3600) % 24)}:${two(Math.floor(t / 60) % 60)}:${two(t % 60)} · FL ${String(Math.max(0, Math.floor(f.floor))).padStart(3, "0")}`;
    this.feedEl.classList.toggle("glitch", !!f.glitch);
  }

  dispose() {
    this.root.remove();
  }
}
