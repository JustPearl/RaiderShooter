/* ============================================================
   Ammunition database.
   Every cartridge carries its real ballistic card: projectile
   weight, reference muzzle velocity, the barrel that velocity
   was measured from, and how much speed the powder still has
   left to give per extra inch of barrel. Damage is not a magic
   number — it is the round's stopping power at its reference
   barrel, scaled by the kinetic-energy ratio (E ∝ v²) at the
   length of barrel actually fitted to the gun. Longer barrel,
   more complete powder burn, more speed, more damage.

   Base damage follows real muzzle energy on a FLATTENED curve —
   the fourth root (E^0.25) — so the ordering and direction of
   real ballistics are preserved while arcade numbers stay sane:
   the 7.62's raw ~9.4× energy advantage over the .45 lands at
   ~1.8× in-game. No projectile one-shots anything; the rifle's
   edge is per-shot punch within a sustainable burst, not instakill.
   ============================================================ */

export type AmmoId = "acp45" | "para9" | "buck12" | "nato762";

export interface AmmoSpec {
  id: AmmoId;
  /** marketing designation, shown on the HUD */
  designation: string;
  /** projectile weight, grains (per pellet for shot loads) */
  projectileGr: number;
  /** muzzle velocity of the reference load, fps */
  referenceVelFps: number;
  /** barrel length the reference velocity was clocked from, inches */
  referenceBarrelIn: number;
  /** velocity gained per additional inch of barrel, fps/in */
  velGainPerIn: number;
  /** muzzle energy of the reference load, joules */
  energyJ: number;
  /** stopping power at the reference barrel — base damage */
  baseDamage: number;
  /** shove imparted to whatever it hits (game knockback units) */
  knockback: number;
  /** how hard the hit throws a ragdoll */
  ragdollForce: number;
  /** muzzle-flash size multiplier */
  flashScale: number;
  /** tracer color */
  tracer: string;
  /** range-book flavor line */
  note: string;
}

export const AMMO: Record<AmmoId, AmmoSpec> = {
  acp45: {
    id: "acp45",
    designation: ".45 ACP",
    projectileGr: 230,
    referenceVelFps: 830,
    referenceBarrelIn: 5.0,
    velGainPerIn: 12, /* fast-burning pistol powder — little left to give */
    energyJ: 350,
    /* 350 J — the weakest projectile on the curve, as reality dictates.
       Its trade is a bottomless reserve: volume over punch. */
    baseDamage: 18,
    knockback: 1.6,
    ragdollForce: 6,
    flashScale: 0.62,
    tracer: "#ffe8b0",
    note: "SLOW · HEAVY · HITS LIKE A DOOR",
  },
  para9: {
    id: "para9",
    designation: "9×19 PARA",
    projectileGr: 124,
    referenceVelFps: 1150,
    referenceBarrelIn: 4.7, /* SAAMI reference barrel */
    velGainPerIn: 26,
    energyJ: 519,
    /* 519 J — a touch above the .45 per projectile. Its real edge is
       rate of fire and a long barrel that wrings +26 fps per inch. */
    baseDamage: 20,
    knockback: 1.2,
    ragdollForce: 5,
    flashScale: 0.46,
    tracer: "#ffe08f",
    note: "FAST · FLAT · ECONOMICAL",
  },
  buck12: {
    id: "buck12",
    designation: "12 GA 00 BUCK",
    projectileGr: 54, /* per pellet */
    referenceVelFps: 1200,
    referenceBarrelIn: 18.0,
    velGainPerIn: 20,
    energyJ: 310, /* per pellet */
    /* 310 J per pellet — under the .45 per shot, matching real energy.
       Eight of them landing at once is what makes it hurt. */
    baseDamage: 17,
    knockback: 2.5, /* per pellet — eight hits stack into a real shove */
    ragdollForce: 4,
    flashScale: 1.0,
    tracer: "#ffc37e",
    note: "NINE CHANCES PER TRIGGER",
  },
  nato762: {
    id: "nato762",
    designation: "7.62×51 NATO",
    projectileGr: 147,
    referenceVelFps: 2750,
    referenceBarrelIn: 20.0, /* M80 ball, 20" test barrel */
    velGainPerIn: 40, /* slow rifle powder — long barrels earn real speed */
    energyJ: 3304,
    /* 3304 J — still the hardest-hitting projectile (~1.8× the .45 on the
       flattened fourth-root curve, not the raw 9.4×). Strong enough that a
       burst shreds, never enough to one-shot. Its real costs are the
       scarce reserve, the 2.6s belt swap and 85% move speed. */
    baseDamage: 32,
    knockback: 5.0,
    ragdollForce: 16,
    flashScale: 0.8,
    tracer: "#ffb45e",
    note: "RIFLE ENERGY · MACHINE-GUN VOLUME",
  },
};

/** Muzzle velocity of a load out of a specific barrel length, fps. */
export function muzzleVelocity(a: AmmoSpec, barrelIn: number): number {
  return a.referenceVelFps + a.velGainPerIn * (barrelIn - a.referenceBarrelIn);
}

/**
 * Effective damage at a given barrel length.
 * Kinetic energy scales with v², so a round clocked faster out of a
 * longer barrel hits proportionally harder than its reference load.
 */
export function effectiveDamage(a: AmmoSpec, barrelIn: number): number {
  const v = muzzleVelocity(a, barrelIn);
  const ratio = v / a.referenceVelFps;
  return a.baseDamage * ratio * ratio;
}
