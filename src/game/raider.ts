import * as THREE from "three";

/* ============================================================
   Raider skeletal rig + FK animator.
   A full joint hierarchy (THREE.Bone) is posed every frame by
   a target-pose solver with per-state damping rates, giving
   run cycles, attack choreography, head tracking, flinches
   and death collapses.
   ============================================================ */

export type RaiderKind = "scrapper" | "runner" | "brute";

export const WINDUP_TIME: Record<RaiderKind, number> = {
  scrapper: 0.6, /* aim telegraph — enough time to break line of sight */
  runner: 0.38, /* a beat you can backpedal out of */
  brute: 0.62,
};

export interface RaiderRig {
  group: THREE.Group;
  hips: THREE.Bone;
  spine: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  shL: THREE.Bone;
  elL: THREE.Bone;
  handL: THREE.Bone;
  shR: THREE.Bone;
  elR: THREE.Bone;
  handR: THREE.Bone;
  hipL: THREE.Bone;
  kneeL: THREE.Bone;
  ankleL: THREE.Bone;
  hipR: THREE.Bone;
  kneeR: THREE.Bone;
  ankleR: THREE.Bone;
  flashMats: THREE.MeshLambertMaterial[];
  eyeMat: THREE.MeshBasicMaterial;
  eyeBase: THREE.Color;
  seed: number;
  /** world-space muzzle anchor — scrappers only */
  muzzle: THREE.Object3D | null;
}

