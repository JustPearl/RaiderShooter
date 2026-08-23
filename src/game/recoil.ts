/* ============================================================
   Data-driven recoil simulation.
   Each weapon carries real ballistic/mechanical specs — caliber,
   gun mass, radius of gyration, bore axis height, muzzle impulse
   and its contact points with the body (shoulder, cheek, hands).
   On every shot the rig solves conservation of momentum for the
   linear shove and J·h / I for the muzzle-rise torque, splits the
   energy between rotation and translation by how the contact
   points anchor the gun, then integrates under-damped springs so
   the gun kicks and settles back on its own. Nothing here is
   keyed to weapon indices — edit the table and the feel follows.
   The stance* constants are derived per gun so each spec lands on
   a hand-tuned peak: stanceRot solves ω0 = J·h·climb·stanceRot/I.
   ============================================================ */

export interface ContactPoint {
  name: string;
  /** anchor stiffness, 0–1 — how firmly this point couples gun to body */
  stiffness: number;
  /** is this a shoulder/stock anchor? (bleeds muzzle climb, adds push-back) */
  shoulder: boolean;
}

export interface RecoilSpec {
  id: string;
  caliber: string;
  /** weapon mass, kg */
  massKg: number;
  /** radius of gyration about the pivot, m */
  radiusGyrationM: number;
  /** bore axis height above the pivot line, m — the climb lever arm */
  boreHeightM: number;
  /** nominal muzzle impulse, N·s (bullet + powder gas momentum) */
  impulseNs: number;

  /* free-recoil energy split before contact absorption */
  climbFactor: number;
  pushFactor: number;

  /* shooter-stance coupling (calibrated per gun to a target peak) */
  stanceRot: number;
  stancePush: number;

  /* secondary axes couple linearly with the gun's recoil velocity J/M */
  yawC: number;
  rollC: number;
  driftC: number;
  dropC: number;

  traumaGain: number;
  fovGain: number;

  /* spring tuning per degree of freedom.
     Rule of thumb baked into the tables: light guns get a HIGH natural
     frequency and LOW damping ratio — they snap up fast and ring with
     visible overshoot; heavy guns get a LOW frequency and HIGH damping —
     they heave slowly and settle dead, no bounce. */
  pitchWn: number;
  pitchZeta: number;
  pushWn: number;
  pushZeta: number;

  /* how the whole gun hangs in the hands — light = lively & springy,
     heavy = damped & inertial (drives the viewmodel mouse-sway spring) */
  swayStiff: number;
  swayDamp: number;

  contacts: ContactPoint[];
}

