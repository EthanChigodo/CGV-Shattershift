/**
 * Game controllers: PlayStation (DualShock 4, DualSense) and Xbox pads, or
 * any pad the browser reports with the "standard" mapping.
 *
 *   const pads = new Gamepads();
 *   pads.poll();                       // once a frame, before the game updates
 *   const p = pads.get(0);             // the first connected pad, or null
 *   p.move.x, p.move.y                 // left stick, -1..1 (y up), dead zone applied
 *   p.aim.x, p.aim.y                   // right stick
 *   p.held.cross, p.pressed.cross      // held now / went down this poll
 *   p.released.r2, p.value.r2          // went up this poll / trigger 0..1
 *   p.kind                             // "ps" | "xbox" | "generic"
 *
 * Buttons are named by position, the PlayStation way, because the two
 * families put the same button in the same place:
 *
 *   cross   = A        circle   = B       square = X       triangle = Y
 *   l1      = LB       r1       = RB      l2     = LT      r2       = RT
 *   share   = View     options  = Menu    l3     = LS      r3       = RS
 *   up down left right = the d-pad         home   = PS / Xbox button
 *
 * `label(name, kind)` gives the button's own name on that pad ("A" on an
 * Xbox pad, "✕" on a PlayStation one) for on-screen prompts.
 *
 * Pads are listed in the order they were connected (`slot`), so player 1
 * keeps pad 1 when a second pad joins.
 */

const BUTTONS = ["cross", "circle", "square", "triangle", "l1", "r1", "l2", "r2", "share", "options", "l3", "r3", "up", "down", "left", "right", "home"];

/** Each button's name as printed on the pad. */
const LABELS = {
  ps: {
    cross: "✕", circle: "○", square: "□", triangle: "△", l1: "L1", r1: "R1", l2: "L2", r2: "R2",
    share: "Create", options: "Options", l3: "L3", r3: "R3", up: "↑", down: "↓", left: "←", right: "→", home: "PS",
  },
  xbox: {
    cross: "A", circle: "B", square: "X", triangle: "Y", l1: "LB", r1: "RB", l2: "LT", r2: "RT",
    share: "View", options: "Menu", l3: "LS", r3: "RS", up: "↑", down: "↓", left: "←", right: "→", home: "Xbox",
  },
};
LABELS.generic = LABELS.xbox;

/** Stick dead zone (radial) and the trigger's press point. */
const DEAD = 0.18;
const TRIGGER = 0.35;

/** Which family a pad is, from the id the browser reports. */
export function padKind(id = "") {
  const s = id.toLowerCase();
  // Xbox first: an Xbox pad over Bluetooth also calls itself a "Wireless Controller".
  if (/045e|xbox|xinput|microsoft/.test(s)) return "xbox";
  if (/054c|sony|dualsense|dualshock|playstation|wireless controller|ps4|ps5/.test(s)) return "ps";
  return "generic";
}

export function label(name, kind = "xbox") {
  return (LABELS[kind] ?? LABELS.xbox)[name] ?? name;
}

function stick(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEAD) return { x: 0, y: 0 };
  // Rescaled past the dead zone, so small moves start from zero, not a jump.
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return { x: x * k, y: -y * k };
}

function blank() {
  const flags = () => Object.fromEntries(BUTTONS.map((b) => [b, false]));
  return {
    index: -1, slot: 0, id: "", kind: "generic", connected: false,
    move: { x: 0, y: 0 }, aim: { x: 0, y: 0 },
    held: flags(), pressed: flags(), released: flags(),
    value: Object.fromEntries(BUTTONS.map((b) => [b, 0])),
  };
}

export class Gamepads {
  constructor() {
    /** Every pad seen, by the browser's index. */
    this.byIndex = new Map();
    this.nextSlot = 0;
    /** The family of the pad used last (for prompts), or null with none in use. */
    this.lastKind = null;
    /** Seconds since any pad did anything (Infinity: never). */
    this.idle = Infinity;
    this.supported = typeof navigator !== "undefined" && typeof navigator.getGamepads === "function";
    if (typeof addEventListener === "function") {
      addEventListener("gamepaddisconnected", (event) => {
        const p = this.byIndex.get(event.gamepad.index);
        if (p) p.connected = false;
      });
    }
  }

  /** Read every pad. Call once a frame; `dt` (seconds) only drives `idle`. */
  poll(dt = 0) {
    this.idle += dt;
    if (!this.supported) return;
    const list = navigator.getGamepads() ?? [];
    for (const gp of list) {
      if (!gp || !gp.connected) continue;
      let p = this.byIndex.get(gp.index);
      if (!p || p.id !== gp.id) {
        p = blank();
        p.index = gp.index;
        p.id = gp.id;
        p.kind = padKind(gp.id);
        p.slot = this.nextSlot++;
        this.byIndex.set(gp.index, p);
      }
      p.connected = true;
      p.move = stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
      p.aim = stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
      let active = p.move.x || p.move.y || p.aim.x || p.aim.y;
      for (let i = 0; i < BUTTONS.length; i += 1) {
        const name = BUTTONS[i];
        const b = gp.buttons[i];
        const v = b ? (typeof b === "object" ? b.value : b) : 0;
        const down = name === "l2" || name === "r2" ? v > TRIGGER : !!(b && (b.pressed || v > 0.5));
        p.pressed[name] = down && !p.held[name];
        p.released[name] = !down && p.held[name];
        p.held[name] = down;
        p.value[name] = v;
        if (down) active = true;
      }
      if (active) { this.idle = 0; this.lastKind = p.kind; }
    }
    for (const p of this.byIndex.values()) {
      if (list[p.index]?.connected) continue;
      p.connected = false;
      for (const name of BUTTONS) { p.released[name] = p.held[name]; p.held[name] = p.pressed[name] = false; p.value[name] = 0; }
      p.move = { x: 0, y: 0 };
      p.aim = { x: 0, y: 0 };
    }
  }

  /** Connected pads, in the order they joined. */
  list() {
    return [...this.byIndex.values()].filter((p) => p.connected).sort((a, b) => a.slot - b.slot);
  }

  /** The n-th connected pad (0: the first), or null. */
  get(n = 0) {
    return this.list()[n] ?? null;
  }

  /** How many pads are connected. */
  get count() {
    return this.list().length;
  }

  /** Rumble, where the browser and the pad support it (0..1, seconds). */
  rumble(n, strong = 0.6, weak = 0.4, seconds = 0.2) {
    const p = this.get(n);
    const gp = p && navigator.getGamepads?.()[p.index];
    gp?.vibrationActuator?.playEffect?.("dual-rumble", {
      duration: Math.round(seconds * 1000), strongMagnitude: strong, weakMagnitude: weak,
    }).catch?.(() => {});
  }
}

export { BUTTONS };
