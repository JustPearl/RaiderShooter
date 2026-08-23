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
  /** how much ADS bracing soaks the impulse, 0–1 — a shoulder-welded gun
      (LMG) is braced hard; a free-recoiling pistol barely is */
  adsBrace: number;
  /** how much of the recoil the shooter can actively fight down while
      aimed, 0–1. A cheek-welded semi-auto re-acquires between shots; a
      full-auto rifle just walks and the sight picture has to be dragged
      back down by hand. Scales the ADS corrections, the damping aid and
      how much the hold-sway settles behind sights. */
  adsControl: number;

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

  /* ---- organic model ---- */
  /** gas/bolt push duration, s — the slow second stage of a real shot */
  gasT: number;
  /** fraction of shove energy delivered during the gas stage */
  gasSplit: number;
  /** rifling twist bias, 0 = smoothbore, 1 = heavy rifle twist */
  twistK: number;
  /** how fast accumulated burst heat bleeds off, 1/s */
  burstRecovery: number;
  /** idle hold-sway amplitude — light guns dance, heavy guns sit */
  holdSway: number;

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
    adsBrace: 0.35,
    adsControl: 0.55, /* a sidearm re-acquires quickly between shots */
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
    gasT: 0.05,
    gasSplit: 0.3,
    twistK: 0.5,
    burstRecovery: 4.5,
    holdSway: 1.0,
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
    adsBrace: 0.5,
    adsControl: 0.55, /* semi-auto — you re-align between shells */
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
    gasT: 0.1,
    gasSplit: 0.35,
    twistK: 0,
    burstRecovery: 7,
    holdSway: 0.55,
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
    adsBrace: 0.35,
    adsControl: 0.45, /* buzzy under full auto, but the light rounds stay manageable */
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
    gasT: 0.04,
    gasSplit: 0.25,
    twistK: 0.45,
    burstRecovery: 5.5,
    holdSway: 0.7,
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
    /* re-normalized for the near-critically-damped heave. Climb halved and
       burst recovery sped up so a braced ADS burst stays on target instead
       of riding up and stacking. */
    stanceRot: 13.0,
    stancePush: 15.61,
    /* without a bipod the shoulder weld soaks less than it looks — full-auto
       7.62 still jumps, so the brace is modest... */
    adsBrace: 0.25,
    /* ...and the shooter can barely fight the climb while aimed. ADS buys
       precision for the first few rounds; after that the sight picture walks
       up and you either drag it down by hand or come off the sights. */
    adsControl: 0.12,
    yawC: 0.1458,
    rollC: 0.32,
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
    gasT: 0.06,
    gasSplit: 0.4,
    twistK: 0.7,
    burstRecovery: 5.5,
    holdSway: 0.4,
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
  pitchF: number;
  pitchFV: number;
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
  /* ---- muzzle climb: two coupled modes ----
     pitchF = the fast "crack" — frame/slide jerk, arrives in ~40 ms
     pitch  = the slow mode — gas push + arm/frame heave, rides longer */
  pitch = 0;
  pitchV = 0;
  pitchF = 0;
  pitchFV = 0;
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
  /* ---- camera followers: head/shoulder lag the gun, no overshoot ---- */
  camPitch = 0;
  camYaw = 0;
  /* ---- staged gas/bolt push (velocity injected over gasT seconds) ---- */
  private gasPitch = 0;
  private gasPush = 0;
  private gasYaw = 0;
  private gasT = 0;
  private gasT0 = 0.06;
  /* ---- burst heat: sustained fire climbs more and recovers slower ---- */
  burst = 0;
  /* ---- human hold-sway (normalized ±1, scaled by the engine) ---- */
  holdX = 0;
  holdY = 0;
  private swayT = Math.random() * 20;
  /* per-shot variance multiplier (0.85–1.45) — drives trauma/fov scaling */
  variance = 1;
  /* normalized shot energy 0–1 for lights and FX */
  energy = 0;

  /**
   * Resolve one shot in two stages — the sharp initial crack lands now, the
   * gas/bolt push bleeds in over `gasT` seconds. Returns the permanent
   * horizontal drift to bake into the player's real aim (rifling walk +
   * shooter follow-through).
   */
  fire(spec: RecoilSpec, aimAmt: number): number {
    this.variance = 0.85 + Math.random() * 0.6;
    /* bracing: a shoulder-welded gun (LMG) soaks far more impulse when
       aimed than a free-recoiling pistol does */
    const braced = 1 - spec.adsBrace * aimAmt;
    /* burst heat — the more you pour in, the harder each round climbs */
    this.burst = Math.min(1, this.burst + 0.3 * this.variance * braced);
    const J = spec.impulseNs * this.variance * braced * (1 + 0.9 * this.burst);
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
    /* staging splits energy across time, so re-normalize to keep the
       approved peaks: inv ≈ 1/(1 + half the gas fraction as extra energy) */
    const inv = 1 / (1 + 0.5 * spec.gasSplit);

    /* muzzle-rise torque: ω = J·h·climb·absorb / I, coupled by stance */
    const climb = ((J * spec.boreHeightM * spec.climbFactor * rotAbsorb) / I) * spec.stanceRot * k * inv;
    this.pitchFV += climb * 0.75; /* the crack */
    this.pitchV += climb * 0.25; /* the heave */
    this.gasPitch += climb * 0.55 * spec.gasSplit * 2.2; /* slow gas push */
    this.gasT = Math.max(this.gasT, spec.gasT);
    this.gasT0 = spec.gasT;

    /* linear shove into the body: v = J·push·absorb / M */
    const shove = ((J * spec.pushFactor * pushAbsorb) / M) * spec.stancePush * k * 1.05;
    this.pushV += shove * 0.45;
    this.gasPush += shove * 0.55;

    /* secondary axes — scale with the gun's recoil velocity J/M, biased by
       rifling twist (a rifle walks one way, a smoothbore scatters) */
    const vGun = J / M;
    const brace2 = 1 - 0.5 * aimAmt;
    const tw = spec.twistK;
    /* yaw/drift carry the rifling "walk" bias (a rifle pulls one way);
       roll is kept symmetric — twist torques the bullet, not a sustained
       barrel roll, so no bias here or heavy guns lean permanently */
    this.yawV += ((Math.random() - 0.5) * 2 * 0.6 + tw * 0.5) * vGun * spec.yawC * 8 * brace2 * k;
    this.rollV += (Math.random() - 0.5) * 2 * 0.45 * vGun * spec.rollC * 8 * brace2 * k;
    this.gasYaw += tw * 0.25 * vGun * spec.yawC * 8 * brace2 * k;
    this.dropV += vGun * spec.dropC * 4 * braced * k * (1 + 0.5 * this.burst);

    /* permanent aim drift — rifling walk + a burst-fatigued shooter */
    return ((Math.random() - 0.5) * 2 * 0.7 + tw * 0.35) * vGun * spec.driftC * 30 * k * (1 + 0.5 * this.burst);
  }

  /**
   * Advance the rig: bleed in the staged gas push, integrate every mode as a
   * damped spring, run the camera followers and the human hold-sway.
   */
  update(dt: number, spec: RecoilSpec, aimAmt: number) {
    dt = Math.min(dt, 0.05);

    /* ---- staged gas/bolt push: front-weighted decay over gasT ---- */
    if (this.gasT > 0 && this.gasT0 > 0) {
      const u = this.gasT / this.gasT0; /* 1 → 0 */
      const shape = 2 * u * (dt / this.gasT0); /* integrates to ~1 */
      this.pitchV += this.gasPitch * shape;
      this.pushV += this.gasPush * shape;
      this.yawV += this.gasYaw * shape;
      this.gasT -= dt;
      if (this.gasT <= 0) {
        this.gasPitch = 0;
        this.gasPush = 0;
        this.gasYaw = 0;
      }
    }

    /* ---- burst heat decays; while hot the springs soften so the gun
       rides higher and the climb stacks instead of resetting ---- */
    this.burst *= Math.exp(-spec.burstRecovery * dt);
    const recover = 1 - 0.5 * this.burst; /* 1 at rest → 0.5 mid-burst */

    const steps = 2;
    const h = dt / steps;
    /* a braced gun settles faster and overshoots less — but only as much as
       the shooter can actually control the gun (a walking LMG gets no aid) */
    const ctl = Math.min(1, spec.adsControl * 1.8);
    const zBoost = 0.25 * aimAmt * (0.3 + 0.7 * ctl);
    const o = this as unknown as SpringDOF;
    /* secondary axes inherit the gun's character: a pistol's yaw snap is
       twitchy and ringing, the HOG's is a slow heavy lurch */
    const yawZ = Math.min(1, spec.pitchZeta * 1.3);
    const rollZ = Math.min(1, spec.pitchZeta * 1.05);
    const dropZ = Math.min(1, spec.pitchZeta + 0.18);
    const wnSlow = spec.pitchWn * (0.8 + 0.2 * recover);
    for (let s = 0; s < steps; s++) {
      /* the crack mode: fast, springy, settles in ~2× the frame time */
      this.spring(o, "pitchF", "pitchFV", spec.pitchWn * 2.15, Math.min(0.6, spec.pitchZeta * 0.85) + zBoost, h);
      this.spring(o, "pitch", "pitchV", wnSlow, spec.pitchZeta + zBoost, h);
      this.spring(o, "push", "pushV", spec.pushWn * (0.85 + 0.15 * recover), spec.pushZeta + zBoost * 0.5, h);
      this.spring(o, "yaw", "yawV", spec.pitchWn * 1.15, yawZ + zBoost * 0.6, h);
      this.spring(o, "roll", "rollV", spec.pitchWn * 1.1, rollZ + zBoost * 0.5, h);
      this.spring(o, "drop", "dropV", spec.pitchWn * 0.8, dropZ, h);
    }

    /* ---- camera followers: your head chases the gun exponentially —
       guns overshoot, faces never do. A controllable gun tightens up behind
       sights; an uncontrollable one keeps lagging and lurching ---- */
    const kf = 14 + 12 * aimAmt * (0.3 + 0.7 * ctl);
    this.camPitch += (this.pitch + this.pitchF - this.camPitch) * (1 - Math.exp(-kf * dt));
    this.camYaw += (this.yaw - this.camYaw) * (1 - Math.exp(-kf * 0.9 * dt));

    /* ---- human hold-sway: incommensurate sines, fatter when the arms
       are pumped full of recoil, steadier behind a sight picture — but a
       full-auto rifle keeps shaking even when you're trying to hold it ---- */
    this.swayT += dt;
    const t = this.swayT;
    const amp = spec.holdSway * (0.55 + 0.9 * this.burst) * (1 - 0.7 * aimAmt * (0.35 + 0.65 * ctl));
    this.holdX = (Math.sin(t * 2.13) * 0.38 + Math.sin(t * 3.47 + 1.3) * 0.27 + Math.sin(t * 0.53 + 2.1) * 0.35) * amp;
    this.holdY = (Math.sin(t * 1.71 + 0.7) * 0.4 + Math.sin(t * 2.83 + 2.6) * 0.32 + Math.sin(t * 0.41) * 0.28) * amp;
  }

  private spring(o: SpringDOF, x: keyof SpringDOF, v: keyof SpringDOF, wn: number, zeta: number, h: number) {
    const xp = o[x];
    const vp = o[v];
    const nv = vp + (-wn * wn * xp - 2 * zeta * wn * vp) * h;
    o[v] = nv;
    o[x] = xp + nv * h;
  }

  /** Gun changed hands — kill velocities and staged pushes, let position glide. */
  softReset() {
    this.pitchV = 0;
    this.pitchFV = 0;
    this.yawV = 0;
    this.rollV = 0;
    this.pushV = 0;
    this.dropV = 0;
    this.gasPitch = 0;
    this.gasPush = 0;
    this.gasYaw = 0;
    this.gasT = 0;
    this.burst *= 0.4;
    this.camPitch = this.pitch + this.pitchF;
    this.camYaw = this.yaw;
  }

  hardReset() {
    this.pitch = 0;
    this.pitchV = 0;
    this.pitchF = 0;
    this.pitchFV = 0;
    this.yaw = 0;
    this.yawV = 0;
    this.roll = 0;
    this.rollV = 0;
    this.push = 0;
    this.pushV = 0;
    this.drop = 0;
    this.dropV = 0;
    this.camPitch = 0;
    this.camYaw = 0;
    this.gasPitch = 0;
    this.gasPush = 0;
    this.gasYaw = 0;
    this.gasT = 0;
    this.gasT0 = 0.06;
    this.burst = 0;
    this.energy = 0;
    this.variance = 1;
  }
}