export const RECOIL_SPECS: RecoilSpec[] = [
  {
    id: "P-9",
    caliber: ".45 ACP",
    massKg: 0.95,
    radiusGyrationM: 0.14,
    boreHeightM: 0.035,
    /* 230 gr @ 830 fps + powder gas ≈ 4.3 N·s of momentum */
    impulseNs: 4.3,
    climbFactor: 0.75,
    pushFactor: 0.25,
    /* targets: 3.5° climb, 0.07 shove, ±0.004 yaw snap, ±0.02 roll, ±0.0025 drift, 0.025 dip
       (J-proportional constants re-scaled ×3.2/4.3 for the .45 impulse) */
    /* impulse constants re-normalized ×P(ζ)/ωn so the fast underdamped
       springs land on the exact same peaks as the old tuning */
    stanceRot: 0.866,
    stancePush: 8.83,
    yawC: 0.0297,
    rollC: 0.1099,
    driftC: 0.0000184,
    dropC: 0.1139,
    traumaGain: 0.08,
    fovGain: 1.2,
    /* featherweight sidearm: whips up in ~40 ms and rings ~30% past rest */
    pitchWn: 19,
    pitchZeta: 0.34,
    pushWn: 16,
    pushZeta: 0.34,
    swayStiff: 92,
    swayDamp: 8.5,
    /* one hand under the bore — everything becomes muzzle flip */
    contacts: [
      { name: "wrist", stiffness: 0.8, shoulder: false },
      { name: "palm", stiffness: 0.5, shoulder: false },
    ],
  },
  {
    id: "M870",
    caliber: "12 GA 2¾",
    massKg: 3.4,
    radiusGyrationM: 0.16,
    boreHeightM: 0.055,
    impulseNs: 13.0,
    climbFactor: 0.5,
    pushFactor: 0.8,
    /* targets: 8° climb, 0.23 shove, ±0.012 yaw snap, ±0.05 roll, ±0.006 drift, 0.075 dip */
    /* re-normalized for the slow heavily-damped springs */
    stanceRot: 3.335,
    stancePush: 3.851,
    yawC: 0.0828,
    rollC: 0.2329,
    driftC: 0.0000523,
    dropC: 0.2894,
    traumaGain: 0.26,
    fovGain: 5.0,
    /* 3.4 kg of steel on a stock: heaves up over ~160 ms and settles dead,
       barely 1–2% overshoot — mass eats the bounce */
    pitchWn: 9.5,
    pitchZeta: 0.8,
    pushWn: 8,
    pushZeta: 0.85,
    swayStiff: 52,
    swayDamp: 17,
    /* stock in the shoulder anchors the rear — a heavy shove with real roll */
    contacts: [
      { name: "shoulder", stiffness: 0.7, shoulder: true },
      { name: "cheek", stiffness: 0.3, shoulder: true },
      { name: "support hand", stiffness: 0.6, shoulder: false },
    ],
  },
  {
    id: "VK-9",
    caliber: "9×19mm PARA",
    massKg: 3.0,
    radiusGyrationM: 0.1,
    boreHeightM: 0.018,
    impulseNs: 2.7,
    climbFactor: 0.4,
    pushFactor: 0.4,
    /* targets: 1.6° climb, 0.06 shove, ±0.003 yaw snap, ±0.015 roll, ±0.0012 drift, 0.012 dip */
    /* re-normalized for the snappy light springs */
    stanceRot: 3.105,
    stancePush: 21.78,
    yawC: 0.1018,
    rollC: 0.3486,
    driftC: 0.0000444,
    dropC: 0.2437,
    traumaGain: 0.05,
    fovGain: 0.5,
    /* light two-hander: snaps in ~50 ms, ~25% overshoot — a nervous buzz
       under full auto, never a smooth ride */
    pitchWn: 16,
    pitchZeta: 0.4,
    pushWn: 14,
    pushZeta: 0.38,
    swayStiff: 85,
    swayDamp: 9.5,
    /* grip-mass design: bore nearly in line with the hands — a light buzz */
    contacts: [
      { name: "grip hand", stiffness: 0.65, shoulder: false },
      { name: "support hand", stiffness: 0.6, shoulder: false },
    ],
  },
  {
    id: "MG-7",
    caliber: "7.62×51mm NATO",
    massKg: 10.5,
    radiusGyrationM: 0.2,
    boreHeightM: 0.065,
    impulseNs: 8.0,
    climbFactor: 0.15,
    pushFactor: 0.95,
    /* targets: 1.7° climb, 0.21 shove, ±0.005 yaw snap, ±0.025 roll, ±0.002 drift, 0.02 dip */
    /* re-normalized for the near-critically-damped heave */
    stanceRot: 24.63,
    stancePush: 15.61,
    yawC: 0.1458,
    rollC: 0.5312,
    driftC: 0.0000875,
    dropC: 0.3314,
    traumaGain: 0.12,
    fovGain: 1.0,
    /* 10.5 kg near critical damping: a slow ~200 ms heave with zero bounce —
       the shove just arrives, heavy and final, then grinds to rest */
    pitchWn: 8,
    pitchZeta: 0.9,
    pushWn: 7.5,
    pushZeta: 0.95,
    swayStiff: 42,
    swayDamp: 20,
    /* bedded into the shoulder with a cheek weld — energy goes straight
       back into the body, the muzzle barely levers up */
    contacts: [
      { name: "shoulder", stiffness: 0.95, shoulder: true },
      { name: "cheek", stiffness: 0.4, shoulder: true },
      { name: "support hand", stiffness: 0.55, shoulder: false },
    ],
  },
];

/* ---------------- the simulated gun ---------------- */

/**
 * Global recoil intensity — scales every impulse the rig emits
 * (climb, shove, yaw snap, roll, dip, aim drift). 1 = full physical
 * solution, 1/3 = tuned-down arcade-real feel.
 */
export const RECOIL_INTENSITY = 1 / 3;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type SpringDOF = {
  pitch: number;
  pitchV: number;
  push: number;
  pushV: number;
  yaw: number;
  yawV: number;
  roll: number;
  rollV: number;
  drop: number;
  dropV: number;
};

export class RecoilRig {
  /* muzzle climb about the pivot (rad) + velocity */
  pitch = 0;
  pitchV = 0;
  /* recoverable horizontal snap + barrel torque about the bore axis */
  yaw = 0;
  yawV = 0;
  roll = 0;
  rollV = 0;
  /* straight-back shove into the shoulder (world units) */
  push = 0;
  pushV = 0;
  /* sight-picture dip under heavy shots */
  drop = 0;
  dropV = 0;
  /* per-shot variance multiplier (0.85–1.45) — drives trauma/fov scaling */
  variance = 1;
  /* normalized shot energy 0–1 for lights and FX */
  energy = 0;

