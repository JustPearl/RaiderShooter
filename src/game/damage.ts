/* ============================================================
   Combat damage model.
   Real ballistics (ammo.ts) decide how hard a load CAN hit;
   this module decides how that translates into a kill on the
   foundry floor. Four ideas:

   1. ZONES — a shot's height on the body matters. Headshots
      pay the cartridge's headMul, leg shots only 70%. Aiming is
      a skill axis, not a coin flip.

   2. FALLOFF — every cartridge keeps full damage out to its real
      effective range, then bleeds to a floor. Shotguns fall off
      a cliff past 6 m; a rifle is flat across the whole arena.
      This is what gives each gun an honest engagement envelope.

   3. PLATING — brutes wear scrap armor that soaks a fixed amount
      per hit. Small calibers scratch it; 7.62 punches straight
      through; a point-blank blast stacks eight pellets against it.
      Weapon choice against heavies becomes a decision.

   4. POISE — impacts carry stagger. Enough stagger in one moment
      breaks a brute's windup or charge and leaves it reeling.
      The shotgun is a parry, not just a panic button.
   ============================================================ */

export type HitZone = "head" | "torso" | "limb";

/** leg shots hurt less — the plates and muscle up top are the prize */
export const LIMB_MUL = 0.7;

/** a hit lands above this fraction of body height to count as a headshot */
export const HEAD_BAND = 0.81;
/** ...and below this fraction it counts as a limb hit */
export const LIMB_BAND = 0.45;

/** resolve the zone from the impact height relative to enemy size */
export function resolveZone(relHeight: number): HitZone {
  if (relHeight > HEAD_BAND) return "head";
  if (relHeight < LIMB_BAND) return "limb";
  return "torso";
}

export function zoneMultiplier(zone: HitZone, headMul: number): number {
  return zone === "head" ? headMul : zone === "limb" ? LIMB_MUL : 1;
}

/* ---------------- distance falloff ---------------- */

export interface FalloffSpec {
  /** full damage out to this many metres */
  full: number;
  /** damage decays linearly to the floor at this distance */
  floor: number;
  /** retention at the floor distance, 0–1 */
  min: number;
}

/** piecewise-linear retention curve: 1.0 → min between full and floor */
export function falloff(f: FalloffSpec, dist: number): number {
  if (dist <= f.full) return 1;
  if (dist >= f.floor) return f.min;
  const t = (dist - f.full) / (f.floor - f.full);
  return 1 - (1 - f.min) * t;
}

/* ---------------- armor ---------------- */

/** per-hit soak: damage is reduced by whatever armor outranks the round */
export function afterArmor(dmg: number, armor: number, pierce: number): { dealt: number; absorbed: number } {
  const soak = Math.max(0, armor - pierce);
  const dealt = Math.max(1, dmg - soak);
  return { dealt, absorbed: Math.max(0, Math.min(soak, dmg - 1)) };
}

/* ---------------- poise / stagger ---------------- */

/** how much one-frame stagger is needed to break a telegraphed attack */
export const INTERRUPT_STAGGER = 10;

/** per-hit stun, scaling with the round's impact — capped so nothing freezes */
export function hitstunFrom(stagger: number): number {
  return Math.min(0.3, 0.06 + stagger * 0.02);
}

/** stagger needed to crack a brute's composure and send it reeling */
export const BRUTE_POISE = 30;