export interface RaiderAnimInput {
  state: "rise" | "chase" | "windup" | "strike" | "charge" | "stagger" | "dead";
  stateT: number;
  walkT: number;
  t: number;
  dt: number;
  yawLocal: number; // signed angle from body facing to the player
  pitchToPlayer: number; // radians, + = look up
  hitstun: number;
  feint: number; // 0..1 fake-swing pulse
  dodgeLean: number; // signed sidestep lean
  windupMul: number; // wave-based telegraph speedup
  ranged: boolean; // scrapper gunmen aim and fire instead of swinging
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrapPi = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const damp = (c: number, tgt: number, rate: number, dt: number) =>
  c + (tgt - c) * (1 - Math.exp(-rate * dt));

/* ---------------- rig construction ---------------- */

function bone(x = 0, y = 0, z = 0): THREE.Bone {
  const b = new THREE.Bone();
  b.position.set(x, y, z);
  return b;
}

export function buildRaiderRig(kind: RaiderKind): RaiderRig {
  const skinTones: Record<RaiderKind, string> = { scrapper: "#8a5a3c", runner: "#b8a488", brute: "#6e6259" };
  const clothTones: Record<RaiderKind, string> = { scrapper: "#6e3320", runner: "#3e4a35", brute: "#41464d" };
  const eyeTones: Record<RaiderKind, string> = { scrapper: "#ffb42e", runner: "#7dff5e", brute: "#ff2e1f" };

  const cloth = new THREE.MeshLambertMaterial({ color: clothTones[kind], flatShading: true });
  const skin = new THREE.MeshLambertMaterial({ color: skinTones[kind], flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: "#26201a", flatShading: true });
  const steel = new THREE.MeshLambertMaterial({ color: "#6a7078", flatShading: true });
  const rusty = new THREE.MeshLambertMaterial({ color: "#7a7f86", flatShading: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: eyeTones[kind] });
  const flashMats = [cloth, skin, dark, steel, rusty];
  let muzzle: THREE.Object3D | null = null;

  const box = (w: number, h: number, d: number, mat: THREE.Material) =>
    new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const cyl = (r: number, h: number, mat: THREE.Material) =>
    new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 7), mat);

  const group = new THREE.Group();

  /* ---- skeleton ---- */
  const hips = bone(0, 0.88, 0);
  group.add(hips);

  const pelvis = box(0.34, 0.2, 0.22, kind === "brute" ? dark : cloth);
  pelvis.position.y = -0.03;
  hips.add(pelvis);
  const belt = box(0.37, 0.07, 0.25, dark);
  belt.position.y = 0.05;
  hips.add(belt);

  const spine = bone(0, 0.1, 0);
  hips.add(spine);
  const torso = box(0.48, 0.5, 0.26, cloth);
  torso.position.y = 0.24;
  spine.add(torso);

  /* chest dressing per kind */
  if (kind === "brute") {
    const plate = box(0.42, 0.34, 0.1, steel);
    plate.position.set(0, 0.28, 0.14);
    spine.add(plate);
    const gut = box(0.3, 0.16, 0.08, dark);
    gut.position.set(0, 0.06, 0.13);
    spine.add(gut);
  } else if (kind === "scrapper") {
    const strap = box(0.1, 0.52, 0.3, dark);
    strap.position.set(0.1, 0.24, 0);
    strap.rotation.z = 0.5;
    spine.add(strap);
    const plate = box(0.3, 0.22, 0.07, dark);
    plate.position.set(-0.06, 0.3, 0.14);
    spine.add(plate);
  } else {
    const strapL = box(0.07, 0.5, 0.29, dark);
    strapL.position.set(-0.12, 0.24, 0);
    strapL.rotation.z = -0.45;
    spine.add(strapL);
    const strapR = box(0.07, 0.5, 0.29, dark);
    strapR.position.set(0.12, 0.24, 0);
    strapR.rotation.z = 0.45;
    spine.add(strapR);
    const pouch = box(0.14, 0.12, 0.08, dark);
    pouch.position.set(0.14, 0.05, 0.14);
    spine.add(pouch);
  }

  /* ---- arms ---- */
  const mkArm = (side: number) => {
    const sh = bone(0.29 * side, 0.44, 0);
    spine.add(sh);
    const upMat = side < 0 ? cloth : skin;
    const upper = box(0.12, 0.32, 0.14, upMat);
    upper.position.y = -0.16;
    sh.add(upper);
    const el = bone(0, -0.32, 0);
    sh.add(el);
    const fore = box(0.1, 0.28, 0.12, skin);
    fore.position.y = -0.14;
    el.add(fore);
    const wrap = box(0.12, 0.1, 0.14, dark);
    wrap.position.y = -0.2;
    el.add(wrap);
    const hand = bone(0, -0.28, 0);
    el.add(hand);
    const fist = box(0.09, 0.11, 0.11, skin);
    fist.position.y = -0.05;
    hand.add(fist);
    return { sh, el, hand };
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  /* shoulder dressing */
  if (kind === "brute") {
    for (const a of [armL, armR]) {
      const pad = box(0.22, 0.11, 0.24, steel);
      pad.position.y = -0.01;
      a.sh.add(pad);
    }
  } else if (kind === "scrapper") {
    const pad = box(0.19, 0.09, 0.2, dark);
    pad.position.y = -0.01;
    armL.sh.add(pad);
  }

  /* weapon in right hand */
  if (kind === "brute") {
    const haft = cyl(0.045, 0.92, dark);
    haft.position.y = -0.42;
    armR.hand.add(haft);
    const maul = box(0.36, 0.21, 0.21, steel);
    maul.position.y = -0.86;
    armR.hand.add(maul);
    const cap = box(0.4, 0.07, 0.24, dark);
    cap.position.y = -0.98;
    armR.hand.add(cap);
  } else if (kind === "runner") {
    const grip = box(0.05, 0.16, 0.07, dark);
    grip.position.y = -0.08;
    armR.hand.add(grip);
    const blade = box(0.04, 0.5, 0.15, rusty);
    blade.position.y = -0.4;
    armR.hand.add(blade);
    const edge = box(0.05, 0.46, 0.03, new THREE.MeshLambertMaterial({ color: "#b9c0c8", flatShading: true }));
    edge.position.set(0, -0.4, -0.08);
    armR.hand.add(edge);
    flashMats.push(edge.material as THREE.MeshLambertMaterial);
  } else {
    /* scrapper carries a battered scrap pistol — muzzle anchor for tracers */
    const frame = box(0.07, 0.09, 0.3, dark);
    frame.position.set(0, -0.02, -0.08);
    armR.hand.add(frame);
    const barrelP = cyl(0.024, 0.34, rusty);
    barrelP.rotation.x = Math.PI / 2;
    barrelP.position.set(0, 0.01, -0.24);
    armR.hand.add(barrelP);
    const gripP = box(0.06, 0.14, 0.07, dark);
    gripP.position.set(0, -0.11, 0.02);
    gripP.rotation.x = -0.25;
    armR.hand.add(gripP);
    const hammer = box(0.03, 0.05, 0.03, steel);
    hammer.position.set(0, 0.06, 0.07);
    armR.hand.add(hammer);
    const muz = new THREE.Object3D();
    muz.position.set(0, 0.01, -0.44);
    armR.hand.add(muz);
    muzzle = muz;
  }

  /* ---- head ---- */
  const neck = bone(0, 0.52, 0);
  spine.add(neck);
  const neckM = cyl(0.06, 0.09, skin);
  neckM.position.y = 0.03;
  neck.add(neckM);
  const head = bone(0, 0.07, 0);
  neck.add(head);
  const skull = box(0.27, 0.28, 0.27, skin);
  skull.position.y = 0.11;
  head.add(skull);
  const jaw = box(0.21, 0.08, 0.2, skin);
  jaw.position.set(0, -0.05, 0.02);
  head.add(jaw);
  const eyeL = box(0.055, 0.045, 0.03, eyeMat);
  eyeL.position.set(-0.07, 0.13, 0.135);
  head.add(eyeL);
  const eyeR = box(0.055, 0.045, 0.03, eyeMat);
  eyeR.position.set(0.07, 0.13, 0.135);
  head.add(eyeR);

  if (kind === "scrapper") {
    const hawk = box(0.06, 0.17, 0.26, new THREE.MeshLambertMaterial({ color: "#c43a22", flatShading: true }));
    hawk.position.y = 0.31;
    head.add(hawk);
    flashMats.push(hawk.material as THREE.MeshLambertMaterial);
    const paint = box(0.28, 0.05, 0.03, dark);
    paint.position.set(0, 0.05, 0.135);
    head.add(paint);
  } else if (kind === "brute") {
    const helm = box(0.33, 0.15, 0.33, steel);
    helm.position.y = 0.24;
    head.add(helm);
    const brow = box(0.33, 0.05, 0.06, dark);
    brow.position.set(0, 0.17, 0.15);
    head.add(brow);
  } else {
    const hood = box(0.31, 0.18, 0.3, cloth);
    hood.position.set(0, 0.2, -0.03);
    head.add(hood);
    const scarf = box(0.24, 0.09, 0.24, cloth);
    scarf.position.y = -0.09;
    head.add(scarf);
  }

  /* ---- legs ---- */
  const mkLeg = (side: number) => {
    const hip = bone(0.12 * side, 0, 0);
    hips.add(hip);
    const thigh = box(0.16, 0.4, 0.19, kind === "brute" ? dark : cloth);
    thigh.position.y = -0.2;
    hip.add(thigh);
    const knee = bone(0, -0.4, 0);
    hip.add(knee);
    const shin = box(0.13, 0.38, 0.15, kind === "brute" ? dark : cloth);
    shin.position.y = -0.19;
    knee.add(shin);
    const guard = box(0.15, 0.16, 0.06, kind === "brute" ? steel : dark);
    guard.position.set(0, -0.16, 0.09);
    knee.add(guard);
    const ankle = bone(0, -0.38, 0);
    knee.add(ankle);
    const boot = box(0.15, 0.12, 0.29, dark);
    boot.position.set(0, -0.05, 0.05);
    ankle.add(boot);
    return { hip, knee, ankle };
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  return {
    group,
    hips,
    spine,
    neck,
    head,
    shL: armL.sh,
    elL: armL.el,
    handL: armL.hand,
    shR: armR.sh,
    elR: armR.el,
    handR: armR.hand,
    hipL: legL.hip,
    kneeL: legL.knee,
    ankleL: legL.ankle,
    hipR: legR.hip,
    kneeR: legR.knee,
    ankleR: legR.ankle,
    flashMats,
    eyeMat,
    eyeBase: new THREE.Color(eyeTones[kind]),
    seed: Math.random() * Math.PI * 2,
    muzzle,
  };
}

/* ---------------- pose solver ---------------- */

interface Pose {
  thighL: number; kneeL: number; ankleL: number;
  thighR: number; kneeR: number; ankleR: number;
  shLx: number; shLz: number; elLx: number;
  shRx: number; shRz: number; elRx: number;
  spineX: number; spineY: number; spineZ: number;
  hipsY: number; hipsZ: number;
  headYaw: number; headPitch: number;
  bobY: number;
  rate: number;
}

const IDLE: Pose = {
  thighL: 0.04, kneeL: 0.12, ankleL: -0.1,
  thighR: 0.04, kneeR: 0.12, ankleR: -0.1,
  shLx: 0.08, shLz: -0.07, elLx: 0.25,
  shRx: 0.08, shRz: 0.07, elRx: 0.25,
  spineX: 0.06, spineY: 0, spineZ: 0,
  hipsY: 0, hipsZ: 0,
  headYaw: 0, headPitch: 0.05,
  bobY: 0,
  rate: 10,
};

export function updateRaiderAnim(rig: RaiderRig, kind: RaiderKind, inp: RaiderAnimInput): void {
  const p: Pose = { ...IDLE };
  const ph = inp.walkT;
  const sL = Math.sin(ph);

  if (inp.state === "chase") {
    const amp = kind === "runner" ? 1.2 : kind === "brute" ? 0.72 : 1;
    p.thighL = sL * 0.85 * amp;
    p.thighR = -sL * 0.85 * amp;
    p.kneeL = 0.18 + 1.15 * amp * Math.max(0, Math.sin(ph - 0.75));
    p.kneeR = 0.18 + 1.15 * amp * Math.max(0, -Math.sin(ph - 0.75));
    p.ankleL = -(p.thighL + p.kneeL) * 0.72 + Math.max(0, -sL) * 0.28;
    p.ankleR = -(p.thighR + p.kneeR) * 0.72 + Math.max(0, sL) * 0.28;
    const swing = sL * 0.62 * amp;
    p.shLx = -swing;
    p.shRx = swing;
    p.elLx = 0.5 + 0.4 * Math.max(0, -sL);
    p.elRx = 0.5 + 0.4 * Math.max(0, sL);
    p.spineX = 0.16 + 0.05 * amp;
    p.spineY = sL * 0.13;
    p.spineZ = sL * 0.045;
    p.hipsY = -sL * 0.1;
    p.hipsZ = sL * 0.07;
    p.bobY = Math.abs(Math.sin(ph)) * 0.055 * amp;
    p.rate = 13;

    if (kind === "runner") {
      /* blade held high and ready while sprinting */
      p.shRx = 0.75 + sL * 0.12;
      p.elRx = -1.7;
    } else if (kind === "brute") {
      p.shRx = 0.3;
      p.elRx = 0.25;
      p.shLx = -swing * 0.5;
    }

    /* feint jab — a quick fake swing to bait the player's rhythm */
    if (inp.feint > 0) {
      p.shRx += inp.feint * 1.25;
      p.elRx -= inp.feint * 0.5;
      p.spineX += inp.feint * 0.3;
      p.thighR -= inp.feint * 0.5;
      p.thighL += inp.feint * 0.3;
    }
  } else if (inp.state === "windup") {
    const k = clamp(inp.stateT / (WINDUP_TIME[kind] * inp.windupMul), 0, 1);
    const e = k * k * (3 - 2 * k);
    p.rate = 11;
    p.thighL = 0.42 * e;
    p.thighR = -0.36 * e;
    p.kneeL = 0.5 * e + 0.12;
    p.kneeR = 0.34 * e + 0.12;
    p.ankleL = -0.3 * e;
    p.ankleR = -0.1 * e;
    p.spineX = -0.12 * e;
    p.spineY = 0.5 * e;
    p.shLx = 0.7 * e;
    p.elLx = 0.95;
    p.shLz = -0.15 * e;
    if (kind === "brute") {
      /* two-handed overhead raise with a menace tremble */
      const tr = Math.sin(inp.t * 46) * 0.055 * e;
      p.shRx = (-2.5 + tr) * e;
      p.shLx = (-2.5 - tr) * e;
      p.elRx = 0.3;
      p.elLx = 0.3;
      p.shRz = 0.1 * e;
      p.shLz = -0.1 * e;
      p.spineX = -0.3 * e;
      p.spineY = 0;
      p.kneeL = 0.66 * e + 0.12;
      p.kneeR = 0.66 * e + 0.12;
      p.bobY = -0.06 * e;
    } else {
      p.shRx = -2.25 * e;
      p.elRx = -0.55 * e;
      p.shRz = 0.28 * e;
      if (kind === "runner") p.elRx = -1.05 * e;
    }
    if (inp.ranged) {
      /* two-handed pistol aim — arms extended, support hand under the frame,
         live sight sway so the player can read the barrel hunting them */
      const sway = Math.sin(inp.t * 9 + rig.seed) * 0.045 * e;
      p.thighL = 0.22 * e;
      p.thighR = -0.18 * e;
      p.kneeL = 0.42 * e + 0.12;
      p.kneeR = 0.3 * e + 0.12;
      p.ankleL = -0.18 * e;
      p.ankleR = -0.08 * e;
      p.spineX = 0.18 * e;
      p.spineY = 0;
      p.shRx = (-1.5 + sway) * e;
      p.elRx = -0.12;
      p.shLx = (-1.35 - sway) * e;
      p.elLx = -0.5;
      p.shRz = 0.08 * e;
      p.shLz = 0.55 * e; /* left hand crosses in to cradle the grip */
      p.bobY = -0.03 * e;
    }
  } else if (inp.state === "strike") {
    const k = clamp(inp.stateT / 0.14, 0, 1);
    const e = k * k;
    p.rate = 42;
    p.spineX = 0.32 * e;
    p.thighL = 0.5;
    p.thighR = -0.45;
    p.kneeL = 0.36;
    p.kneeR = 0.3;
    p.bobY = -0.03 * e;
    if (kind === "brute") {
      p.shRx = 1.2;
      p.shLx = 1.2;
      p.elRx = 0.12;
      p.elLx = 0.12;
      p.shRz = 0.05;
      p.shLz = -0.05;
      p.spineX = 0.48 * e;
      p.spineY = 0;
      p.kneeL = 0.14;
      p.kneeR = 0.14;
      p.thighL = 0.36;
      p.thighR = 0.36;
      p.bobY = -0.09 * e;
    } else if (kind === "runner") {
      p.shRx = 1.28;
      p.elRx = -0.15;
      p.spineX = 0.44 * e;
      p.thighL = 0.9;
      p.thighR = -0.62;
      p.kneeL = 0.95;
      p.shLx = -0.5;
    } else {
      p.shRx = 1.06;
      p.elRx = 0.18;
      p.shRz = -0.32;
      p.spineY = -0.55 * e;
      p.shLx = 0.4;
    }
    if (inp.ranged) {
      /* firing recoil — elbows snap back, the gun kicks, shoulder absorbs */
      p.shRx = -1.12;
      p.elRx = -0.45;
      p.shLx = -0.98;
      p.elLx = -0.4;
      p.shRz = 0.05;
      p.shLz = 0.5;
      p.spineX = 0.12 + 0.1 * e;
      p.spineY = 0;
      p.thighL = 0.2;
      p.thighR = -0.16;
      p.kneeL = 0.4;
      p.kneeR = 0.28;
      p.bobY = -0.02 * e;
    }
  } else if (inp.state === "charge") {
    const tele = 0.7;
    if (inp.stateT < tele) {
      /* coiled stomp telegraph — hauled back and trembling */
      const k = clamp(inp.stateT / tele, 0, 1);
      const e = k * k * (3 - 2 * k);
      const pump = Math.sin(inp.t * 26) * 0.06 * e;
      p.rate = 12;
      p.spineX = 0.34 * e;
      p.thighL = 0.55 * e + pump;
      p.thighR = 0.55 * e - pump;
      p.kneeL = 0.85 * e + 0.12;
      p.kneeR = 0.85 * e + 0.12;
      p.shRx = 0.85 * e;
      p.shLx = 0.85 * e;
      p.elRx = 0.6;
      p.elLx = 0.6;
      p.shRz = 0.25 * e;
      p.shLz = -0.25 * e;
      p.headPitch = clamp(-inp.pitchToPlayer, -0.4, 0.6) - 0.12 * e;
      p.bobY = -0.08 * e;
    } else {
      /* blind bull rush — low, arms streaming behind */
      p.rate = 15;
      p.spineX = 0.5;
      p.thighL = Math.sin(ph) * 1.15;
      p.thighR = -Math.sin(ph) * 1.15;
      p.kneeL = 0.2 + Math.max(0, Math.sin(ph - 0.7)) * 0.9;
      p.kneeR = 0.2 + Math.max(0, -Math.sin(ph - 0.7)) * 0.9;
      p.ankleL = -(p.thighL + p.kneeL) * 0.6;
      p.ankleR = -(p.thighR + p.kneeR) * 0.6;
      p.shRx = 0.95;
      p.shLx = 0.95;
      p.elRx = 0.25;
      p.elLx = 0.25;
      p.shRz = 0.35;
      p.shLz = -0.35;
      p.headPitch = 0.26;
      p.bobY = Math.abs(Math.sin(ph)) * 0.05;
    }
  } else if (inp.state === "stagger") {
    /* dazed stumble — wall hit, trample whiff or a cracked skull */
    const k = clamp(inp.stateT / 1.05, 0, 1);
    const wob = Math.sin(inp.t * 6.5 + rig.seed) * (1 - k);
    p.rate = 9;
    p.spineX = 0.4 - 0.22 * k;
    p.spineZ = wob * 0.14;
    p.spineY = wob * 0.2;
    p.thighL = 0.3 + wob * 0.1;
    p.thighR = 0.24 - wob * 0.1;
    p.kneeL = 0.5;
    p.kneeR = 0.42;
    p.shLx = 0.5;
    p.shRx = 0.45;
    p.shLz = -0.55;
    p.shRz = 0.5;
    p.elLx = 0.7;
    p.elRx = 0.6;
    p.headPitch = 0.5 * (1 - k * 0.5);
    p.headYaw = wob * 0.5;
    p.bobY = -0.03;
  } else if (inp.state === "rise") {
    const k = clamp(inp.stateT / 0.45, 0, 1);
    const e = k * k * (3 - 2 * k);
    p.rate = 7;
    /* hauling itself out of the floor hatch */
    p.thighL = 0.95 * (1 - e);
    p.thighR = 0.8 * (1 - e);
    p.kneeL = 1.5 * (1 - e) + 0.12;
    p.kneeR = 1.35 * (1 - e) + 0.12;
    p.ankleL = -0.5 * (1 - e);
    p.ankleR = -0.4 * (1 - e);
    p.spineX = 0.5 * (1 - e);
    p.shLx = 0.75 * (1 - e);
    p.shRx = 0.65 * (1 - e);
    p.elLx = 0.85 * (1 - e) + 0.2;
    p.elRx = 0.7 * (1 - e) + 0.2;
  } else if (inp.state === "dead") {
    /* limp collapse */
    p.rate = 4.5;
    p.spineX = 0.28;
    p.spineZ = Math.sin(rig.seed) * 0.12;
    p.shLx = 0.35;
    p.shRx = 0.3;
    p.shLz = -1.05;
    p.shRz = 1.0;
    p.elLx = 0.45;
    p.elRx = 0.35;
    p.thighL = 0.55 + Math.sin(rig.seed) * 0.15;
    p.thighR = 0.4;
    p.kneeL = 1.25;
    p.kneeR = 1.05;
    p.ankleL = -0.45;
    p.ankleR = -0.3;
    p.hipsZ = 0.16;
    p.headYaw = Math.sin(rig.seed) * 0.6;
    p.headPitch = 0.62;
  }

  /* head tracking — the head hunts the player independently of the body */
  if (inp.state !== "dead" && inp.state !== "stagger") {
    let yawT = clamp(wrapPi(inp.yawLocal) * 1.25 - p.spineY, -1.1, 1.1);
    /* positive rotation.x tilts the face downward, so invert the aim angle */
    let pitchT = clamp(-inp.pitchToPlayer, -0.45, 0.62);
    if (inp.state === "chase") {
      pitchT += Math.sin(ph * 2 + rig.seed) * 0.045;
      yawT += Math.sin(ph * 0.5 + rig.seed) * 0.14;
    } else if (inp.state === "windup") {
      yawT *= 0.25;
      pitchT = clamp(-inp.pitchToPlayer * 1.5, -0.5, 0.7); /* locked predatory stare */
    } else if (inp.state === "strike") {
      yawT *= 0.12;
    } else if (inp.state === "rise") {
      const rk = clamp(inp.stateT / 0.45, 0, 1);
      pitchT += 0.5 * (1 - rk * rk * (3 - 2 * rk)); /* head hangs, then lifts */
      yawT += Math.sin(rig.seed) * 0.5 * (1 - rk);
    } else if (inp.state === "charge" && inp.stateT >= 0.7) {
      yawT *= 0.05; /* eyes pinned forward for the rush */
      pitchT = 0.26;
    }
    const f = clamp(inp.hitstun * 6, 0, 1);
    if (f > 0) {
      pitchT += 0.5 * f;
      yawT += Math.sin(rig.seed * 3) * 0.35 * f;
      p.spineX -= 0.4 * f;
      p.shLz -= 0.25 * f;
      p.shRz += 0.25 * f;
      p.kneeL += 0.3 * f;
      p.kneeR += 0.3 * f;
    }
    p.headYaw = yawT;
    p.headPitch = pitchT;
  }

  /* dodge lean — reactive sidestep away from gunfire */
  if (inp.dodgeLean !== 0 && (inp.state === "chase" || inp.state === "windup")) {
    p.spineZ += inp.dodgeLean * 0.4;
    p.hipsZ += inp.dodgeLean * 0.12;
    p.shLz -= inp.dodgeLean * 0.3;
    p.shRz -= inp.dodgeLean * 0.3;
  }

  /* apply with state-dependent damping for snappy strikes / heavy deaths */
  const r = p.rate;
  const dt = inp.dt;
  rig.hipL.rotation.x = damp(rig.hipL.rotation.x, p.thighL, r, dt);
  rig.kneeL.rotation.x = damp(rig.kneeL.rotation.x, p.kneeL, r, dt);
  rig.ankleL.rotation.x = damp(rig.ankleL.rotation.x, p.ankleL, r, dt);
  rig.hipR.rotation.x = damp(rig.hipR.rotation.x, p.thighR, r, dt);
  rig.kneeR.rotation.x = damp(rig.kneeR.rotation.x, p.kneeR, r, dt);
  rig.ankleR.rotation.x = damp(rig.ankleR.rotation.x, p.ankleR, r, dt);
  rig.shL.rotation.x = damp(rig.shL.rotation.x, p.shLx, r, dt);
  rig.shL.rotation.z = damp(rig.shL.rotation.z, p.shLz, r, dt);
  rig.elL.rotation.x = damp(rig.elL.rotation.x, p.elLx, r, dt);
  rig.shR.rotation.x = damp(rig.shR.rotation.x, p.shRx, r, dt);
  rig.shR.rotation.z = damp(rig.shR.rotation.z, p.shRz, r, dt);
  rig.elR.rotation.x = damp(rig.elR.rotation.x, p.elRx, r, dt);
  rig.spine.rotation.x = damp(rig.spine.rotation.x, p.spineX, r, dt);
  rig.spine.rotation.y = damp(rig.spine.rotation.y, p.spineY, r, dt);
  rig.spine.rotation.z = damp(rig.spine.rotation.z, p.spineZ, r, dt);
  rig.hips.rotation.y = damp(rig.hips.rotation.y, p.hipsY, r, dt);
  rig.hips.rotation.z = damp(rig.hips.rotation.z, p.hipsZ, r, dt);
  rig.neck.rotation.y = damp(rig.neck.rotation.y, p.headYaw * 0.35, 12, dt);
  rig.head.rotation.y = damp(rig.head.rotation.y, p.headYaw, 12, dt);
  rig.head.rotation.x = damp(rig.head.rotation.x, p.headPitch, 12, dt);

  /* vertical body motion — engine owns Y during rise/death */
  if (inp.state === "chase" || inp.state === "windup" || inp.state === "strike") {
    rig.group.position.y = p.bobY;
  }
}
