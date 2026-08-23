/* ============================================================
   Data-driven physical recoil.
   Each weapon carries real specs (caliber, muzzle energy, mass,
   bore-axis height, operating mechanism) plus simulated body
   contact points (grip, stock, shoulder, cheek, forend). The gun
   is integrated as a linearized rigid body: a shot deposits
   rearward momentum + a muzzle-climb torque (impulse x bore axis),
   and the contact springs/dampers absorb and return it.
     - pistol  : one weak grip contact, high bore axis -> snaps & flips
     - shotgun : shoulder contact -> heavy backward drive, less flip
     - SMG     : light stock contact -> fast chattering climb
     - MG      : deep shoulder pocket + low bore -> beds in & shudders,
                 almost no muzzle flip, strong rearward shove
   Gun-local axes: +x right, +y up, +z REARWARD (toward the shooter).
   Rotations: x = pitch (muzzle up), y = yaw, z = roll.
   ============================================================ */

export interface ContactPoint {
  name: string;
  /* offset from centre of mass: x right, y up, z rearward (+ toward body) */
  offset: [number, number, number];
  /* per-axis spring stiffness [x,y,z] (N/m); 0 = free on that axis */
  k: [number, number, number];
  /* per-axis damping [x,y,z] (N·s/m) */
  c: [number, number, number];
}

export interface WeaponPhysics {
  id: string;
  caliberMm: number;
  muzzleEnergyJ: number;
  muzzleVelocity: number; /* m/s */
  massKg: number;
  barrelLenM: number;
  boreAxisM: number; /* bore height above the pivot -> muzzle-climb lever */
  mechanism: number; /* 0..1 impulse soaked by the action (gas / blowback) */
  viewGain: number; /* metres/radians -> viewmodel & camera units */
  contacts: ContactPoint[];
}

export interface RecoilPose {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
}

const GAS_FACTOR = 1.35; /* propellant gas adds ~35% to bare momentum */
const LINEAR_GAIN = 0.06; /* m/s of shove per unit (kg·m/s)/kg */
const TORQUE_GAIN = 0.03; /* rad/s of climb per unit torque/inertia */

export class RecoilRig {
  private px = 0; private py = 0; private pz = 0;
  private rx = 0; private ry = 0; private rz = 0; /* pitch, yaw, roll */
  private vx = 0; private vy = 0; private vz = 0;
  private wx = 0; private wy = 0; private wz = 0;

  private spec: WeaponPhysics;
  private iP!: number; private iY!: number; private iR!: number;

  constructor(spec: WeaponPhysics) {
    this.spec = spec;
    this.computeInertia();
  }

  private computeInertia() {
    const m = this.spec.massKg;
    const L = this.spec.barrelLenM;
    this.iP = (m * L * L) / 3; /* pitch, rod about the rear pivot */
    this.iY = this.iP * 1.4; /* yaw */
    this.iR = this.iP * 0.5; /* roll */
  }

  retarget(spec: WeaponPhysics) {
    this.spec = spec;
    this.computeInertia();
  }

  /** Deposit one shot. `aim` braces the hold, `variance` is per-shot power. */
  fire(aim: number, variance: number) {
    const s = this.spec;
    let p = (s.muzzleEnergyJ / s.muzzleVelocity) * GAS_FACTOR;
    p *= 1 - s.mechanism * 0.35;
    p *= variance;
    p *= 1 - 0.25 * aim;

    /* rearward shove along the bore (+z toward shooter) */
    this.vz += (p / s.massKg) * LINEAR_GAIN;
    /* muzzle-climb torque = p * boreAxis, about the pitch axis */
    this.wx += (p * s.boreAxisM / this.iP) * TORQUE_GAIN * 40;
    /* shot-to-shot asymmetry: lateral drift + roll (heavy guns wander less) */
    const asym = (Math.random() - 0.5) * 2;
    const wander = 0.5 / Math.sqrt(s.massKg);
    this.wy += asym * 0.06 * wander * 8;
    this.wz += asym * 0.05 * wander * 8;
    this.vx += asym * (p / s.massKg) * 0.012;
    this.vy += (Math.random() - 0.4) * (p / s.massKg) * 0.006;
  }

