/* ============================================================
   Per-weapon viewmodel recoil choreography.
   Every gun gets its own character, shaped by two things:
     · its CLASS  — how heavy/snap-heavy the impulse feels
     · its OPERATION — what the mechanism visibly does
   Each shot injects energy into a set of damped springs (the
   satisfying snap → overshoot → settle) plus a muzzle-rise that
   snaps up, HANGS, then bleeds away. Full-auto guns add a chatter
   and a cumulative climb. The operating part (slide / bolt /
   carrier / pump) runs its own realistic stroke on top.
   ============================================================ */

export type Mechanism = "slide" | "openbolt" | "belt" | "pump";

export interface GunRecoilConfig {
  /** backward shove into the hand (world units) */
  kickAmp: number;
  kickW: number; // angular frequency of the kick spring
  kickD: number; // damping of the kick spring

  /** muzzle rise — snaps up, hangs, then settles (rad, peak value) */
  riseAmp: number;
  riseT: number; // seconds to reach full rise
  hangT: number; // seconds to hold at the peak
  settleT: number; // seconds to bleed back down

  /** barrel torque about the bore axis (rad) */
  rollAmp: number;
  rollW: number;
  rollD: number;

  /** vertical dip of the whole gun on heavy shots (world units) */
  dipAmp: number;

  /** sustained-fire climb added per shot, and how fast it bleeds (rad) */
  climbPerShot: number;
  climbMax: number;
  climbDecay: number;

  /** high-frequency chatter while the trigger is held (rad) */
  chatterAmp: number;
  chatterFreq: number;

  /** the visible operating mechanism */
  mech: Mechanism;
  /** seconds for one full mechanism stroke after a shot */
  mechCycle: number;
  /** how far the operating part physically travels (world units) */
  mechStroke: number;
}

/* ---------------- the four personalities ---------------- */

export const GUN_RECOIL: Record<number, GunRecoilConfig> = {
  /* P-9 SCRAPLOCK — a snappy service pistol. Short, sharp flip; the slide
     whips back and slams home with a little forward overtravel. */
  0: {
    kickAmp: 0.1, kickW: 30, kickD: 9,
    riseAmp: 0.17, riseT: 0.04, hangT: 0.08, settleT: 0.2,
    rollAmp: 0.055, rollW: 26, rollD: 8,
    dipAmp: 0.014,
    climbPerShot: 0.02, climbMax: 0.1, climbDecay: 3.2,
    chatterAmp: 0, chatterFreq: 0,
    mech: "slide", mechCycle: 0.16, mechStroke: 0.055,
  },
  /* M870 BREAKER — a heavy pump. A deep two-handed shove with a long hang,
     then the forend is racked back and slammed home: cha-chk. */
  1: {
    kickAmp: 0.21, kickW: 13, kickD: 5,
    riseAmp: 0.22, riseT: 0.055, hangT: 0.16, settleT: 0.42,
    rollAmp: 0.1, rollW: 12, rollD: 5,
    dipAmp: 0.04,
    climbPerShot: 0.03, climbMax: 0.12, climbDecay: 2.4,
    chatterAmp: 0, chatterFreq: 0,
    mech: "pump", mechCycle: 0.62, mechStroke: 0.075,
  },
  /* VK-9 WESPE — an open-bolt wire gun. Light, chattery, and it climbs fast
     under full auto; the bolt handle buzzes back and forth every round. */
  2: {
    kickAmp: 0.055, kickW: 36, kickD: 10,
    riseAmp: 0.09, riseT: 0.03, hangT: 0.05, settleT: 0.14,
    rollAmp: 0.04, rollW: 32, rollD: 9,
    dipAmp: 0.009,
    climbPerShot: 0.013, climbMax: 0.14, climbDecay: 3.4,
    chatterAmp: 0.012, chatterFreq: 24,
    mech: "openbolt", mechCycle: 0.1, mechStroke: 0.07,
  },
  /* MG-7 HOG — a belt-fed sledge. A slow massive heave that rises and HANGS,
     grinding higher shot after shot; the heavy carrier cycles with inertia. */
  3: {
    kickAmp: 0.15, kickW: 11, kickD: 4.5,
    riseAmp: 0.12, riseT: 0.045, hangT: 0.15, settleT: 0.5,
    rollAmp: 0.05, rollW: 10, rollD: 4,
    dipAmp: 0.018,
    climbPerShot: 0.026, climbMax: 0.2, climbDecay: 2.1,
    chatterAmp: 0.008, chatterFreq: 14,
    mech: "belt", mechCycle: 0.24, mechStroke: 0.1,
  },
};

/* ---------------- easing ---------------- */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const easeInCubic = (p: number) => p * p * p;
const smoothstep = (a: number, b: number, t: number) => {
  const p = clamp01((t - a) / (b - a));
  return p * p * (3 - 2 * p);
};

/* ---------------- mechanism stroke curves (0 = home, shaped per type) ---------------- */

