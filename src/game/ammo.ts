/* ============================================================
   Ammunition database — real ballistics in, combat stats out.

   Every cartridge carries its real load: projectile weight,
   reference muzzle velocity, the barrel it was clocked from and
   how much speed the powder still has left per inch of barrel.
   Damage keeps the barrel-physics truth (kinetic energy ∝ v²)
   but compresses real muzzle energy with a 0.4-power curve —
   the compromise between arcade-flat and full-realism, so the
   rifle dominates without vaporizing the room.

   The other three combat stats are physics too:
   · PIERCE  — sectional density decides what gets through scrap
     plating. Slow heavy .45 pushes poorly; the 7.62 goes through.
   · STAGGER — momentum (grain × velocity) decides impact. The
     .45 shoves hardest of the handguns; a rifle round lands like
     a hammer; each buck pellet nudges, but eight arrive at once.
   · FALLOFF — real effective range shapes the retention curve:
     smoothbore dies past a few metres, rifle stays flat across
     the whole arena.
   ============================================================ */

import type { FalloffSpec } from "./damage";

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

  /* ---- combat stats (E^0.4 compression of real energy) ---- */
  /** stopping power at the reference barrel — base damage per projectile */
  baseDamage: number;
  /** plating penetration — armor points this round ignores */
  pierce: number;
  /** impact value — drives hitstun and poise breaks */
  stagger: number;
  /** headshot multiplier — precision calibers pay more for aimed shots */
  headMul: number;
  /** damage retention over distance */
  falloff: FalloffSpec;

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
    /* 350 J on the 0.4-power curve. Slow and heavy: the best headshot
       reward of the handguns, the worst answer to scrap plating. */
    baseDamage: 23,
    pierce: 2,
    stagger: 7,
    headMul: 2.5,
    falloff: { full: 8, floor: 20, min: 0.5 },
    knockback: 1.6,
    ragdollForce: 6,
    flashScale: 0.62,
    tracer: "#ffe8b0",
    note: "SLOW · HEAVY · PRECISION-WEIGHTED",
  },
  para9: {
    id: "para9",
    designation: "9×19 PARA",
    projectileGr: 124,
    referenceVelFps: 1150,
    referenceBarrelIn: 4.7, /* SAAMI reference barrel */
    velGainPerIn: 26,
    energyJ: 519,
    /* 519 J — the all-rounder: highest small-arms velocity here, so it
       stretches to a 12 m envelope and chews light plating. */
    baseDamage: 26,
    pierce: 5,
    stagger: 5,
    headMul: 2.0,
    falloff: { full: 12, floor: 25, min: 0.55 },
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
    /* 310 J per pellet, delivered eight at a time. Devastating inside
       6 m — a rounding error past 15. Armor eats each pellet separately. */
    baseDamage: 18,
    pierce: 2,
    stagger: 2, /* per pellet — a full blast lands 16+ and breaks poise */
    headMul: 2.0,
    falloff: { full: 6, floor: 15, min: 0.35 },
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
    /* 3304 J — the hardest-hitting projectile in the game (~1.8× the .45
       on the curve, not the raw 9.4×). Flat across the arena, and its
       sectional density ignores brute plating outright. */
    baseDamage: 42,
    pierce: 16,
    stagger: 14,
    headMul: 1.5,
    falloff: { full: 20, floor: 35, min: 0.85 },
    knockback: 5.0,
    ragdollForce: 16,
    flashScale: 0.8,
    tracer: "#ffb45e",
    note: "RIFLE ENERGY · PLATE-BREAKER",
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
