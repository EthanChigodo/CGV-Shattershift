/**
 * A pretend controller for the checks: page.addInitScript(installFakePad)
 * replaces navigator.getGamepads with up to four "standard" mapping pads
 * the check holds the buttons and sticks of, through globalThis.__fakePad:
 *
 *   __fakePad.connect();                   // a DualSense in slot 0 (or connect(XBOX))
 *   __fakePad.set("r2", true);             // hold a button (gamepad.js names)
 *   __fakePad.axes(lx, ly, rx, ry);        // sticks, -1..1, y down as the browser has it
 *   __fakePad.tap("cross");                // down for one poll, up for the next
 *   __fakePad.frame();                     // the game's pad driver polls once (__dbg.pad.update)
 *   __fakePad.get().vibrationActuator.effects   // every rumble asked for
 *
 * The game's own frame loop polls the pad too; a press and its release in
 * one page.evaluate cannot be split by a frame, so taps are seen exactly once.
 */

export const DUALSENSE = "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)";
export const XBOX = "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)";

/** Runs in the page (addInitScript), before the game's scripts. */
export function installFakePad() {
  const BUTTONS = ["cross", "circle", "square", "triangle", "l1", "r1", "l2", "r2", "share", "options", "l3", "r3", "up", "down", "left", "right", "home"];
  const slots = [null, null, null, null];
  const make = (id, index) => ({
    id, index, connected: true, mapping: "standard", timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: BUTTONS.map(() => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: {
      type: "dual-rumble",
      effects: [],
      playEffect(type, params) {
        this.effects.push({ type, ...params });
        return Promise.resolve("complete");
      },
    },
  });
  Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, value: () => slots.slice() });
  globalThis.__fakePad = {
    connect(id = "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)", index = 0) {
      slots[index] = make(id, index);
    },
    disconnect(index = 0) {
      slots[index] = null;
    },
    get(index = 0) {
      return slots[index];
    },
    set(name, down, index = 0) {
      const b = slots[index].buttons[BUTTONS.indexOf(name)];
      b.pressed = !!down;
      b.value = down ? 1 : 0;
    },
    axes(lx = 0, ly = 0, rx = 0, ry = 0, index = 0) {
      slots[index].axes = [lx, ly, rx, ry];
    },
    frame(dt = 1 / 30) {
      globalThis.__dbg.pad.update(dt);
    },
    tap(name, index = 0) {
      this.set(name, true, index);
      this.frame();
      this.set(name, false, index);
      this.frame();
    },
  };
}