  /** Integrate contact springs + damping; returns this frame's pose. */
  update(rawDt: number, aim: number): RecoilPose {
    const dt = Math.min(rawDt, 0.033);
    const s = this.spec;
    const braced = 1 + aim * 1.8; /* aiming stiffens the shooter's hold */

    let fx = 0, fy = 0, fz = 0;
    let tx = 0, ty = 0, tz = 0;

    for (const cp of s.contacts) {
      const [ox, oy, oz] = cp.offset;
      /* small-angle displacement of the contact: translation + (theta x r) */
      const dx = this.px + (this.ry * oz - this.rz * oy);
      const dy = this.py + (this.rz * ox - this.rx * oz);
      const dz = this.pz + (this.rx * oy - this.ry * ox);
      const dvx = this.vx + (this.wy * oz - this.wz * oy);
      const dvy = this.vy + (this.wz * ox - this.wx * oz);
      const dvz = this.vz + (this.wx * oy - this.wy * ox);

      const sfx = -(cp.k[0] * braced * dx + cp.c[0] * braced * dvx);
      const sfy = -(cp.k[1] * braced * dy + cp.c[1] * braced * dvy);
      const sfz = -(cp.k[2] * braced * dz + cp.c[2] * braced * dvz);

      fx += sfx; fy += sfy; fz += sfz;
      /* torque = r x F */
      tx += oy * sfz - oz * sfy;
      ty += oz * sfx - ox * sfz;
      tz += ox * sfy - oy * sfx;
    }

    /* whole-body return spring so the gun never drifts away */
    const kRet = 16;
    fx -= this.px * kRet; fy -= this.py * kRet; fz -= this.pz * kRet;
    tx -= this.rx * kRet * 0.5; ty -= this.ry * kRet * 0.5; tz -= this.rz * kRet * 0.5;

    const m = s.massKg;
    this.vx += (fx / m) * dt; this.vy += (fy / m) * dt; this.vz += (fz / m) * dt;
    this.wx += (tx / this.iP) * dt;
    this.wy += (ty / this.iY) * dt;
    this.wz += (tz / this.iR) * dt;
    this.px += this.vx * dt; this.py += this.vy * dt; this.pz += this.vz * dt;
    this.rx += this.wx * dt; this.ry += this.wy * dt; this.rz += this.wz * dt;

    /* stability clamps */
    const L = 0.3;
    this.px = clamp(this.px, -L, L); this.py = clamp(this.py, -L, L); this.pz = clamp(this.pz, -L, L);
    this.rx = clamp(this.rx, -0.8, 0.8); this.ry = clamp(this.ry, -0.8, 0.8); this.rz = clamp(this.rz, -0.8, 0.8);

    const g = s.viewGain;
    return {
      x: this.px * g,
      y: this.py * g,
      z: this.pz * g, /* + = shoved back toward the shooter */
      pitch: this.rx * g, /* + = muzzle climbs, camera looks up */
      yaw: this.ry * g * 0.8,
      roll: this.rz * g * 0.8,
    };
  }

  reset() {
    this.px = this.py = this.pz = 0;
    this.rx = this.ry = this.rz = 0;
    this.vx = this.vy = this.vz = 0;
    this.wx = this.wy = this.wz = 0;
  }
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

/* ---------------- weapon spec table ---------------- */

export const WEAPON_PHYSICS: WeaponPhysics[] = [
  /* P-9 — light pistol, high bore over weak grip contacts: snappy flip */
  {
    id: "p9", caliberMm: 9, muzzleEnergyJ: 520, muzzleVelocity: 380,
    massKg: 0.95, barrelLenM: 0.19, boreAxisM: 0.034, mechanism: 0.3, viewGain: 1.2,
    contacts: [
      { name: "grip", offset: [0, -0.1, 0.02], k: [260, 300, 120], c: [7, 8, 5] },
      { name: "support-hand", offset: [0.05, -0.08, -0.02], k: [180, 220, 90], c: [6, 7, 4] },
    ],
  },
  /* M870 — heavy 12ga impulse on a shoulder stock: big backward drive */
  {
    id: "m870", caliberMm: 18.5, muzzleEnergyJ: 3100, muzzleVelocity: 400,
    massKg: 3.4, barrelLenM: 0.5, boreAxisM: 0.022, mechanism: 0.15, viewGain: 1.5,
    contacts: [
      { name: "shoulder", offset: [0, 0.01, 0.24], k: [420, 260, 900], c: [14, 9, 26] },
      { name: "cheek", offset: [0.02, 0.06, 0.2], k: [200, 240, 200], c: [8, 9, 8] },
      { name: "grip", offset: [0, -0.09, 0.1], k: [240, 260, 120], c: [8, 8, 5] },
    ],
  },
  /* VK-9 — compact 9mm SMG with a light stock: fast chattering climb */
  {
    id: "vk9", caliberMm: 9, muzzleEnergyJ: 520, muzzleVelocity: 390,
    massKg: 2.7, barrelLenM: 0.26, boreAxisM: 0.03, mechanism: 0.45, viewGain: 1.25,
    contacts: [
      { name: "shoulder", offset: [0, 0, 0.2], k: [300, 200, 500], c: [10, 7, 16] },
      { name: "grip", offset: [0, -0.09, 0.04], k: [240, 260, 120], c: [8, 8, 5] },
    ],
  },
  /* MG-7 — heavy 7.62 GPMG, deep shoulder pocket, low bore: beds in and
     shudders with almost no muzzle flip, strong rearward shove */
  {
    id: "mg7", caliberMm: 7.62, muzzleEnergyJ: 3300, muzzleVelocity: 830,
    massKg: 10.5, barrelLenM: 0.56, boreAxisM: 0.014, mechanism: 0.4, viewGain: 1.7,
    contacts: [
      { name: "shoulder", offset: [0, 0.01, 0.3], k: [520, 320, 1400], c: [20, 12, 40] },
      { name: "cheek", offset: [0.02, 0.07, 0.26], k: [260, 300, 260], c: [10, 11, 10] },
      { name: "grip", offset: [0, -0.1, 0.12], k: [260, 280, 130], c: [9, 9, 6] },
      { name: "forend", offset: [0, -0.05, -0.2], k: [200, 240, 160], c: [8, 9, 6] },
    ],
  },
];
