import * as THREE from "three";
import type { RaiderRig } from "./raider";

/* ============================================================
   Reactive verlet ragdoll.
   On death the current skeletal pose is snapshotted into 16
   joint points. The killing blow injects velocity with a
   gaussian falloff around the exact hit point, so headshots
   flip bodies backwards, leg shots sweep them out, and
   shotguns launch them. Constraint relaxation + floor/wall/
   obstacle collision give a natural tumble; the sim is then
   mapped back onto the bone hierarchy every frame.
   ============================================================ */

export interface ObstacleBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface RdPoint {
  p: THREE.Vector3;
  pp: THREE.Vector3;
  r: number;
}

interface RdConstraint {
  a: number;
  b: number;
  len: number;
  stiff: number;
}

interface RdBone {
  bone: THREE.Bone;
  idx: number;
  childIdx: number; // point idx this bone aims at (-1 = inherit)
  restDir: THREE.Vector3; // bind-space direction toward the child joint
}

export interface Ragdoll {
  pts: RdPoint[];
  cons: RdConstraint[];
  bones: RdBone[];
  scale: number;
  deadT: number;
  sink: boolean;
}

/* point layout */
const P_HIPS = 0, P_SPINE = 1, P_NECK = 2, P_HEAD = 3;
const P_SHL = 4, P_ELL = 5, P_HANDL = 6;
const P_SHR = 7, P_ELR = 8, P_HANDR = 9;
const P_HIPL = 10, P_KNEEL = 11, P_ANKLEL = 12;
const P_HIPR = 13, P_KNEER = 14, P_ANKLER = 15;

const RADII = [0.19, 0.17, 0.11, 0.18, 0.11, 0.09, 0.09, 0.11, 0.09, 0.09, 0.13, 0.1, 0.1, 0.13, 0.1, 0.1];

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();

export function createRagdoll(rig: RaiderRig, scale: number): Ragdoll {
  rig.group.updateMatrixWorld(true);

  const boneDefs: [THREE.Bone, number, number][] = [
    /* bone, point idx, primary child point idx */
    [rig.hips, P_HIPS, P_SPINE],
    [rig.spine, P_SPINE, P_NECK],
    [rig.neck, P_NECK, P_HEAD],
    [rig.head, P_HEAD, -2], // -2 = aim along virtual extension
    [rig.shL, P_SHL, P_ELL],
    [rig.elL, P_ELL, P_HANDL],
    [rig.handL, P_HANDL, -1],
    [rig.shR, P_SHR, P_ELR],
    [rig.elR, P_ELR, P_HANDR],
    [rig.handR, P_HANDR, -1],
    [rig.hipL, P_HIPL, P_KNEEL],
    [rig.kneeL, P_KNEEL, P_ANKLEL],
    [rig.ankleL, P_ANKLEL, -1],
    [rig.hipR, P_HIPR, P_KNEER],
    [rig.kneeR, P_KNEER, P_ANKLER],
    [rig.ankleR, P_ANKLER, -1],
  ];

  const pts: RdPoint[] = [];
  for (let i = 0; i < 16; i++) {
    const v = new THREE.Vector3();
    boneDefs[i][0].getWorldPosition(v);
    pts.push({ p: v, pp: v.clone(), r: RADII[i] * scale });
  }

  const bones: RdBone[] = boneDefs.map(([bone, idx, childIdx]) => {
    let restDir = new THREE.Vector3(0, 1, 0);
    if (childIdx >= 0) {
      const child = boneDefs.find((b) => b[1] === childIdx);
      if (child) restDir = child[0].position.clone().normalize();
    }
    return { bone, idx, childIdx, restDir };
  });

  const links: [number, number, number][] = [
    /* a, b, stiffness — lengths measured from the death pose */
    [P_HIPS, P_SPINE, 1], [P_SPINE, P_NECK, 1], [P_NECK, P_HEAD, 1],
    [P_SPINE, P_SHL, 1], [P_SHL, P_ELL, 1], [P_ELL, P_HANDL, 1],
    [P_SPINE, P_SHR, 1], [P_SHR, P_ELR, 1], [P_ELR, P_HANDR, 1],
    [P_HIPS, P_HIPL, 1], [P_HIPL, P_KNEEL, 1], [P_KNEEL, P_ANKLEL, 1],
    [P_HIPS, P_HIPR, 1], [P_HIPR, P_KNEER, 1], [P_KNEER, P_ANKLER, 1],
    /* structural tissue */
    [P_SHL, P_SHR, 0.4],
    [P_HIPL, P_HIPR, 0.45],
    [P_HIPS, P_NECK, 0.16],
    [P_SHL, P_HIPR, 0.06],
    [P_SHR, P_HIPL, 0.06],
  ];

  const cons: RdConstraint[] = links.map(([a, b, stiff]) => ({
    a,
    b,
    len: pts[a].p.distanceTo(pts[b].p),
    stiff,
  }));

  return { pts, cons, bones, scale, deadT: 0, sink: false };
}

