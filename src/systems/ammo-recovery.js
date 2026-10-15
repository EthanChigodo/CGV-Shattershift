/** Emergency reserve, not a supply source: recover one standard throw only. */
export const EMERGENCY_RECHARGE_SECONDS = 2.5;

export class AmmoRecovery {
  constructor() { this.reset(); }

  reset() { this.elapsed = 0; }

  /** `seconds`: how long empty before the one sphere comes back (the story's difficulty sets it). */
  update(dt, ammunition, playing = true, seconds = EMERGENCY_RECHARGE_SECONDS) {
    if (ammunition > 0) this.reset();
    if (!playing || ammunition > 0) return ammunition;
    this.elapsed += Math.max(0, dt);
    if (this.elapsed + 1e-9 < seconds) return ammunition;
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
