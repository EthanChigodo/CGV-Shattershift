/**
 * What a control is called on screen, for the controller in use.
 *
 * The game's own controls are keyboard codes ("KeyE", "Space"). A controller
 * adds its own codes, named for where the control is, not what is printed
 * on it - the same place on every pad:
 *
 *   PadLUp PadLDown PadLLeft PadLRight   a flick of the left stick
 *   PadRUp PadRDown PadRLeft PadRRight   a flick of the right stick
 *   PadLT PadRT                          the triggers
 *   PadA PadB PadX PadY                  the face buttons (bottom, right, left, top)
 *
 * and this names them for the family that is plugged in: Xbox "A" / "RT",
 * PlayStation "✕" / "R2", Nintendo "B" / "ZR".
 */

const FACES = {
  xbox: { PadA: "A", PadB: "B", PadX: "X", PadY: "Y", PadLB: "LB", PadRB: "RB", PadLT: "LT", PadRT: "RT", PadStart: "MENU", PadBack: "VIEW" },
  playstation: { PadA: "✕", PadB: "○", PadX: "□", PadY: "△", PadLB: "L1", PadRB: "R1", PadLT: "L2", PadRT: "R2", PadStart: "OPTIONS", PadBack: "SHARE" },
  nintendo: { PadA: "B", PadB: "A", PadX: "Y", PadY: "X", PadLB: "L", PadRB: "R", PadLT: "ZL", PadRT: "ZR", PadStart: "+", PadBack: "−" },
};
FACES.generic = FACES.xbox;

const STICKS = {
  PadLUp: "L↑", PadLDown: "L↓", PadLLeft: "L←", PadLRight: "L→",
  PadRUp: "R↑", PadRDown: "R↓", PadRLeft: "R←", PadRRight: "R→",
};

/** Every stick flick, left stick then right. */
export const PAD_LEFT_FLICKS = ["PadLUp", "PadLDown", "PadLLeft", "PadLRight"];
export const PAD_RIGHT_FLICKS = ["PadRUp", "PadRDown", "PadRLeft", "PadRRight"];
export const PAD_FLICKS = [...PAD_LEFT_FLICKS, ...PAD_RIGHT_FLICKS];

let family = "generic";
let active = false;

/** A controller is what is being played with (the names on screen follow it). */
export function setPadActive(on) {
  active = !!on;
}
export function padActive() {
  return active;
}

/** Which controller family the names are for ("xbox" | "playstation" | "nintendo" | "generic"). */
export function setPadFamily(f) {
  family = FACES[f] ? f : "generic";
}
export function padFamily() {
  return family;
}

/** The family a Gamepad's id string belongs to. */
export function familyOf(id = "") {
  if (/xbox|xinput|045e/i.test(id)) return "xbox";
  if (/playstation|dualshock|dualsense|054c|wireless controller/i.test(id)) return "playstation";
  if (/nintendo|pro controller|joy-?con|057e/i.test(id)) return "nintendo";
  return "generic";
}

/** A friendly name for a Gamepad's id. */
export function padName(id = "") {
  const f = familyOf(id);
  if (f === "xbox") return "Xbox controller";
  if (f === "playstation") return /dualsense/i.test(id) || /0ce6/i.test(id) ? "DualSense" : "PlayStation controller";
  if (f === "nintendo") return /joy-?con/i.test(id) ? "Joy-Con" : "Switch Pro controller";
  return "Controller";
}

/** True for a controller code. */
export function isPadCode(code) {
  return typeof code === "string" && code.startsWith("Pad");
}

/** "PadRT" -> "RT" (or "R2", "ZR"); "PadLUp" -> "L↑"; null for a keyboard code. */
export function padLabel(code) {
  if (!isPadCode(code)) return null;
  return STICKS[code] ?? FACES[family][code] ?? code.slice(3).toUpperCase();
}
