/** Emergency reserve, not a supply source: recover one standard throw only. */
export const EMERGENCY_RECHARGE_SECONDS = 2.5;

export class AmmoRecovery {
  constructor() { this.reset(); }

  reset() { this.elapsed = 0; }

  update(dt, ammunition, playing = true) {
    if (ammunition > 0) this.reset();
    if (!playing || ammunition > 0) return ammunition;
    this.elapsed += Math.max(0, dt);
    if (this.elapsed + 1e-9 < EMERGENCY_RECHARGE_SECONDS) return ammunition;
    this.reset();
    // Never bank time or award multiple rounds after a long frame.
    return 1;
  }
}

export function canAffordThrow(ammunition, cost) {
  return cost === 0 || ammunition >= cost;
}

/** Keep the gate's aiming challenge, but exclude time spent unable to throw. */
export function gateRecoveryWaiting(ammunition, cost, sealed, open) {
  return sealed && !open && ammunition < 1 && cost > 0;
}