  /**
   * Resolve one shot. Returns the permanent horizontal drift to bake into
   * the player's real aim (asymmetric gas exit + shooter follow-through).
   */
  fire(spec: RecoilSpec, aimAmt: number): number {
    this.variance = 0.85 + Math.random() * 0.6;
    /* bracing: a braced weld soaks impulse before it moves anything */
    const braced = 1 - 0.35 * aimAmt;
    const J = spec.impulseNs * this.variance * braced;
    this.energy = clamp(J / 13, 0, 1.4);

    /* ---- contact-point absorption ---- */
    let shoulderK = 0;
    let handK = 0;
    for (const c of spec.contacts) {
      if (c.shoulder) shoulderK += c.stiffness;
      else handK += c.stiffness;
    }
    const shoulderNorm = shoulderK / (shoulderK + handK + 1e-6);
    /* shoulder anchors bleed muzzle climb and turn energy into push-back */
    const rotAbsorb = 1 - 0.55 * shoulderNorm;
    const pushAbsorb = 0.3 + 0.7 * shoulderNorm;

    const M = spec.massKg;
    const I = M * spec.radiusGyrationM * spec.radiusGyrationM;

    const k = RECOIL_INTENSITY;
    /* muzzle-rise torque: ω = J·h·climb·absorb / I, coupled by stance */
    this.pitchV += ((J * spec.boreHeightM * spec.climbFactor * rotAbsorb) / I) * spec.stanceRot * k;
    /* linear shove into the body: v = J·push·absorb / M */
    this.pushV += ((J * spec.pushFactor * pushAbsorb) / M) * spec.stancePush * k;

    /* secondary axes — scale with the gun's own recoil velocity J/M */
    const vGun = J / M;
    const brace2 = 1 - 0.5 * aimAmt;
    this.yawV += (Math.random() - 0.5) * 2 * vGun * spec.yawC * 8 * brace2 * k;
    this.rollV += (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5) * vGun * spec.rollC * 8 * brace2 * k;
    this.dropV += vGun * spec.dropC * 4 * braced * k;

    /* permanent aim drift */
    return (Math.random() - 0.5) * 2 * vGun * spec.driftC * 30 * k;
  }

  /** Integrate every DOF as a damped spring back to rest. */
  update(dt: number, spec: RecoilSpec, aimAmt: number) {
    dt = Math.min(dt, 0.05);
    const steps = 2;
    const h = dt / steps;
    /* a braced gun settles faster and overshoots less */
    const zBoost = 0.25 * aimAmt;
    const o = this as unknown as SpringDOF;
    /* secondary axes inherit the gun's character: a pistol's yaw snap is
       twitchy and ringing, the HOG's is a slow heavy lurch */
    const yawZ = Math.min(1, spec.pitchZeta * 1.3);
    const rollZ = Math.min(1, spec.pitchZeta * 1.05);
    const dropZ = Math.min(1, spec.pitchZeta + 0.18);
    for (let s = 0; s < steps; s++) {
      this.spring(o, "pitch", "pitchV", spec.pitchWn, spec.pitchZeta + zBoost, h);
      this.spring(o, "push", "pushV", spec.pushWn, spec.pushZeta + zBoost * 0.5, h);
      this.spring(o, "yaw", "yawV", spec.pitchWn * 1.15, yawZ + zBoost * 0.6, h);
      this.spring(o, "roll", "rollV", spec.pitchWn * 1.1, rollZ + zBoost * 0.5, h);
      this.spring(o, "drop", "dropV", spec.pitchWn * 0.8, dropZ, h);
    }
  }

  private spring(o: SpringDOF, x: keyof SpringDOF, v: keyof SpringDOF, wn: number, zeta: number, h: number) {
    const xp = o[x];
    const vp = o[v];
    const nv = vp + (-wn * wn * xp - 2 * zeta * wn * vp) * h;
    o[v] = nv;
    o[x] = xp + nv * h;
  }

  /** Gun changed hands — kill velocities, let position glide to rest. */
  softReset() {
    this.pitchV = 0;
    this.yawV = 0;
    this.rollV = 0;
    this.pushV = 0;
    this.dropV = 0;
  }

  hardReset() {
    this.pitch = 0;
    this.pitchV = 0;
    this.yaw = 0;
    this.yawV = 0;
    this.roll = 0;
    this.rollV = 0;
    this.push = 0;
    this.pushV = 0;
    this.drop = 0;
    this.dropV = 0;
    this.energy = 0;
    this.variance = 1;
  }
}