/** Inject the killing blow: impulse radiates from the exact hit point. */
export function impulseRagdoll(
  rd: Ragdoll,
  hitPoint: THREE.Vector3,
  dir: THREE.Vector3,
  force: number,
  baseVelX: number,
  baseVelZ: number
) {
  const d = _v1.copy(dir);
  if (d.lengthSq() < 0.0001) d.set(0, 0, 1);
  d.normalize();
  const sigma2 = 0.42 * rd.scale;
  for (const pt of rd.pts) {
    const dx = pt.p.x - hitPoint.x;
    const dy = pt.p.y - hitPoint.y;
    const dz = pt.p.z - hitPoint.z;
    const w = Math.exp(-(dx * dx + dy * dy + dz * dz) / (sigma2 * sigma2));
    /* inherited momentum + shot impulse with hit-point falloff */
    let vx = baseVelX + d.x * force * (0.25 + w);
    let vy = d.y * force * (0.25 + w) + 0.6 * w;
    let vz = baseVelZ + d.z * force * (0.25 + w);
    /* a little chaotic spin so no two deaths match */
    vx += (Math.random() - 0.5) * 1.6;
    vy += Math.random() * 1.1;
    vz += (Math.random() - 0.5) * 1.6;
    const h = 1 / 60;
    pt.pp.set(pt.p.x - vx * h, pt.p.y - vy * h, pt.p.z - vz * h);
  }
}

const GRAV = 22;

export function stepRagdoll(rd: Ragdoll, group: THREE.Group, dt: number, obstacles: ObstacleBox[]) {
  dt = Math.min(dt, 0.03);
  const damp = Math.exp(-1.15 * dt);
  const g = GRAV * dt * dt;

  /* ---------- integrate ---------- */
  for (const pt of rd.pts) {
    const vx = (pt.p.x - pt.pp.x) * damp;
    const vy = (pt.p.y - pt.pp.y) * damp;
    const vz = (pt.p.z - pt.pp.z) * damp;
    pt.pp.copy(pt.p);
    pt.p.x += vx;
    pt.p.y += vy - g;
    pt.p.z += vz;

    if (!rd.sink) {
      /* floor with bounce + friction */
      if (pt.p.y < pt.r) {
        pt.p.y = pt.r;
        pt.pp.y = pt.p.y + vy * 0.22;
        pt.pp.x = pt.p.x - vx * 0.5;
        pt.pp.z = pt.p.z - vz * 0.5;
      }
      /* arena shell — the hall, plus the annex extending east to x ≈ 52 */
      const limX = 52.2;
      const limZ = 30.6;
      if (pt.p.x < -limZ) { pt.p.x = -limZ; pt.pp.x = pt.p.x + vx * 0.3; }
      if (pt.p.x > limX) { pt.p.x = limX; pt.pp.x = pt.p.x + vx * 0.3; }
      if (pt.p.z < -limZ) { pt.p.z = -limZ; pt.pp.z = pt.p.z + vz * 0.3; }
      if (pt.p.z > limZ) { pt.p.z = limZ; pt.pp.z = pt.p.z + vz * 0.3; }
      /* crates, pillars, barriers */
      for (const o of obstacles) {
        if (pt.p.x > o.minX - pt.r && pt.p.x < o.maxX + pt.r && pt.p.z > o.minZ - pt.r && pt.p.z < o.maxZ + pt.r) {
          const dxL = pt.p.x - (o.minX - pt.r);
          const dxR = (o.maxX + pt.r) - pt.p.x;
          const dzL = pt.p.z - (o.minZ - pt.r);
          const dzR = (o.maxZ + pt.r) - pt.p.z;
          const m = Math.min(dxL, dxR, dzL, dzR);
          if (m === dxL) { pt.p.x = o.minX - pt.r; pt.pp.x = pt.p.x + vx * 0.3; }
          else if (m === dxR) { pt.p.x = o.maxX + pt.r; pt.pp.x = pt.p.x + vx * 0.3; }
          else if (m === dzL) { pt.p.z = o.minZ - pt.r; pt.pp.z = pt.p.z + vz * 0.3; }
          else { pt.p.z = o.maxZ + pt.r; pt.pp.z = pt.p.z + vz * 0.3; }
        }
      }
    }
  }

  /* ---------- relax constraints ---------- */
  for (let it = 0; it < 4; it++) {
    for (const c of rd.cons) {
      const a = rd.pts[c.a];
      const b = rd.pts[c.b];
      const dx = b.p.x - a.p.x;
      const dy = b.p.y - a.p.y;
      const dz = b.p.z - a.p.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
      const diff = ((dist - c.len) / dist) * 0.5 * c.stiff;
      a.p.x += dx * diff; a.p.y += dy * diff; a.p.z += dz * diff;
      b.p.x -= dx * diff; b.p.y -= dy * diff; b.p.z -= dz * diff;
    }
    /* keep joints off the floor during relaxation too */
    if (!rd.sink) for (const pt of rd.pts) if (pt.p.y < pt.r) pt.p.y = pt.r;
  }

  /* ---------- map back onto the skeleton ---------- */
  group.updateMatrixWorld(true);
  const hips = rd.bones[0];
  hips.bone.position.copy(rd.pts[P_HIPS].p).applyMatrix4(_m1.copy(group.matrixWorld).invert());

  for (const rb of rd.bones) {
    if (rb.childIdx === -1) continue;
    const self = rd.pts[rb.idx].p;
    let target: THREE.Vector3;
    if (rb.childIdx === -2) {
      /* head: extend along neck→head line */
      target = _v2.copy(self).multiplyScalar(2).sub(rd.pts[P_NECK].p);
    } else {
      target = rd.pts[rb.childIdx].p;
    }
    const desired = _v1.copy(target).sub(self);
    if (desired.lengthSq() < 1e-8) continue;
    desired.normalize();
    rb.bone.parent!.getWorldQuaternion(_q1);
    _q2.setFromUnitVectors(rb.restDir, desired);
    rb.bone.quaternion.copy(_q1.invert().multiply(_q2));
  }
}
