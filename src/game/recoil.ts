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

  /* spring tuning per degree of freedom */
  pitchWn: number;
  pitchZeta: number;
  pushWn: number;
  pushZeta: number;

  contacts: ContactPoint[];
}

export const RECOIL_SPECS: RecoilSpec[] = [
  {
    id: "P-9",
    caliber: "9×19mm PARA",
    massKg: 0.95,
    radiusGyrationM: 0.14,
    boreHeightM: 0.035,
    impulseNs: 3.2,
    climbFactor: 0.75,
    pushFactor: 0.25,
    stanceRot: 0.887,
    stancePush: 1.076,
    yawC: 0.000371,
    rollC: 0.000247,
    driftC: 0.0000445,
    dropC: 0.000891,
    traumaGain: 0.08,
    fovGain: 1.2,
    pitchWn: 13,
    pitchZeta: 0.5,
    pushWn: 11,
    pushZeta: 0.8,
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
    stanceRot: 1.353,
    stancePush: 0.441,
    yawC: 0.000719,
    rollC: 0.00048,
    driftC: 0.0000785,
    dropC: 0.003269,
    traumaGain: 0.26,
    fovGain: 5.0,
    pitchWn: 12,
    pitchZeta: 0.55,
    pushWn: 10,
    pushZeta: 0.85,
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
    stanceRot: 8.488,
    stancePush: 0.972,
    yawC: 0.000833,
    rollC: 0.000556,
    driftC: 0.0000556,
    dropC: 0.001111,
    traumaGain: 0.05,
    fovGain: 0.5,
    pitchWn: 14,
    pitchZeta: 0.48,
    pushWn: 12,
    pushZeta: 0.75,
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
    stanceRot: 30.94,
    stancePush: 2.488,
    yawC: 0.001313,
    rollC: 0.000875,
    driftC: 0.0000875,
    dropC: 0.009844,
    traumaGain: 0.12,
    fovGain: 1.0,
    pitchWn: 12.5,
    pitchZeta: 0.62,
    pushWn: 9,
    pushZeta: 0.9,
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

    /* muzzle-rise torque: ω = J·h·climb·absorb / I, coupled by stance */
    this.pitchV += ((J * spec.boreHeightM * spec.climbFactor * rotAbsorb) / I) * spec.stanceRot;
    /* linear shove into the body: v = J·push·absorb / M */
    this.pushV += ((J * spec.pushFactor * pushAbsorb) / M) * spec.stancePush;

    /* secondary axes — scale with the gun's own recoil velocity J/M */
    const vGun = J / M;
    const brace2 = 1 - 0.5 * aimAmt;
    this.yawV += (Math.random() - 0.5) * 2 * vGun * spec.yawC * 8 * brace2;
    this.rollV += (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5) * vGun * spec.rollC * 8 * brace2;
    this.dropV += vGun * spec.dropC * 4 * braced;

    /* permanent aim drift */
    return (Math.random() - 0.5) * 2 * vGun * spec.driftC * 30;
  }

  /** Integrate every DOF as a damped spring back to rest. */
  update(dt: number, spec: RecoilSpec, aimAmt: number) {
    dt = Math.min(dt, 0.05);
    const steps = 2;
    const h = dt / steps;
    /* a braced gun settles faster and overshoots less */
    const zBoost = 0.25 * aimAmt;
    const o = this as unknown as SpringDOF;
    for (let s = 0; s < steps; s++) {
      this.spring(o, "pitch", "pitchV", spec.pitchWn, spec.pitchZeta + zBoost, h);
      this.spring(o, "push", "pushV", spec.pushWn, spec.pushZeta + zBoost * 0.5, h);
      this.spring(o, "yaw", "yawV", 16, 0.7, h);
      this.spring(o, "roll", "rollV", 15, 0.6, h);
      this.spring(o, "drop", "dropV", 10, 0.8, h);
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