function slideCurve(p: number): number {
  if (p < 0.22) return easeOutCubic(p / 0.22); /* snaps back */
  if (p < 0.62) return 1 - easeInOutCubic((p - 0.22) / 0.4); /* returns forward */
  if (p < 0.8) return -0.1 * Math.sin(((p - 0.62) / 0.18) * Math.PI); /* overtravel bump */
  return 0;
}

function openboltCurve(p: number): number {
  if (p >= 0.6) return 0;
  return Math.sin((p / 0.6) * Math.PI); /* one harsh buzz per round */
}

function beltCurve(p: number): number {
  if (p < 0.12) return 0; /* heavy carrier inertia */
  if (p < 0.5) return easeOutCubic((p - 0.12) / 0.38); /* drags back */
  if (p < 0.85) return 1 - easeInOutCubic((p - 0.5) / 0.35); /* drives home */
  return 0;
}

/** back-positive, with a forward overtravel slam: 0 → 1 → hold → −0.2 → 0 */
function pumpCurve(p: number): number {
  if (p < 0.18) return 0; /* recoil, forend locked */
  if (p < 0.42) return easeInOutCubic((p - 0.18) / 0.24); /* racked back */
  if (p < 0.55) return 1; /* dwell */
  if (p < 0.8) return 1 - 1.2 * easeInCubic((p - 0.55) / 0.25); /* shoved home */
  return -0.2 * (1 - easeOutCubic((p - 0.8) / 0.2)); /* settle */
}

const MECH_CURVE: Record<Mechanism, (p: number) => number> = {
  slide: slideCurve,
  openbolt: openboltCurve,
  belt: beltCurve,
  pump: pumpCurve,
};

/* ---------------- the pose handed to the engine ---------------- */

export interface GunRecoilPose {
  /** backward shove, added to viewmodel z */
  push: number;
  /** muzzle-up rotation, added to viewmodel rotation.x */
  rise: number;
  /** barrel torque, added to viewmodel rotation.z */
  roll: number;
  /** vertical dip, subtracted from viewmodel y */
  dip: number;
  /** operating-part displacement along z (+ = toward shooter) */
  mech: number;
}

export class GunRecoilDriver {
  private cfg: GunRecoilConfig;
  private t = 1e3; // seconds since last shot — start fully settled
  private climb = 0;
  private hot = 0; // 1 right after a shot, decays — drives chatter
  private rollSign = 1;
  private kickVar = 1;
  private firedBack = false;
  private firedHome = false;
  /** called as the mechanism crosses its two audible beats (pump only) */
  onMech: ((beat: "back" | "home") => void) | null = null;

  constructor(cfg: GunRecoilConfig) {
    this.cfg = cfg;
  }

  fire() {
    this.t = 0;
    this.climb = Math.min(this.cfg.climbMax, this.climb + this.cfg.climbPerShot);
    this.hot = 1;
    this.rollSign = Math.random() < 0.5 ? -1 : 1;
    this.kickVar = 0.85 + Math.random() * 0.3; // per-shot character
    this.firedBack = false;
    this.firedHome = false;
  }

  update(dt: number) {
    this.t += dt;
    this.climb *= Math.exp(-this.cfg.climbDecay * dt);
    this.hot = Math.max(0, this.hot - dt * 3.2);

    /* pump beats — the "cha" as it racks back, the "chk" as it slams home */
    if (this.cfg.mech === "pump" && this.onMech && this.t < this.cfg.mechCycle) {
      const p = this.t / this.cfg.mechCycle;
      if (!this.firedBack && p >= 0.3) {
        this.firedBack = true;
        this.onMech("back");
      }
      if (!this.firedHome && p >= 0.62) {
        this.firedHome = true;
        this.onMech("home");
      }
    }
  }

  pose(): GunRecoilPose {
    const c = this.cfg;
    const t = this.t;
    const kv = this.kickVar;

    /* damped-spring impulse: snap → overshoot → settle */
    const osc = (amp: number, w: number, d: number) => amp * kv * Math.exp(-d * t) * Math.sin(w * t);
    const push = osc(c.kickAmp, c.kickW, c.kickD);
    const roll = osc(c.rollAmp, c.rollW, c.rollD) * this.rollSign;
    const dip = osc(c.dipAmp, c.kickW * 0.9, c.kickD * 1.1);

    /* muzzle rise: snap up, hang at the peak, bleed away — plus climb */
    const riseCurve = smoothstep(0, c.riseT, t) * (1 - smoothstep(c.riseT + c.hangT, c.riseT + c.hangT + c.settleT, t));
    const rise = c.riseAmp * kv * riseCurve + this.climb;

    /* full-auto chatter while the gun is still hot */
    const chatter = c.chatterAmp * this.hot * Math.sin(t * c.chatterFreq * Math.PI * 2);

    /* operating mechanism stroke */
    const mp = clamp01(t / c.mechCycle);
    const mech = MECH_CURVE[c.mech](mp) * c.mechStroke;

    return { push, rise: rise + chatter, roll, dip, mech };
  }

  /** fully settle the gun (used when the weapon is holstered / swapped away) */
  settle() {
    this.t = 1e3;
    this.climb = 0;
    this.hot = 0;
  }
}
