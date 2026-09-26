/**
 * HUD for the elevator rides.
 *
 * Built like the other level HUDs - its own DOM and stylesheet - and kept
 * small: a floor counter with speed, and an alert line for what is
 * happening to the lift.
 *
 *   const hud = new ElevatorHud({ title: "SECTOR 02 -> 03" });
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
  constructor({ container = document.body, eyebrow = "GRAVITY LIFT", title = "SECTOR 02 → 03" } = {}) {
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
    this.root.append(panel, this.alertEl);
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

  dispose() {
    this.root.remove();
  }
}
