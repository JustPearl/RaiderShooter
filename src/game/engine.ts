import * as THREE from "three";
import { sfx } from "./audio";
import { buildRaiderRig, updateRaiderAnim, WINDUP_TIME, type RaiderRig } from "./raider";
import { createRagdoll, impulseRagdoll, stepRagdoll, type Ragdoll } from "./ragdoll";
import {
  floorTexture,
  wallTexture,
  crateTexture,
  barrelTexture,
  hazardTexture,
  concreteTexture,
  flashTexture,
} from "./textures";

/* ============================== Types ============================== */

export type GamePhase = "attract" | "playing" | "paused" | "dead" | "draft";

export type Rarity = "common" | "rare" | "epic";

export interface SkillCard {
  id: string;
  name: string;
  desc: string;
  tag: "SYSTEMS" | "ABILITY";
  rarity: Rarity;
  level: number; /* times already installed */
  maxLevel: number;
}

export interface HudData {
  hp: number;
  maxHp: number;
  ammo: number;
  reserve: number;
  weapon: number;
  weaponName: string;
  wave: number;
  score: number;
  kills: number;
  spreadGap: number;
  reloading: boolean;
  reloadT: number;
  combo: number;
  enemiesLeft: number;
}

export type GameEvent =
  | { type: "playing" }
  | { type: "paused" }
  | { type: "dead"; stats: FinalStats }
  | { type: "hitmarker"; head: boolean; kill: boolean }
  | { type: "damage" }
  | { type: "wave"; wave: number; count: number }
  | { type: "cleared"; wave: number; bonus: number }
  | { type: "kill"; text: string }
  | { type: "pickup"; text: string }
  | { type: "draft"; cards: SkillCard[] };

export interface FinalStats {
  wave: number;
  kills: number;
  score: number;
  accuracy: number;
  time: number;
}

interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type EnemyKind = "scrapper" | "runner" | "brute";

interface Enemy {
  group: THREE.Group;
  rig: RaiderRig;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  range: number;
  score: number;
  state: "rise" | "chase" | "windup" | "strike" | "charge" | "stagger" | "dead";
  stateT: number;
  attackCd: number;
  flash: number;
  hitstun: number;
  kvx: number;
  kvz: number;
  walkT: number;
  sinkT: number;
  wobble: number;
  mvx: number;
  mvz: number;
  ragdoll: Ragdoll | null;
  /* tactics */
  orbitDir: number;
  style: "rush" | "flank";
  stuckT: number;
  feintT: number;
  feintCd: number;
  dodgeT: number;
  dodgeVx: number;
  dodgeVz: number;
  dodgeDir: number;
  chargeDirX: number;
  chargeDirZ: number;
  chargeLocked: boolean;
  enraged: boolean;
}

interface Barrel {
  mesh: THREE.Mesh;
  hp: number;
  fuse: number;
  dead: boolean;
}

interface Pickup {
  group: THREE.Group;
  kind: "health" | "ammo";
  life: number;
}

interface WeaponDef {
  name: string;
  tag: string;
  dmg: number;
  pellets: number;
  spread: number;
  kick: number;
  cooldown: number;
  magSize: number;
  reloadTime: number;
  auto: boolean;
  fovPunch: number;
}

/* ============================== Engine ============================== */

const VW = 854;
const VH = 480;
const ARENA = 31;
const UP = new THREE.Vector3(0, 1, 0);

const WEAPONS: WeaponDef[] = [
  { name: "P-9 SCRAPLOCK", tag: "P-9", dmg: 34, pellets: 1, spread: 0.008, kick: 0.014, cooldown: 0.155, magSize: 12, reloadTime: 0.95, auto: true, fovPunch: 1.2 },
  { name: "M870 BREAKER", tag: "BREAKER", dmg: 15, pellets: 8, spread: 0.055, kick: 0.06, cooldown: 0.82, magSize: 6, reloadTime: 0.5, auto: false, fovPunch: 5 },
];

/* ============================== Skill pool ============================== */

interface SkillDef {
  id: string;
  name: string;
  desc: string;
  tag: "SYSTEMS" | "ABILITY";
  rarity: Rarity;
  maxLevel: number;
  weight: number;
}

const SKILLS: SkillDef[] = [
  { id: "dmg", name: "HEAVY ROUNDS", desc: "+25% weapon damage. The foundry casts them hot.", tag: "SYSTEMS", rarity: "common", maxLevel: 4, weight: 5 },
  { id: "rate", name: "TRIGGER WORK", desc: "+20% fire rate. Filed sear, polished spring.", tag: "SYSTEMS", rarity: "common", maxLevel: 4, weight: 5 },
  { id: "hp", name: "WELDED PLATE", desc: "+25 max integrity, patched up immediately.", tag: "SYSTEMS", rarity: "common", maxLevel: 4, weight: 5 },
  { id: "spd", name: "SERVO LEGS", desc: "+12% movement speed. Salvaged loader hydraulics.", tag: "SYSTEMS", rarity: "common", maxLevel: 3, weight: 5 },
  { id: "rel", name: "FAST HANDS", desc: "30% faster reloads and +2 pistol rounds per mag.", tag: "SYSTEMS", rarity: "common", maxLevel: 3, weight: 5 },
  { id: "crit", name: "DEADEYE OPTIC", desc: "+15% chance to crit for triple damage.", tag: "ABILITY", rarity: "rare", maxLevel: 3, weight: 3 },
  { id: "vamp", name: "SCRAP HEART", desc: "Every kill welds +6 integrity back on.", tag: "ABILITY", rarity: "rare", maxLevel: 3, weight: 3 },
  { id: "tank", name: "BOILER SUIT", desc: "25% less damage taken. Stacks multiply.", tag: "ABILITY", rarity: "rare", maxLevel: 2, weight: 3 },
  { id: "magnet", name: "SALVAGE RIG", desc: "2.2x pickup radius, +50% supply drops.", tag: "ABILITY", rarity: "rare", maxLevel: 2, weight: 3 },
  { id: "pellets", name: "FLECHETTE LOAD", desc: "+3 shotgun pellets per shell. Wider erasure.", tag: "ABILITY", rarity: "epic", maxLevel: 2, weight: 1.6 },
  { id: "ninth", name: "NINTH LIFE", desc: "Survive a lethal hit at 35 integrity — once per wave.", tag: "ABILITY", rarity: "epic", maxLevel: 2, weight: 1.6 },
  { id: "berserk", name: "REDLINE VALVE", desc: "Below 40% integrity: +30% damage, +15% speed.", tag: "ABILITY", rarity: "epic", maxLevel: 2, weight: 1.6 },
];

const ENEMY_DEFS: Record<EnemyKind, { hp: number; speed: number; dmg: number; range: number; score: number; scale: number }> = {
  scrapper: { hp: 60, speed: 3.5, dmg: 8, range: 1.75, score: 100, scale: 1 },
  runner: { hp: 34, speed: 5.7, dmg: 6, range: 1.55, score: 150, scale: 0.88 },
  brute: { hp: 270, speed: 2.35, dmg: 22, range: 2.35, score: 400, scale: 1.45 },
};

const FLASH_WHITE = new THREE.Color("#ffffff");

export class FoundryGame {
  private canvas: HTMLCanvasElement;
  private onEvent: (e: GameEvent) => void;
  private onHud: (h: HudData) => void;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  phase: GamePhase = "attract";

  /* player */
  private pos = new THREE.Vector3(0, 0, 8);
  private vel = new THREE.Vector3();
  private yaw = Math.PI;
  private pitch = 0;
  private grounded = true;
  private hp = 100;
  private maxHp = 100;
  private regenT = 0;

  /* installed modifications */
  private dmgMul = 1;
  private fireMul = 1;
  private speedMul = 1;
  private reloadMul = 1;
  private critChance = 0;
  private lifesteal = 0;
  private dmgResist = 0;
  private pickupRadiusMul = 1;
  private dropMul = 1;
  private extraPellets = 0;
  private secondWind = false;
  private secondWindHp = 35;
  private secondWindUsed = false;
  private berserk = false;
  private berserkBonus = 0;
  private skillLevels: Record<string, number> = {};
  private bobT = 0;
  private bobY = 0;
  private recoilPitch = 0;
  private trauma = 0;
  private fovKick = 0;
  private lastLandVy = 0;
  private keys = new Set<string>();
  private firing = false;
  private mouseDX = 0;
  private mouseDY = 0;

  /* weapons */
  private weaponIdx = 0;
  private mags = [12, 6];
  private reserves = [Infinity, 24];
  private fireCd = 0;
  private wState: "idle" | "lowering" | "raising" | "reloading" = "idle";
  private wT = 0;
  private pendingWeapon = 0;
  private shellT = 0;
  private heat = 0;
  private vmGroups: THREE.Group[] = [];
  private vmMuzzles: THREE.Object3D[] = [];
  private vmBase = new THREE.Vector3(0.3, -0.28, -0.55);
  private vmKick = 0;
  private vmSlide: THREE.Mesh | null = null;
  private vmPump: THREE.Mesh | null = null;
  private slideT = 0;
  private pumpT = -1;
  private rackT = -1;
  private aimAmt = 0;
  private aiming = false;
  private recoilYaw = 0;
  private gunLight: THREE.PointLight | null = null;
  private swayX = 0;
  private swayY = 0;
  private swayVX = 0;
  private swayVY = 0;
  private shotsFired = 0;
  private shotsHit = 0;

  private shellGeo: THREE.BoxGeometry | null = null;

  /* world */
  private obstacles: AABB[] = [];
  private shootables: THREE.Mesh[] = [];
  private barrels: Barrel[] = [];
  private enemies: Enemy[] = [];
  private pickups: Pickup[] = [];
  private lamps: { light: THREE.PointLight; base: number; broken: boolean; seed: number }[] = [];
  private fans: THREE.Group[] = [];
  private gateLights: THREE.PointLight[] = [];
  private swipes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; base: number }[] = [];
  private swipeGeo: THREE.RingGeometry | null = null;
  private lastRunnerDir = 1;
  private shells: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }[] = [];

  /* fx pools */
  private pCount = 600;
  private pPos!: Float32Array;
  private pCol!: Float32Array;
  private pBase!: Float32Array;
  private pVel!: Float32Array;
  private pLife!: Float32Array;
  private pMax!: Float32Array;
  private pGrav!: Float32Array;
  private pNext = 0;
  private points!: THREE.Points;

  private tCount = 48;
  private tPos!: Float32Array;
  private tCol!: Float32Array;
  private tLife!: Float32Array;
  private tMax!: Float32Array;
  private tNext = 0;
  private tracerLines!: THREE.LineSegments;

  private flashTex!: THREE.Texture;
  private muzzleFlashes: { mesh: THREE.Mesh; life: number }[] = [];
  private flashLights: { light: THREE.PointLight; life: number }[] = [];
  private rings: { mesh: THREE.Mesh; life: number; speed: number }[] = [];

  /* waves */
  private wave = 0;
  private score = 0;
  private kills = 0;
  private combo = 0;
  private comboT = 0;
  private waveMode: "intermission" | "active" = "intermission";
  private waveT = 0;
  private spawnQueue: EnemyKind[] = [];
  private spawnT = 0;
  private playT = 0;

  private raycaster = new THREE.Raycaster();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, onEvent: (e: GameEvent) => void, onHud: (h: HudData) => void) {
    this.canvas = canvas;
    this.onEvent = onEvent;
    this.onHud = onHud;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(VW, VH, false);
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#161008");
    this.scene.fog = new THREE.FogExp2(new THREE.Color("#161008"), 0.026);

    this.camera = new THREE.PerspectiveCamera(75, VW / VH, 0.05, 120);
    this.camera.rotation.order = "YXZ";

    this.buildWorld();
    this.buildViewModels();
    this.buildFxPools();
    this.bindInput();

    this.clock.start();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unbindInput();
    this.renderer.dispose();
  }

  /* ============================== Input ============================== */

  private onKeyDown = (e: KeyboardEvent) => {
    if (["Space", "ArrowUp", "ArrowDown", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (this.phase !== "playing") return;
    if (e.code === "Digit1") this.switchTo(0);
    if (e.code === "Digit2") this.switchTo(1);
    if (e.code === "KeyR") this.startReload();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === this.canvas) {
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }
  };
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.firing = true;
    if (e.button === 2) this.aiming = true;
    /* safety: a click while un-locked re-engages the pointer lock */
    if (this.phase === "playing" && document.pointerLockElement !== this.canvas) this.lockPointer();
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.firing = false;
    if (e.button === 2) this.aiming = false;
  };
  private onWheel = (e: WheelEvent) => {
    if (this.phase === "playing") this.switchTo(this.weaponIdx === 0 ? 1 : 0);
  };
  private onCtx = (e: Event) => e.preventDefault();
  private onDocCtx = (e: Event) => e.preventDefault();
  private onLockChange = () => {
    if (document.pointerLockElement === this.canvas) {
      if (this.phase !== "playing") {
        this.phase = "playing";
        this.onEvent({ type: "playing" });
      }
    } else if (this.phase === "playing") {
      this.phase = "paused";
      this.onEvent({ type: "paused" });
    }
  };

  private bindInput() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("wheel", this.onWheel);
    this.canvas.addEventListener("contextmenu", this.onCtx);
    document.addEventListener("contextmenu", this.onDocCtx);
    document.addEventListener("pointerlockchange", this.onLockChange);
  }
  private unbindInput() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onCtx);
    document.removeEventListener("contextmenu", this.onDocCtx);
    document.removeEventListener("pointerlockchange", this.onLockChange);
  }

  /* ============================== Public control ============================== */

  private lockPointer() {
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* browser re-lock cooldown — user retries with next click */
    }
  }

  start() {
    sfx.ensure();
    this.resetRun();
    this.lockPointer();
  }

  resume() {
    sfx.ensure();
    this.lockPointer();
  }

  restart() {
    this.start();
  }

  toAttract() {
    this.phase = "attract";
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private resetRun() {
    this.hp = 100;
    this.maxHp = 100;
    /* strip all installed modifications */
    this.dmgMul = 1;
    this.fireMul = 1;
    this.speedMul = 1;
    this.reloadMul = 1;
    this.critChance = 0;
    this.lifesteal = 0;
    this.dmgResist = 0;
    this.pickupRadiusMul = 1;
    this.dropMul = 1;
    this.extraPellets = 0;
    this.secondWind = false;
    this.secondWindHp = 35;
    this.secondWindUsed = false;
    this.berserk = false;
    this.berserkBonus = 0;
    this.skillLevels = {};
    WEAPONS[0].magSize = 12;
    this.pos.set(0, 0, 8);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.weaponIdx = 0;
    this.mags = [WEAPONS[0].magSize, WEAPONS[1].magSize];
    this.reserves = [Infinity, 24];
    this.wState = "idle";
    this.fireCd = 0;
    this.heat = 0;
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.playT = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.trauma = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilRoll = 0;
    for (const e of this.enemies) this.scene.remove(e.group);
    this.enemies = [];
    this.shootables = this.shootables.filter((m) => m.userData.hit?.kind !== "enemy");
    for (const p of this.pickups) this.scene.remove(p.group);
    this.pickups = [];
    for (const b of this.barrels) {
      b.hp = 30;
      b.fuse = -1;
      b.dead = false;
      b.mesh.visible = true;
    }
    for (let i = 0; i < this.pCount; i++) this.pLife[i] = 0;
    for (let i = 0; i < this.tCount; i++) this.tLife[i] = 0;
    for (const s of this.shells) {
      s.life = 0;
      s.mesh.visible = false;
    }
    this.aiming = false;
    this.aimAmt = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.swayVX = 0;
    this.swayVY = 0;
    this.slideT = 0;
    this.pumpT = -1;
    this.rackT = -1;
    this.recoilYaw = 0;
    this.recoilRoll = 0;
    this.startIntermission();
  }

  /* ============================== World build ============================== */

  private addObstacle(cx: number, cz: number, hw: number, hd: number) {
    this.obstacles.push({ minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd });
  }

  private buildWorld() {
    const texFloor = floorTexture();
    const texWall = wallTexture();
    const texCrate = crateTexture();
    const texHazard = hazardTexture();
    const texConcrete = concreteTexture();
    const texBarrelBoom = barrelTexture(true);
    const texBarrelOil = barrelTexture(false);
    this.flashTex = flashTexture();

    /* lights */
    const hemi = new THREE.HemisphereLight(new THREE.Color("#5a4a38"), new THREE.Color("#1a120a"), 0.55);
    this.scene.add(hemi);
    const amb = new THREE.AmbientLight(new THREE.Color("#2e241a"), 0.85);
    this.scene.add(amb);
    const dir = new THREE.DirectionalLight(new THREE.Color("#ffcf9a"), 0.5);
    dir.position.set(12, 20, 8);
    this.scene.add(dir);

    /* floor */
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2 + 4, ARENA * 2 + 4), new THREE.MeshLambertMaterial({ map: texFloor }));
    floor.rotation.x = -Math.PI / 2;
    floor.userData.hit = { kind: "solid" };
    this.scene.add(floor);
    this.shootables.push(floor);

    /* ceiling beams (visual) */
    const beamMat = new THREE.MeshLambertMaterial({ color: "#241c14" });
    for (let i = -2; i <= 2; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2 + 4, 0.7, 1.1), beamMat);
      beam.position.set(0, 10.4, i * 12);
      this.scene.add(beam);
    }

    /* walls */
    const wallMat = new THREE.MeshLambertMaterial({ map: texWall });
    const wallH = 11;
    const mkWall = (w: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, 1.2), wallMat);
      m.position.set(x, wallH / 2, z);
      m.rotation.y = ry;
      m.userData.hit = { kind: "solid" };
      this.scene.add(m);
      this.shootables.push(m);
    };
    mkWall(ARENA * 2 + 4, 0, -ARENA - 1, 0);
    mkWall(ARENA * 2 + 4, 0, ARENA + 1, 0);
    mkWall(ARENA * 2 + 4, -ARENA - 1, 0, Math.PI / 2);
    mkWall(ARENA * 2 + 4, ARENA + 1, 0, Math.PI / 2);

    /* hazard trim strips along wall bases */
    const trimMat = new THREE.MeshLambertMaterial({ map: texHazard });
    const mkTrim = (w: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, 1.3), trimMat);
      m.position.set(x, 0.25, z);
      m.rotation.y = ry;
      this.scene.add(m);
    };
    mkTrim(ARENA * 2 + 4, 0, -ARENA - 1, 0);
    mkTrim(ARENA * 2 + 4, 0, ARENA + 1, 0);
    mkTrim(ARENA * 2 + 4, -ARENA - 1, 0, Math.PI / 2);
    mkTrim(ARENA * 2 + 4, ARENA + 1, 0, Math.PI / 2);

    /* spawn gates — dark alcoves with red lamps */
    const gateMat = new THREE.MeshBasicMaterial({ color: "#050302" });
    const gatePositions: [number, number, number][] = [
      [0, -ARENA + 0.4, 0],
      [0, ARENA - 0.4, Math.PI],
      [-ARENA + 0.4, 0, Math.PI / 2],
      [ARENA - 0.4, 0, -Math.PI / 2],
    ];
    for (const [gx, gz, gry] of gatePositions) {
      const g = new THREE.Group();
      const hole = new THREE.Mesh(new THREE.BoxGeometry(5, 4.4, 1.4), gateMat);
      hole.position.y = 2.2;
      g.add(hole);
      const lampBall = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), new THREE.MeshBasicMaterial({ color: "#ff2e1f" }));
      lampBall.position.y = 4.9;
      g.add(lampBall);
      const gl = new THREE.PointLight(new THREE.Color("#ff2e1f"), 26, 14, 1.6);
      gl.position.y = 4.6;
      g.add(gl);
      this.gateLights.push(gl);
      g.position.set(gx, 0, gz);
      g.rotation.y = gry;
      this.scene.add(g);
    }

    /* pillars */
    const pillarMat = new THREE.MeshLambertMaterial({ map: texConcrete });
    const pillarSpots: [number, number][] = [
      [-14, -14], [14, -14], [-14, 14], [14, 14], [-22, 0], [22, 0],
    ];
    for (const [px, pz] of pillarSpots) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 10.5, 1.4), pillarMat);
      p.position.set(px, 5.25, pz);
      p.userData.hit = { kind: "solid" };
      this.scene.add(p);
      this.shootables.push(p);
      this.addObstacle(px, pz, 0.7, 0.7);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.5), trimMat);
      band.position.set(px, 0.28, pz);
      this.scene.add(band);
    }

    /* crates (cover) */
    const crateMat = new THREE.MeshLambertMaterial({ map: texCrate });
    const crateSpots: [number, number, number, number][] = [
      [-7, -5, 1.7, 1], [-6.4, 3.6, 1.3, 1], [7.5, -6, 1.7, 1], [8.6, -4.2, 1.1, 1],
      [4, 9, 1.4, 1], [-9, 12, 1.7, 1], [12, 10, 1.5, 1], [-3, -14, 1.4, 1],
      [16, 2, 1.6, 1], [-17, -7, 1.5, 1], [0, 16, 1.6, 1], [-13, 4, 1.2, 1],
    ];
    for (const [cx, cz, s] of crateSpots) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      c.position.set(cx, s / 2, cz);
      c.rotation.y = Math.random() * 0.6 - 0.3;
      c.userData.hit = { kind: "solid" };
      this.scene.add(c);
      this.shootables.push(c);
      this.addObstacle(cx, cz, s / 2 + 0.05, s / 2 + 0.05);
      if (Math.random() < 0.45) {
        const c2 = new THREE.Mesh(new THREE.BoxGeometry(s * 0.72, s * 0.72, s * 0.72), crateMat);
        c2.position.set(cx + 0.2, s + (s * 0.72) / 2, cz - 0.15);
        c2.rotation.y = Math.random() * 0.8;
        c2.userData.hit = { kind: "solid" };
        this.scene.add(c2);
        this.shootables.push(c2);
      }
    }

    /* center machine — the furnace heart */
    const machineMat = new THREE.MeshLambertMaterial({ map: texConcrete, color: "#8a7f70" });
    const machine = new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 4.4), machineMat);
    machine.position.set(0, 1.7, -2);
    machine.userData.hit = { kind: "solid" };
    this.scene.add(machine);
    this.shootables.push(machine);
    this.addObstacle(0, -2, 3, 2.2);
    const furnaceGlow = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 0.2), new THREE.MeshBasicMaterial({ color: "#ff6b1a" }));
    furnaceGlow.position.set(0, 1.4, 0.22);
    machine.add(furnaceGlow);
    const furnaceLight = new THREE.PointLight(new THREE.Color("#ff6b1a"), 60, 22, 1.5);
    furnaceLight.position.set(0, 2.2, 1.6);
    this.scene.add(furnaceLight);
    this.lamps.push({ light: furnaceLight, base: 60, broken: false, seed: 3.7 });
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.2, 7.4, 1.2), machineMat);
    chimney.position.set(1.6, 3.4 + 3.7, -2.8);
    this.scene.add(chimney);
    for (let i = 0; i < 3; i++) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7, 8), new THREE.MeshLambertMaterial({ color: "#4a4038" }));
      pipe.position.set(-1.8 + i * 0.7, 3.4 + 3.4, -3.4);
      this.scene.add(pipe);
    }

    /* catwalk above machine (decor) */
    const catMat = new THREE.MeshLambertMaterial({ color: "#2e2620" });
    const catwalk = new THREE.Mesh(new THREE.BoxGeometry(16, 0.25, 2.2), catMat);
    catwalk.position.set(0, 6.4, -8);
    this.scene.add(catwalk);
    for (let i = -7; i <= 7; i += 2) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), catMat);
      rail.position.set(i, 7, -7);
      this.scene.add(rail);
    }
    const railTop = new THREE.Mesh(new THREE.BoxGeometry(16, 0.1, 0.1), catMat);
    railTop.position.set(0, 7.5, -7);
    this.scene.add(railTop);

    /* spinning exhaust fans */
    const fanMat = new THREE.MeshLambertMaterial({ color: "#55504a", flatShading: true });
    for (const [fx, fz] of [[-24, -20], [24, 18]] as [number, number][]) {
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.5, 12), catMat);
      housing.rotation.x = Math.PI / 2;
      housing.position.set(fx, 6.5, fz > 0 ? ARENA - 0.5 : -ARENA + 0.5);
      this.scene.add(housing);
      const fan = new THREE.Group();
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 0.08), fanMat);
        blade.rotation.z = (b * Math.PI * 2) / 3;
        fan.add(blade);
      }
      fan.position.copy(housing.position);
      fan.position.z += fz > 0 ? -0.35 : 0.35;
      this.scene.add(fan);
      this.fans.push(fan);
    }

    /* hanging lamps */
    const lampSpots: [number, number, boolean][] = [
      [-10, 0, false], [10, 6, false], [0, 14, true], [-16, -16, false], [16, -12, false], [8, -18, false],
    ];
    const shadeMat = new THREE.MeshLambertMaterial({ color: "#3a332b" });
    for (const [lx, lz, broken] of lampSpots) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 4), catMat);
      cord.position.set(lx, 9, lz);
      this.scene.add(cord);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.8, 8, 1, true), shadeMat);
      shade.position.set(lx, 7.4, lz);
      this.scene.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), new THREE.MeshBasicMaterial({ color: "#ffd9a0" }));
      bulb.position.set(lx, 7.15, lz);
      this.scene.add(bulb);
      const light = new THREE.PointLight(new THREE.Color("#ffc37e"), 68, 24, 1.5);
      light.position.set(lx, 6.9, lz);
      this.scene.add(light);
      this.lamps.push({ light, base: 68, broken, seed: Math.random() * 10 });
    }

    /* explosive + oil barrels */
    const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10);
    const boomMat = new THREE.MeshLambertMaterial({ map: texBarrelBoom });
    const oilMat = new THREE.MeshLambertMaterial({ map: texBarrelOil });
    const barrelSpots: [number, number, boolean][] = [
      [-4.6, -8, true], [6.2, 2.4, true], [-11, -2, true], [10, 14, true], [-18, 12, true], [3.4, -1.2, true],
      [14, -14, false], [-8, 18, false], [20, 8, false], [-24, -6, false],
    ];
    for (const [bx, bz, boom] of barrelSpots) {
      const m = new THREE.Mesh(barrelGeo, boom ? boomMat : oilMat);
      m.position.set(bx, 0.55, bz);
      this.scene.add(m);
      if (boom) {
        const b: Barrel = { mesh: m, hp: 30, fuse: -1, dead: false };
        m.userData.hit = { kind: "barrel", barrel: b };
        this.shootables.push(m);
        this.barrels.push(b);
        this.addObstacle(bx, bz, 0.45, 0.45);
      } else {
        m.userData.hit = { kind: "solid" };
        this.shootables.push(m);
        this.addObstacle(bx, bz, 0.45, 0.45);
      }
    }

    /* oil stains / decals */
    const stainMat = new THREE.MeshBasicMaterial({ color: "#0c0906", transparent: true, opacity: 0.55 });
    for (let i = 0; i < 10; i++) {
      const st = new THREE.Mesh(new THREE.CircleGeometry(0.8 + Math.random() * 1.6, 8), stainMat);
      st.rotation.x = -Math.PI / 2;
      st.position.set((Math.random() - 0.5) * 52, 0.02, (Math.random() - 0.5) * 52);
      this.scene.add(st);
    }
  }

  /* ============================== View models ============================== */

  private buildViewModels() {
    const metal = new THREE.MeshLambertMaterial({ color: "#3d4248", flatShading: true });
    const darkMetal = new THREE.MeshLambertMaterial({ color: "#23262b", flatShading: true });
    const wood = new THREE.MeshLambertMaterial({ color: "#5c3a22", flatShading: true });
    const grip = new THREE.MeshLambertMaterial({ color: "#2e2117", flatShading: true });

    /* pistol */
    const pistol = new THREE.Group();
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.34), metal);
    slide.position.set(0, 0.055, -0.08);
    pistol.add(slide);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.06, 0.26), darkMetal);
    frame.position.set(0, -0.01, -0.05);
    pistol.add(frame);
    const gripP = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), grip);
    gripP.position.set(0, -0.1, 0.06);
    gripP.rotation.x = -0.28; /* bottom of grip rakes back toward the shooter */
    pistol.add(gripP);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.02), darkMetal);
    sight.position.set(0, 0.11, -0.22);
    pistol.add(sight);
    const muzzleP = new THREE.Object3D();
    muzzleP.position.set(0, 0.055, -0.3);
    pistol.add(muzzleP);
    const ejectP = new THREE.Object3D();
    ejectP.position.set(0.055, 0.06, -0.06);
    pistol.add(ejectP);

    /* shotgun */
    const shotgun = new THREE.Group();
    const barrelS = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.78, 8), darkMetal);
    barrelS.rotation.x = Math.PI / 2;
    barrelS.position.set(0, 0.05, -0.28);
    shotgun.add(barrelS);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), metal);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, -0.02, -0.2);
    shotgun.add(tube);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.16), wood);
    pump.position.set(0, -0.02, -0.3);
    shotgun.add(pump);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.24), metal);
    receiver.position.set(0, 0.02, 0.12);
    shotgun.add(receiver);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.12, 0.24), wood);
    stock.position.set(0, -0.03, 0.34);
    stock.rotation.x = -0.15;
    shotgun.add(stock);
    const muzzleS = new THREE.Object3D();
    muzzleS.position.set(0, 0.05, -0.72);
    shotgun.add(muzzleS);
    /* loading gate / ejection port on the receiver side */
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.1), new THREE.MeshBasicMaterial({ color: "#0b0b0d" }));
    port.position.set(0.045, 0.02, 0.1);
    shotgun.add(port);

    const gunLight = new THREE.PointLight(new THREE.Color("#ffe8c8"), 1.1, 2.4, 1.8);
    gunLight.position.set(0.1, 0.1, -0.2);

    for (const vm of [pistol, shotgun]) {
      vm.position.copy(this.vmBase);
      vm.visible = false;
      this.camera.add(vm);
    }
    pistol.visible = true;
    pistol.add(gunLight);
    this.scene.add(this.camera);
    this.vmGroups = [pistol, shotgun];
    this.vmMuzzles = [muzzleP, muzzleS];
    this.vmSlide = slide;
    this.vmPump = pump;
    this.gunLight = gunLight;
  }

  /* ============================== FX pools ============================== */

  private buildFxPools() {
    this.pPos = new Float32Array(this.pCount * 3);
    this.pCol = new Float32Array(this.pCount * 3);
    this.pBase = new Float32Array(this.pCount * 3);
    this.pVel = new Float32Array(this.pCount * 3);
    this.pLife = new Float32Array(this.pCount);
    this.pMax = new Float32Array(this.pCount);
    this.pGrav = new Float32Array(this.pCount);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute("color", new THREE.BufferAttribute(this.pCol, 3));
    const pm = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.points = new THREE.Points(pg, pm);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    this.tPos = new Float32Array(this.tCount * 6);
    this.tCol = new Float32Array(this.tCount * 6);
    this.tLife = new Float32Array(this.tCount);
    this.tMax = new Float32Array(this.tCount);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(this.tPos, 3));
    tg.setAttribute("color", new THREE.BufferAttribute(this.tCol, 3));
    const tm = new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.tracerLines = new THREE.LineSegments(tg, tm);
    this.tracerLines.frustumCulled = false;
    this.scene.add(this.tracerLines);

    const flashMat = new THREE.MeshBasicMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), flashMat);
      m.visible = false;
      this.scene.add(m);
      this.muzzleFlashes.push({ mesh: m, life: 0 });
    }
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(new THREE.Color("#ffb45e"), 0, 16, 1.6);
      this.scene.add(l);
      this.flashLights.push({ light: l, life: 0 });
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: "#ff7a2e", blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 24), ringMat.clone());
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      this.rings.push({ mesh: m, life: 0, speed: 14 });
    }

    /* ejected brass casings */
    const shellGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.045, 6);
    const shellMat = new THREE.MeshLambertMaterial({ color: "#c9a24a", flatShading: true });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(shellGeo, shellMat);
      m.visible = false;
      this.scene.add(m);
      this.shells.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
  }

  private ejectShell() {
    for (const s of this.shells) {
      if (s.life > 0) continue;
      const muzzle = this.vmMuzzles[this.weaponIdx];
      muzzle.getWorldPosition(this.tmpV);
      const fwd = this.tmpV2;
      this.camera.getWorldDirection(fwd);
      const right = this.tmpV3.crossVectors(fwd, UP).normalize();
      s.mesh.position.copy(this.tmpV).addScaledVector(right, 0.09).addScaledVector(UP, 0.02).addScaledVector(fwd, 0.12);
      s.vel.set(0, 0, 0).addScaledVector(right, 2.6 + Math.random()).addScaledVector(UP, 2.4 + Math.random() * 1.2).addScaledVector(fwd, 0.9).addScaledVector(this.vel, 0.45);
      s.spin.set(Math.random() * 22 - 11, Math.random() * 22 - 11, Math.random() * 22 - 11);
      s.life = 1.5;
      s.mesh.visible = true;
      return;
    }
  }

  private updateShells(dt: number) {
    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y -= 19 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      if (s.mesh.position.y < 0.025) {
        s.mesh.position.y = 0.025;
        s.vel.y = Math.abs(s.vel.y) * 0.32;
        s.vel.x *= 0.55;
        s.vel.z *= 0.55;
        s.spin.multiplyScalar(0.5);
        if (Math.abs(s.vel.y) < 0.4) s.vel.y = 0;
      }
      if (s.life <= 0) s.mesh.visible = false;
    }
  }

  private spawnParticles(pos: THREE.Vector3, count: number, colors: string[], speed: number, life: number, grav: number) {
    const col = new THREE.Color();
    for (let n = 0; n < count; n++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % this.pCount;
      this.pPos[i * 3] = pos.x;
      this.pPos[i * 3 + 1] = pos.y;
      this.pPos[i * 3 + 2] = pos.z;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.pVel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.pVel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * 0.8 + speed * 0.15;
      this.pVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      col.set(colors[(Math.random() * colors.length) | 0]);
      this.pBase[i * 3] = col.r;
      this.pBase[i * 3 + 1] = col.g;
      this.pBase[i * 3 + 2] = col.b;
      this.pLife[i] = life * (0.6 + Math.random() * 0.4);
      this.pMax[i] = this.pLife[i];
      this.pGrav[i] = grav;
    }
  }

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color: string) {
    const i = this.tNext;
    this.tNext = (this.tNext + 1) % this.tCount;
    this.tPos[i * 6] = from.x;
    this.tPos[i * 6 + 1] = from.y;
    this.tPos[i * 6 + 2] = from.z;
    this.tPos[i * 6 + 3] = to.x;
    this.tPos[i * 6 + 4] = to.y;
    this.tPos[i * 6 + 5] = to.z;
    const c = new THREE.Color(color);
    for (let k = 0; k < 2; k++) {
      this.tCol[i * 6 + k * 3] = c.r;
      this.tCol[i * 6 + k * 3 + 1] = c.g;
      this.tCol[i * 6 + k * 3 + 2] = c.b;
    }
    this.tLife[i] = 0.07;
    this.tMax[i] = 0.07;
  }

  private spawnMuzzleFlash() {
    const muzzle = this.vmMuzzles[this.weaponIdx];
    muzzle.getWorldPosition(this.tmpV);
    for (const f of this.muzzleFlashes) {
      if (f.life <= 0) {
        f.mesh.visible = true;
        /* every flash is a different burst: rotated, stretched, jittered off-axis */
        this.tmpV2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        f.mesh.position.copy(this.tmpV).addScaledVector(this.tmpV2, 0.04);
        f.mesh.rotation.z = Math.random() * Math.PI * 2;
        const s = (this.weaponIdx === 1 ? 1.5 : 0.85) * (0.75 + Math.random() * 0.5);
        f.mesh.scale.set(s * (0.8 + Math.random() * 0.4), s * (0.8 + Math.random() * 0.4), s);
        f.mesh.lookAt(this.camera.getWorldPosition(this.tmpV2));
        f.life = 0.05;
        break;
      }
    }
    for (const l of this.flashLights) {
      if (l.life <= 0) {
        l.light.position.copy(this.tmpV);
        l.light.intensity = (this.weaponIdx === 1 ? 90 : 45) * (0.78 + Math.random() * 0.44);
        l.life = 0.07;
        break;
      }
    }
  }

  private spawnExplosion(pos: THREE.Vector3) {
    this.spawnParticles(pos, 46, ["#ffb42e", "#ff6b1a", "#ff2e1f", "#5c5048"], 9, 0.8, 9);
    this.spawnParticles(pos, 24, ["#3a332b", "#241d15"], 5, 1.2, 3);
    for (const l of this.flashLights) {
      if (l.life <= 0) {
        l.light.position.copy(pos).add(this.tmpV3.set(0, 1, 0));
        l.light.intensity = 320;
        l.life = 0.25;
        break;
      }
    }
    for (const r of this.rings) {
      if (r.life <= 0) {
        r.mesh.visible = true;
        r.mesh.position.set(pos.x, 0.1, pos.z);
        r.mesh.scale.setScalar(0.5);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
        r.life = 0.5;
        break;
      }
    }
    this.trauma = Math.min(1.4, this.trauma + 1.0);
    sfx.explosion();
  }

  /* ============================== Enemies ============================== */

  private buildEnemy(kind: EnemyKind, x: number, z: number): Enemy {
    const def = ENEMY_DEFS[kind];
    const rig = buildRaiderRig(kind);
    const g = rig.group;
    const scaleHp = 1 + (this.wave - 1) * 0.16;
    const scaleSp = 1 + Math.min(this.wave, 14) * 0.022;

    const s = def.scale;
    g.scale.setScalar(s);
    g.position.set(x, -1.4 * s, z);

    /* runners alternate orbit sides to pincer; scrappers grow bolder each wave */
    const orbitDir = kind === "runner" ? -this.lastRunnerDir : Math.random() < 0.5 ? -1 : 1;
    if (kind === "runner") this.lastRunnerDir = orbitDir;
    const flankChance = Math.min(0.25 + (this.wave - 1) * 0.045, 0.6);
    const style: "rush" | "flank" =
      kind === "runner" ? "flank" : kind === "brute" ? "rush" : Math.random() < flankChance ? "flank" : "rush";

    const hitData = { kind: "enemy" as const, enemy: null as unknown as Enemy };
    const enemy: Enemy = {
      group: g, rig,
      kind,
      hp: def.hp * scaleHp,
      maxHp: def.hp * scaleHp,
      speed: def.speed * scaleSp,
      dmg: def.dmg,
      range: def.range,
      score: def.score,
      state: "rise",
      stateT: 0,
      attackCd: 0.6,
      flash: 0,
      hitstun: 0,
      kvx: 0,
      kvz: 0,
      walkT: Math.random() * Math.PI * 2,
      sinkT: 0,
      wobble: Math.random() * Math.PI * 2,
      mvx: 0,
      mvz: 0,
      ragdoll: null,
      orbitDir,
      style,
      stuckT: 0,
      feintT: 0,
      feintCd: 1.5 + Math.random() * 2,
      dodgeT: 0,
      dodgeVx: 0,
      dodgeVz: 0,
      dodgeDir: 1,
      chargeDirX: 0,
      chargeDirZ: 0,
      chargeLocked: false,
      enraged: false,
    };
    hitData.enemy = enemy;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.userData.hit = hitData;
        this.shootables.push(o as THREE.Mesh);
      }
    });

    this.scene.add(g);
    return enemy;
  }

  private removeEnemyFromShootables(e: Enemy) {
    const set = new Set<THREE.Object3D>();
    e.group.traverse((o) => set.add(o));
    this.shootables = this.shootables.filter((m) => !set.has(m));
  }

  private spawnEnemy() {
    if (this.enemies.filter((e) => e.state !== "dead").length >= 20) return;
    const kind = this.spawnQueue.shift();
    if (!kind) return;
    const gates: [number, number][] = [[0, -ARENA + 2.5], [0, ARENA - 2.5], [-ARENA + 2.5, 0], [ARENA - 2.5, 0]];
    const [gx, gz] = gates[(Math.random() * gates.length) | 0];
    const x = gx + (Math.abs(gx) > 1 ? 0 : (Math.random() - 0.5) * 10);
    const z = gz + (Math.abs(gz) > 1 ? 0 : (Math.random() - 0.5) * 10);
    const e = this.buildEnemy(kind, x, z);
    this.enemies.push(e);
    this.tmpV.set(x, 0.5, z);
    this.spawnParticles(this.tmpV, 14, ["#ff2e1f", "#7a1a10"], 4, 0.5, 6);
    sfx.spawnRoar();
    for (const gl of this.gateLights) {
      gl.intensity = 90;
    }
  }

  private damageEnemy(e: Enemy, dmg: number, point: THREE.Vector3, head: boolean, knock: number, dir: THREE.Vector3, weaponTag: string, force: number) {
    if (e.state === "dead") return;
    if (e.state === "charge" && !head) dmg *= 0.5; /* charging brutes shrug off body shots */
    e.hp -= dmg;
    e.flash = 1;
    e.hitstun = 0.13;
    e.kvx += dir.x * knock;
    e.kvz += dir.z * knock;
    /* heavy blows break telegraphed attacks — the shotgun is a parry */
    if (e.state === "windup" && knock >= 4) {
      e.state = "chase";
      e.stateT = 0;
      e.attackCd = Math.max(e.attackCd, 0.7);
    }
    if (e.state === "charge" && head) {
      e.state = "stagger";
      e.stateT = 0;
      e.attackCd = 1.0;
    }
    this.spawnParticles(point, head ? 12 : 7, ["#c42418", "#8a160c", "#ffb42e"], 4.5, 0.45, 10);
    sfx.hitEnemy(head);
    this.onEvent({ type: "hitmarker", head, kill: e.hp <= 0 });
    if (e.hp <= 0) this.killEnemy(e, weaponTag, head, point, dir, force * (head ? 1.55 : 1));
  }

  private killEnemy(e: Enemy, weaponTag: string, head: boolean, point: THREE.Vector3, dir: THREE.Vector3, force: number) {
    e.state = "dead";
    e.stateT = 0;
    e.ragdoll = createRagdoll(e.rig, ENEMY_DEFS[e.kind].scale);
    impulseRagdoll(e.ragdoll, point, dir, force, e.mvx, e.mvz);
    this.removeEnemyFromShootables(e);
    this.kills++;
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 2.6;
    const mult = Math.min(this.combo, 8);
    let gained = e.score + (mult - 1) * 25;
    if (head) gained = Math.floor(gained * 1.5);
    this.score += gained;
    const label = e.kind.toUpperCase();
    this.onEvent({ type: "kill", text: `${weaponTag} × ${label}${head ? " — HEADSHOT" : ""}${mult > 1 ? ` (+${gained})` : ""}` });
    sfx.kill();
    this.tmpV.copy(e.group.position).add(this.tmpV2.set(0, 1, 0));
    this.spawnParticles(this.tmpV, 16, ["#c42418", "#8a160c"], 5.5, 0.7, 9);

    /* lifesteal welds integrity back on */
    if (this.lifesteal > 0) this.hp = Math.min(this.maxHp, this.hp + this.lifesteal);

    /* drops — boosted by the salvage rig */
    const r = Math.random();
    if (r < 0.09 * this.dropMul && this.hp < this.maxHp * 0.92) this.dropPickup(e.group.position, "health");
    else if (r < 0.17 * this.dropMul) this.dropPickup(e.group.position, "ammo");
  }

  private dropPickup(at: THREE.Vector3, kind: "health" | "ammo") {
    const g = new THREE.Group();
    if (kind === "health") {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.5), new THREE.MeshLambertMaterial({ color: "#d8d2c4", flatShading: true }));
      g.add(box);
      const crossMat = new THREE.MeshBasicMaterial({ color: "#ff2e1f" });
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.12), crossMat);
      c1.position.y = 0.18;
      g.add(c1);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.3), crossMat);
      c2.position.y = 0.18;
      g.add(c2);
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.36), new THREE.MeshLambertMaterial({ color: "#8b6a2e", flatShading: true }));
      g.add(box);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.1, 0.38), new THREE.MeshBasicMaterial({ color: "#ffb42e" }));
      g.add(band);
    }
    g.position.set(at.x, 0.3, at.z);
    this.scene.add(g);
    this.pickups.push({ group: g, kind, life: 18 });
  }

  /* ============================== Weapons ============================== */

  private switchTo(idx: number) {
    if (idx === this.weaponIdx || this.wState === "lowering" || this.wState === "raising") return;
    this.pendingWeapon = idx;
    this.wState = "lowering";
    this.wT = 0.16;
    sfx.uiMove();
  }

  private startReload() {
    const w = WEAPONS[this.weaponIdx];
    if (this.wState === "reloading") return;
    if (this.mags[this.weaponIdx] >= w.magSize) return;
    if (this.reserves[this.weaponIdx] <= 0) return;
    this.wState = "reloading";
    this.wT = this.effReload(w);
    this.shellT = 0;
    sfx.reload(0);
  }

  private effReload(w: WeaponDef): number {
    return w.reloadTime / this.reloadMul;
  }

  private currentSpread(): number {
    const w = WEAPONS[this.weaponIdx];
    let s = w.spread + this.heat * 0.02;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    s += speed * 0.0035;
    if (!this.grounded) s += 0.02;
    s *= 1 - 0.55 * this.aimAmt; /* ADS tightens the cone */
    return s;
  }

  private tryFire(): boolean {
    const w = WEAPONS[this.weaponIdx];
    if (this.fireCd > 0) return false;
    if (this.wState === "lowering" || this.wState === "raising") return false;
    if (this.mags[this.weaponIdx] <= 0) {
      if (this.wState !== "reloading") this.startReload();
      else sfx.dry();
      this.fireCd = 0.3;
      return true;
    }
    if (this.wState === "reloading" && this.weaponIdx === 1) {
      /* shotgun reload interrupt — rack what you have */
      this.wState = "idle";
      this.rackT = 0;
    } else if (this.wState === "reloading") {
      return false;
    }

    this.mags[this.weaponIdx]--;
    this.fireCd = w.cooldown / this.fireMul;
    this.shotsFired++;
    this.heat = Math.min(1, this.heat + (this.weaponIdx === 0 ? 0.16 : 0.4));
    /* ---- realistic recoil: a permanent aim-climb you must pull down against,
         plus a fast recoverable snap — every shot rolls its own magnitude,
         horizontal drift and torque, and bracing (ADS) soaks ~35% of it ---- */
    const kickVar = 0.72 + Math.random() * 0.56; /* 72%–128% power per shot */
    const brace = 1 - 0.35 * this.aimAmt;
    const totalKick = w.kick * kickVar * brace;
    /* permanent displacement — goes into your real aim, so sustained fire climbs */
    this.pitch = Math.min(1.45, this.pitch + totalKick * 0.58);
    const sideKick = (Math.random() - 0.5) * 2 * totalKick * (this.weaponIdx === 1 ? 0.62 : 0.45);
    this.yaw += sideKick * 0.5;
    /* recoverable visual snap — the per-shot kick you see, then it settles */
    this.recoilPitch += totalKick * 0.62;
    this.recoilYaw += sideKick * 0.7;
    this.fovKick += w.fovPunch * (0.75 + Math.random() * 0.5);
    this.vmKick = (this.weaponIdx === 1 ? 0.16 : 0.07) * kickVar;
    this.trauma = Math.min(1.4, this.trauma + (this.weaponIdx === 1 ? 0.32 : 0.1) * kickVar);
    if (this.weaponIdx === 0) this.slideT = 1;
    else this.pumpT = 0;
    this.ejectShell();
    if (this.gunLight) this.gunLight.intensity = this.weaponIdx === 1 ? 26 : 14;
    if (this.weaponIdx === 1) sfx.shotgun();
    else sfx.pistol();
    this.notifyShot(this.weaponIdx === 1);
    this.spawnMuzzleFlash();
    /* lingering powder smoke at the muzzle */
    this.vmMuzzles[this.weaponIdx].getWorldPosition(this.tmpV3);
    this.spawnParticles(this.tmpV3.clone(), this.weaponIdx === 1 ? 6 : 3, ["#6e675e", "#4c463e"], 0.7, 0.55, -0.5);

    const spread = this.currentSpread();
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const muzzle = this.vmMuzzles[this.weaponIdx];
    muzzle.getWorldPosition(this.tmpV);
    const origin = this.tmpV.clone();

    const berserkOn = this.berserk && this.hp < this.maxHp * 0.4;
    const crit = Math.random() < this.critChance;
    const dmg = w.dmg * this.dmgMul * (berserkOn ? 1 + 0.3 * this.berserkBonus : 1) * (crit ? 3 : 1);
    const pellets = w.pellets + (this.weaponIdx === 1 ? this.extraPellets : 0);

    let anyHit = false;
    for (let p = 0; p < pellets; p++) {
      const dir = camDir.clone();
      dir.x += (Math.random() - 0.5) * 2 * spread;
      dir.y += (Math.random() - 0.5) * 2 * spread;
      dir.z += (Math.random() - 0.5) * 2 * spread;
      dir.normalize();
      this.raycaster.set(this.camera.position.clone(), dir);
      this.raycaster.far = 100;
      const hits = this.raycaster.intersectObjects(this.shootables, false);
      const hitPoint = this.tmpV2.copy(origin).addScaledVector(dir, 60).clone();
      if (hits.length > 0) {
        hitPoint.copy(hits[0].point);
        const data = hits[0].object.userData.hit;
        if (data) {
          if (data.kind === "enemy") {
            anyHit = true;
            const head = hits[0].point.y - data.enemy.group.position.y > 1.42 * ENEMY_DEFS[data.enemy.kind as EnemyKind].scale;
            const knock = this.weaponIdx === 1 ? 6.5 : 1.4;
            this.damageEnemy(data.enemy, dmg * (head ? 2 : 1), hits[0].point, head || crit, knock, dir, w.tag, this.weaponIdx === 1 ? 11 : 5.5);
          } else if (data.kind === "barrel") {
            anyHit = true;
            this.hitBarrel(data.barrel, w.tag);
          } else {
            this.spawnParticles(hits[0].point, 5, ["#ffb42e", "#ff6b1a", "#8a7f70"], 3.5, 0.3, 8);
            if (Math.random() < 0.3) sfx.ricochet();
          }
        }
      }
      this.spawnTracer(origin, hitPoint, this.weaponIdx === 1 ? "#ffc37e" : "#ffe8b0");
    }
    if (anyHit) this.shotsHit++;
    return true;
  }

  private hitBarrel(b: Barrel, _weaponTag: string) {
    if (b.dead) return;
    b.hp -= 20;
    sfx.barrelClang();
    this.spawnParticles(b.mesh.position.clone().add(this.tmpV3.set(0, 0.6, 0)), 6, ["#ffb42e", "#ff6b1a"], 4, 0.35, 8);
    if (b.hp <= 0 && b.fuse < 0) {
      b.fuse = 0.06;
    }
  }

  private explodeBarrel(b: Barrel) {
    b.dead = true;
    b.fuse = -1;
    b.mesh.visible = false;
    const pos = b.mesh.position.clone();
    pos.y = 0.8;
    /* clear its collision footprint */
    this.obstacles = this.obstacles.filter(
      (o) => !(Math.abs((o.minX + o.maxX) / 2 - pos.x) < 0.5 && Math.abs((o.minZ + o.maxZ) / 2 - pos.z) < 0.5)
    );
    this.spawnExplosion(pos);
    const R = 6;
    for (const e of this.enemies) {
      if (e.state === "dead") continue;
      const d = e.group.position.distanceTo(pos);
      if (d < R) {
        const fall = 1 - d / R;
        const dirX = (e.group.position.x - pos.x) / (d || 1);
        const dirZ = (e.group.position.z - pos.z) / (d || 1);
        const dir3 = new THREE.Vector3(dirX, 0.6 * fall + 0.25, dirZ).normalize();
        const pt3 = e.group.position.clone();
        pt3.y += 1.05;
        this.damageEnemy(e, 150 * fall + 40, pt3, false, 12 * fall, dir3, "BARREL", 15 * fall + 8);
      }
    }
    const pd = this.pos.distanceTo(pos);
    if (pd < R) {
      this.damagePlayer(Math.floor(45 * (1 - pd / R)) + 6, pos);
    }
    /* chain */
    for (const ob of this.barrels) {
      if (!ob.dead && ob.fuse < 0 && ob.mesh.position.distanceTo(pos) < R * 0.9) {
        ob.fuse = 0.14 + Math.random() * 0.1;
      }
    }
  }

  /* ============================== Player ============================== */

  private damagePlayer(dmg: number, from?: THREE.Vector3) {
    if (this.phase !== "playing") return;
    this.hp = Math.max(0, this.hp - dmg * (1 - this.dmgResist));
    this.regenT = 0;
    if (this.hp <= 0 && this.secondWind && !this.secondWindUsed) {
      /* the ninth life — systems reboot at the last moment */
      this.secondWindUsed = true;
      this.hp = this.secondWindHp;
      this.trauma = 1.2;
      this.regenT = 1.5;
      this.onEvent({ type: "pickup", text: "NINTH LIFE SPENT" });
      this.spawnParticles(this.pos.clone().add(this.tmpV3.set(0, 1, 0)), 20, ["#7dff5e", "#ffb42e"], 5, 0.7, 3);
      sfx.waveClear();
      return;
    }
    this.trauma = Math.min(1.5, this.trauma + 0.55);
    this.onEvent({ type: "damage" });
    sfx.hurt();
    if (from) {
      const dx = this.pos.x - from.x;
      const dz = this.pos.z - from.z;
      const d = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / d) * 4;
      this.vel.z += (dz / d) * 4;
    }
    if (this.hp <= 0) this.die();
  }

  private die() {
    this.phase = "dead";
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    const acc = this.shotsFired > 0 ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;
    this.onEvent({
      type: "dead",
      stats: { wave: this.wave, kills: this.kills, score: this.score, accuracy: acc, time: Math.floor(this.playT) },
    });
  }

  /* ============================== Waves ============================== */

  private startIntermission() {
    this.waveMode = "intermission";
    this.waveT = this.wave === 0 ? 2.4 : 3.6;
  }

  private beginWave() {
    this.wave++;
    this.secondWindUsed = false;
    const count = Math.min(6 + this.wave * 2 + Math.floor(this.wave * this.wave * 0.18), 26);
    const brutes = this.wave >= 3 ? Math.min(1 + Math.floor((this.wave - 3) / 2), 5) : 0;
    const runners = this.wave >= 2 ? Math.floor(count * 0.3) : 0;
    const scrappers = Math.max(1, count - brutes - runners);
    this.spawnQueue = [];
    for (let i = 0; i < scrappers; i++) this.spawnQueue.push("scrapper");
    for (let i = 0; i < runners; i++) this.spawnQueue.push("runner");
    for (let i = 0; i < brutes; i++) this.spawnQueue.push("brute");
    /* shuffle */
    for (let i = this.spawnQueue.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [this.spawnQueue[i], this.spawnQueue[j]] = [this.spawnQueue[j], this.spawnQueue[i]];
    }
    this.spawnT = 0.5;
    this.waveMode = "active";
    this.onEvent({ type: "wave", wave: this.wave, count: this.spawnQueue.length });
    sfx.waveHorn();
  }

  private clearWave() {
    const bonus = 250 * this.wave;
    this.score += bonus;
    this.hp = Math.min(this.maxHp, this.hp + 12);
    this.reserves[1] = Math.min(48, this.reserves[1] + 10);
    this.onEvent({ type: "cleared", wave: this.wave, bonus });
    sfx.waveClear();
    if (this.wave % 3 === 0) this.offerDraft();
    else this.startIntermission();
  }

  /* ============================== Skill draft ============================== */

  private rollCards(n: number): SkillCard[] {
    const eligible = SKILLS.filter((s) => (this.skillLevels[s.id] ?? 0) < s.maxLevel);
    const cards: SkillCard[] = [];
    const pool = [...eligible];
    while (cards.length < n && pool.length > 0) {
      let total = 0;
      for (const s of pool) total += s.weight;
      let roll = Math.random() * total;
      let pick = pool[0];
      for (const s of pool) {
        roll -= s.weight;
        if (roll <= 0) {
          pick = s;
          break;
        }
      }
      pool.splice(pool.indexOf(pick), 1);
      cards.push({
        id: pick.id,
        name: pick.name,
        desc: pick.desc,
        tag: pick.tag,
        rarity: pick.rarity,
        level: this.skillLevels[pick.id] ?? 0,
        maxLevel: pick.maxLevel,
      });
    }
    return cards;
  }

  private offerDraft() {
    const cards = this.rollCards(3);
    if (cards.length === 0) {
      this.startIntermission();
      return;
    }
    this.phase = "draft";
    this.firing = false;
    this.onEvent({ type: "draft", cards });
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  chooseCard(id: string) {
    if (this.phase !== "draft") return;
    this.applyCard(id);
    this.skillLevels[id] = (this.skillLevels[id] ?? 0) + 1;
    sfx.pickup("ammo");
    this.startIntermission();
    this.phase = "playing";
    this.onEvent({ type: "playing" });
    this.lockPointer();
  }

  private applyCard(id: string) {
    const lv = this.skillLevels[id] ?? 0;
    switch (id) {
      case "dmg":
        this.dmgMul *= 1.25;
        break;
      case "rate":
        this.fireMul *= 1.2;
        break;
      case "hp":
        this.maxHp += 25;
        this.hp = Math.min(this.maxHp, this.hp + 25);
        break;
      case "spd":
        this.speedMul *= 1.12;
        break;
      case "rel":
        this.reloadMul *= 1.3;
        WEAPONS[0].magSize += 2;
        this.mags[0] += 2;
        break;
      case "crit":
        this.critChance = Math.min(0.6, this.critChance + 0.15);
        break;
      case "vamp":
        this.lifesteal += 6;
        break;
      case "tank":
        this.dmgResist = 1 - (1 - this.dmgResist) * 0.75;
        break;
      case "magnet":
        this.pickupRadiusMul *= 2.2;
        this.dropMul *= 1.5;
        break;
      case "pellets":
        this.extraPellets += 3;
        break;
      case "ninth":
        this.secondWind = true;
        this.secondWindHp = lv >= 1 ? 60 : 35;
        this.secondWindUsed = false;
        break;
      case "berserk":
        this.berserk = true;
        this.berserkBonus = lv >= 1 ? 2 : 1;
        break;
    }
    this.onEvent({ type: "pickup", text: `${SKILLS.find((s) => s.id === id)?.name ?? id} INSTALLED` });
  }

  /* ============================== Collision ============================== */

  private collideCircle(p: THREE.Vector3, r: number) {
    p.x = Math.max(-ARENA + r, Math.min(ARENA - r, p.x));
    p.z = Math.max(-ARENA + r, Math.min(ARENA - r, p.z));
    for (const o of this.obstacles) {
      const cx = Math.max(o.minX, Math.min(p.x, o.maxX));
      const cz = Math.max(o.minZ, Math.min(p.z, o.maxZ));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      } else if (d2 <= 1e-8) {
        /* center inside box — push out along smallest axis */
        const pushX = Math.min(p.x - o.minX, o.maxX - p.x);
        const pushZ = Math.min(p.z - o.minZ, o.maxZ - p.z);
        if (pushX < pushZ) p.x = p.x - o.minX < o.maxX - p.x ? o.minX - r : o.maxX + r;
        else p.z = p.z - o.minZ < o.maxZ - p.z ? o.minZ - r : o.maxZ + r;
      }
    }
  }

  /* ============================== Update ============================== */

  private update(rawDt: number) {
    const t = this.clock.elapsedTime;
    const slow = this.phase === "dead" ? 0.35 : 1;
    const dt = rawDt * slow;

    /* ambient life */
    for (const l of this.lamps) {
      const n = Math.sin(t * 9 + l.seed) * 0.5 + Math.sin(t * 23.7 + l.seed * 2) * 0.5;
      let i = l.base * (0.86 + 0.14 * n);
      if (l.broken) i = Math.random() < 0.86 ? l.base * (0.5 + Math.random() * 0.5) : l.base * 0.06;
      l.light.intensity = i;
    }
    for (const gl of this.gateLights) gl.intensity += (26 - gl.intensity) * Math.min(1, dt * 6);
    for (const f of this.fans) f.rotation.z += dt * 4.5;

    if (this.phase === "attract") {
      const a = t * 0.14;
      this.camera.position.set(Math.cos(a) * 17, 5.5 + Math.sin(t * 0.3) * 1.2, Math.sin(a) * 17);
      this.camera.lookAt(0, 1.6, 0);
      this.updateFx(dt);
      return;
    }

    if (this.phase === "draft") {
      /* arena holds its breath behind the draft board */
      this.updateFx(dt);
      return;
    }

    if (this.phase === "paused") return;

    this.playT += dt;

    /* ---------- player movement ---------- */
    const sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const berserkSpd = this.berserk && this.hp < this.maxHp * 0.4 ? 1 + 0.15 * this.berserkBonus : 1;
    const speed = (sprint ? 8.4 : 5.8) * (1 - 0.45 * this.aimAmt) * this.speedMul * berserkSpd;
    let ix = 0;
    let iz = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) iz -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) iz += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) ix -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) ix += 1;
    const il = Math.hypot(ix, iz);
    if (il > 0) {
      ix /= il;
      iz /= il;
    }
    /* rotate input vector by yaw (must match camera Ry(yaw), order YXZ) */
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wx = ix * cos + iz * sin;
    const wz = -ix * sin + iz * cos;

    const accel = this.grounded ? 14 : 5;
    this.vel.x += (wx * speed - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wz * speed - this.vel.z) * Math.min(1, accel * dt);

    if (this.keys.has("Space") && this.grounded) {
      this.vel.y = 7.6;
      this.grounded = false;
    }
    this.vel.y -= 21 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      if (!this.grounded && this.vel.y < -7) {
        this.trauma = Math.min(1.2, this.trauma + 0.22);
      }
      this.pos.y = 0;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > 0.01) {
      this.grounded = false;
    }
    this.collideCircle(this.pos, 0.55);

    /* mouse look */
    const sens = 0.0022;
    this.yaw -= this.mouseDX * sens;
    this.pitch -= this.mouseDY * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    /* gun sway spring gets an impulse from look velocity (damped while aiming) */
    const swDamp = 1 - 0.55 * this.aimAmt;
    this.swayVX += this.mouseDX * 0.011 * swDamp;
    this.swayVY += this.mouseDY * 0.009 * swDamp;
    this.mouseDX = 0;
    this.mouseDY = 0;

    /* apply view immediately so firing rays match the on-screen aim */
    this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw, 0);
    this.camera.position.set(this.pos.x, 1.66 + this.pos.y + this.bobY, this.pos.z);

    /* head bob + footsteps */
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hSpeed > 1.2) {
      const prev = this.bobT;
      this.bobT += dt * hSpeed * 1.5;
      const crossed = Math.floor(prev / Math.PI) !== Math.floor(this.bobT / Math.PI);
      if (crossed) sfx.step(sprint);
    } else {
      this.bobT = 0;
    }
    const bobAmp = this.grounded ? Math.min(1, hSpeed / 6) * 0.055 : 0;
    this.bobY = Math.sin(this.bobT * 2) * bobAmp;

    /* regen */
    this.regenT += dt;
    if (this.regenT > 5 && this.hp > 0 && this.hp < 100) this.hp = Math.min(100, this.hp + 4 * dt);

    /* ---------- weapons ---------- */
    this.fireCd -= dt;
    this.heat = Math.max(0, this.heat - dt * 1.3);
    this.recoilPitch *= Math.exp(-10 * dt);
    this.recoilYaw *= Math.exp(-9 * dt);
    this.fovKick *= Math.exp(-8 * dt);
    this.vmKick *= Math.exp(-14 * dt);
    if (this.gunLight) this.gunLight.intensity = Math.max(1.1, this.gunLight.intensity * Math.exp(-16 * dt));
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;

    const w = WEAPONS[this.weaponIdx];
    if (this.wState === "lowering" || this.wState === "raising") {
      this.wT -= dt;
      if (this.wT <= 0) {
        if (this.wState === "lowering") {
          this.weaponIdx = this.pendingWeapon;
          for (let i = 0; i < this.vmGroups.length; i++) this.vmGroups[i].visible = i === this.weaponIdx;
          this.wState = "raising";
          this.wT = 0.2;
        } else {
          this.wState = "idle";
        }
      }
    } else if (this.wState === "reloading") {
      if (this.weaponIdx === 1) {
        /* shell-by-shell */
        this.shellT += dt;
        if (this.shellT >= this.effReload(w)) {
          this.shellT = 0;
          this.mags[1]++;
          this.reserves[1]--;
          sfx.reload(1);
          if (this.mags[1] >= w.magSize || this.reserves[1] <= 0) {
            this.wState = "idle";
            sfx.reload(2);
          }
        }
      } else {
        this.wT -= dt;
        if (this.wT <= 0) {
          const need = w.magSize - this.mags[0];
          this.mags[0] = w.magSize;
          sfx.reload(2);
          this.wState = "idle";
          void need;
        }
      }
    }

    if (this.firing && (w.auto || this.fireCd <= -0.001 || this.fireCd > w.cooldown - 0.05)) {
      if (w.auto || !this.semiLock) {
        if (this.tryFire() && !w.auto) this.semiLock = true;
      }
    }
    if (!this.firing) this.semiLock = false;

    /* ---------- aim-down-sights blend ---------- */
    const wantAim = this.aiming && (this.wState === "idle" || this.wState === "reloading") ? 1 : 0;
    this.aimAmt += (wantAim - this.aimAmt) * Math.min(1, dt * (wantAim ? 12 : 9));
    const aim = this.aimAmt;

    /* ---------- sway spring integration ---------- */
    const swSt = 70;
    const swDm = 12;
    this.swayVX += (-this.swayX * swSt - this.swayVX * swDm) * dt;
    this.swayVY += (-this.swayY * swSt - this.swayVY * swDm) * dt;
    this.swayX += this.swayVX * dt;
    this.swayY += this.swayVY * dt;
    const swX = Math.max(-0.09, Math.min(0.09, this.swayX));
    const swY = Math.max(-0.07, Math.min(0.07, this.swayY));

    /* ---------- weapon timers ---------- */
    this.slideT = Math.max(0, this.slideT - dt * 7.5);
    if (this.pumpT >= 0) {
      this.pumpT += dt;
      if (this.pumpT > 0.16 && this.pumpT - dt <= 0.16) sfx.pump();
      if (this.pumpT > 0.42) this.pumpT = -1;
    }
    if (this.rackT >= 0) {
      this.rackT += dt;
      if (this.rackT > 0.14 && this.rackT - dt <= 0.14) sfx.pump();
      if (this.rackT > 0.36) this.rackT = -1;
    }

    /* ---------- viewmodel pose ---------- */
    const vm = this.vmGroups[this.weaponIdx];
    /* hip base vs aimed base (centered, pulled in, raised) */
    const baseX = this.vmBase.x * (1 - aim) + 0.0 * aim;
    const baseY = this.vmBase.y * (1 - aim) + -0.165 * aim;
    const baseZ = this.vmBase.z * (1 - aim) + -0.34 * aim;
    const idleAmp = 1 - aim * 0.85;
    let vy = baseY + this.bobY * 0.6 * idleAmp + Math.sin(this.bobT) * bobAmp * 0.6 * idleAmp - swY * 0.4;
    let vx = baseX + Math.sin(this.bobT * 0.5) * bobAmp * 0.4 * idleAmp + swX * 0.45;
    let vz = baseZ + this.vmKick + swY * 0.12;
    let vrx = this.vmKick * 2.2 + swY * 1.1;
    let vry = -swX * 0.9 + this.recoilYaw * 6;
    let vrz = Math.sin(this.bobT) * bobAmp * 0.3 * idleAmp + swX * 0.5;

    if (this.wState === "lowering") vy -= 0.35 * (1 - this.wT / 0.16);
    if (this.wState === "raising") vy -= 0.35 * (this.wT / 0.2);

    if (this.wState === "reloading") {
      if (this.weaponIdx === 0) {
        /* pistol: tilt out, mag drop, slap home */
        const prog = 1 - this.wT / this.effReload(w);
        const dip = Math.sin(prog * Math.PI);
        vy -= 0.2 * dip;
        vrx = -0.85 * dip;
        vrz += 0.5 * dip;
        vx += 0.05 * dip;
      } else {
        /* shotgun: nose up, each shell shoved in with a wrist twist */
        vy -= 0.14;
        vrx = -0.5;
        const shellPh = Math.sin((this.shellT / this.effReload(w)) * Math.PI);
        vy -= 0.05 * shellPh;
        vrz += 0.3 * shellPh;
        vx -= 0.03 * shellPh;
      }
    }

    /* interrupt-rack flourish after cancelling a shotgun reload */
    if (this.rackT >= 0) {
      const rk = Math.sin(Math.min(1, this.rackT / 0.36) * Math.PI);
      vz += 0.02 * rk;
      vrz -= 0.25 * rk;
    }

    vm.position.set(vx, vy, vz);
    vm.rotation.set(vrx, vry, vrz);

    /* ---------- animated gun parts ---------- */
    if (this.vmSlide) {
      /* reciprocating slide: snaps back, springs forward with overshoot */
      const s = this.slideT;
      const back = s > 0.55 ? ((s - 0.55) / 0.45) * 0.055 : Math.sin((s / 0.55) * Math.PI) * 0.02;
      this.vmSlide.position.z = -0.08 + back;
    }
    if (this.vmPump) {
      let pz = 0;
      if (this.pumpT >= 0) {
        const pt = this.pumpT;
        if (pt < 0.2) pz = Math.sin((pt / 0.2) * Math.PI * 0.5) * 0.075;
        else pz = Math.cos(((pt - 0.2) / 0.22) * Math.PI * 0.5) * 0.075;
      } else if (this.rackT >= 0) {
        pz = Math.sin(Math.min(1, this.rackT / 0.36) * Math.PI) * 0.06;
      } else if (this.wState === "reloading" && this.weaponIdx === 1) {
        pz = Math.sin((this.shellT / this.effReload(w)) * Math.PI) * 0.02;
      }
      this.vmPump.position.z = -0.3 + pz;
    }

    /* ---------- waves ---------- */
    if (this.waveMode === "intermission") {
      this.waveT -= dt;
      if (this.waveT <= 0) this.beginWave();
    } else {
      this.spawnT -= dt;
      const interval = Math.max(0.28, 1.15 - this.wave * 0.06);
      if (this.spawnT <= 0 && this.spawnQueue.length > 0) {
        this.spawnEnemy();
        this.spawnT = interval;
      }
      if (this.spawnQueue.length === 0 && this.enemies.every((e) => e.state === "dead")) {
        this.clearWave();
      }
    }

    /* ---------- enemies ---------- */
    for (const e of this.enemies) this.updateEnemy(e, dt, t);
    this.enemies = this.enemies.filter((e) => {
      if (e.state === "dead" && e.sinkT > 1.7) {
        this.scene.remove(e.group);
        return false;
      }
      return true;
    });

    /* ---------- barrels ---------- */
    for (const b of this.barrels) {
      if (b.fuse >= 0 && !b.dead) {
        b.fuse -= dt;
        b.mesh.rotation.z = Math.sin(t * 40) * 0.06;
        if (b.fuse <= 0) this.explodeBarrel(b);
      }
    }

    /* ---------- pickups ---------- */
    for (const p of this.pickups) {
      p.life -= dt;
      p.group.rotation.y += dt * 2.4;
      p.group.position.y = 0.3 + Math.sin(t * 3 + p.group.position.x) * 0.08;
      if (p.life < 3) p.group.visible = Math.floor(t * 6) % 2 === 0;
      const d = Math.hypot(p.group.position.x - this.pos.x, p.group.position.z - this.pos.z);
      if (d < 1.1 * this.pickupRadiusMul) {
        if (p.kind === "health") {
          this.hp = Math.min(this.maxHp, this.hp + 25);
          this.onEvent({ type: "pickup", text: "+25 HP" });
        } else {
          this.reserves[1] = Math.min(48, this.reserves[1] + 6);
          this.onEvent({ type: "pickup", text: "+6 SHELLS" });
        }
        sfx.pickup(p.kind);
        p.life = 0;
      }
    }
    this.pickups = this.pickups.filter((p) => {
      if (p.life <= 0) {
        this.scene.remove(p.group);
        return false;
      }
      return true;
    });

    this.updateFx(dt);
    this.updateSwipes(dt);
    this.updateShells(dt);

    /* ---------- camera ---------- */
    this.trauma = Math.max(0, this.trauma - dt * 2.1);
    const shake = this.trauma * this.trauma;
    const shX = (Math.random() - 0.5) * 0.16 * shake;
    const shY = (Math.random() - 0.5) * 0.14 * shake;
    const shR = (Math.random() - 0.5) * 0.05 * shake;
    const targetFov = ((sprint && hSpeed > 4 ? 80 : 75) - 9 * this.aimAmt) + this.fovKick;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 9);
    this.camera.updateProjectionMatrix();
    this.camera.position.set(this.pos.x + shX, 1.66 + this.pos.y + this.bobY + shY, this.pos.z);
    this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw + this.recoilYaw, shR);

    /* ---------- HUD ---------- */
    const alive = this.enemies.filter((e) => e.state !== "dead").length + this.spawnQueue.length;
    this.onHud({
      hp: Math.ceil(this.hp),
      maxHp: this.maxHp,
      ammo: this.mags[this.weaponIdx],
      reserve: this.weaponIdx === 0 ? -1 : this.reserves[1],
      weapon: this.weaponIdx,
      weaponName: w.name,
      wave: this.wave,
      score: this.score,
      kills: this.kills,
      spreadGap: 5 + this.currentSpread() * 620,
      reloading: this.wState === "reloading",
      reloadT:
        this.wState !== "reloading"
          ? 0
          : this.weaponIdx === 1
            ? Math.min(1, this.shellT / this.effReload(w))
            : Math.min(1, 1 - this.wT / this.effReload(w)),
      combo: this.combo > 1 ? this.combo : 0,
      enemiesLeft: this.waveMode === "active" ? alive : 0,
    });
  }

  private semiLock = false;

  private updateEnemy(e: Enemy, dt: number, t: number) {
    e.flash = Math.max(0, e.flash - dt * 6);
    for (const m of e.rig.flashMats) m.emissive.setRGB(e.flash * 0.85, e.flash * 0.1, e.flash * 0.04);
    e.rig.eyeMat.color.copy(e.rig.eyeBase).lerp(FLASH_WHITE, e.flash * 0.8);
    e.attackCd -= dt;
    e.feintCd -= dt;

    /* desperation — wounded raiders fight faster, eyes burning */
    if (!e.enraged && e.state !== "dead" && e.hp < e.maxHp * 0.3) {
      e.enraged = true;
      e.speed *= 1.18;
      sfx.spawnRoar();
    }
    if (e.enraged) {
      e.rig.eyeMat.color.lerp(FLASH_WHITE, (Math.sin(t * 9 + e.rig.seed) + 1) * 0.3);
    }

    if (e.state === "dead") {
      e.stateT += dt;
      if (e.ragdoll) {
        e.ragdoll.deadT += dt;
        if (e.ragdoll.deadT > 3.1) {
          /* the foundry floor swallows its dead */
          e.ragdoll.sink = true;
          e.sinkT += dt;
          for (const pt of e.ragdoll.pts) {
            pt.p.y -= dt * 1.15;
            pt.pp.y -= dt * 1.15;
          }
        }
        stepRagdoll(e.ragdoll, e.group, dt, this.obstacles);
      }
      return;
    }

    if (e.state === "rise") {
      e.stateT += dt;
      const s = ENEMY_DEFS[e.kind].scale;
      e.group.position.y = -1.4 * s * (1 - Math.min(1, e.stateT / 0.45));
      if (e.stateT >= 0.45) {
        e.group.position.y = 0;
        e.state = "chase";
      }
      this.animRaider(e, dt, t);
      return;
    }

    const dx = this.pos.x - e.group.position.x;
    const dz = this.pos.z - e.group.position.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const dirX = dx / dist;
    const dirZ = dz / dist;

    /* knockback decay */
    e.kvx *= Math.exp(-8 * dt);
    e.kvz *= Math.exp(-8 * dt);
    const stunMul = e.hitstun > 0 ? 0.25 : 1;
    e.hitstun -= dt;

    const prevX = e.group.position.x;
    const prevZ = e.group.position.z;

    /* staggered assault — only a few raiders may commit at once */
    const tokens = this.attackersActive();
    const canAttack = e.attackCd <= 0 && tokens < this.maxAttackers();
    const windupMul = Math.max(0.72, 1 - (this.wave - 1) * 0.018);

    if (e.state === "chase") {
      e.wobble += dt * 3;
      const sp = e.speed * stunMul;
      const tangX = -dirZ * e.orbitDir;
      const tangZ = dirX * e.orbitDir;
      const orbitR = e.range * 1.3;
      let moveX: number;
      let moveZ: number;
      let moveMul = 1;

      if (!canAttack && dist < orbitR + 1.4) {
        /* denied the attack token — circle just out of reach, hunting an opening */
        const radial = Math.max(-0.85, Math.min(0.85, (dist - orbitR) * 0.8));
        moveX = tangX * 0.95 + dirX * radial;
        moveZ = tangZ * 0.95 + dirZ * radial;
        moveMul = 0.85;
      } else if (e.style === "flank" && dist > e.range * 1.05) {
        /* sweep wide and come in from the side */
        const closeness = Math.max(0.3, Math.min(1, (dist - e.range) / 4));
        moveX = dirX * closeness + tangX * (1 - closeness) * 1.15;
        moveZ = dirZ * closeness + tangZ * (1 - closeness) * 1.15;
      } else {
        const wob = Math.sin(e.wobble) * 0.35;
        moveX = dirX + -dirZ * wob;
        moveZ = dirZ + dirX * wob;
      }
      const ml = Math.hypot(moveX, moveZ) || 1;
      e.mvx = (moveX / ml) * sp * moveMul;
      e.mvz = (moveZ / ml) * sp * moveMul;
      e.group.position.x += e.mvx * dt + e.kvx * dt;
      e.group.position.z += e.mvz * dt + e.kvz * dt;

      /* scrapper feint — a fake jab to bait the player's dodge rhythm */
      if (e.kind === "scrapper" && e.feintT <= 0 && e.feintCd <= 0 && e.attackCd > 0.45 && dist < e.range * 2.3 && Math.random() < dt * 0.55) {
        e.feintT = 0.22;
        e.feintCd = 2.6 + Math.random() * 3.2;
      }
      if (e.feintT > 0) {
        e.feintT -= dt;
        e.group.position.x += Math.sin(e.group.rotation.y) * 2.1 * dt;
        e.group.position.z += Math.cos(e.group.rotation.y) * 2.1 * dt;
      }

      e.walkT += dt * sp * 1.9;

      /* separation from other enemies */
      for (const o of this.enemies) {
        if (o === e || o.state === "dead") continue;
        const sx = e.group.position.x - o.group.position.x;
        const sz = e.group.position.z - o.group.position.z;
        const sd = Math.hypot(sx, sz);
        const min = 0.85 * ENEMY_DEFS[e.kind].scale;
        if (sd < min && sd > 0.001) {
          e.group.position.x += (sx / sd) * (min - sd) * 0.5;
          e.group.position.z += (sz / sd) * (min - sd) * 0.5;
        }
      }
      this.collideCircle(e.group.position, 0.45 * ENEMY_DEFS[e.kind].scale);

      /* face player */
      const targetRot = Math.atan2(dx, dz);
      let dr = targetRot - e.group.rotation.y;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      e.group.rotation.y += dr * Math.min(1, dt * 10);

      /* anti-stuck — wedged behind cover? flip orbit side and back off */
      const moved = Math.hypot(e.group.position.x - prevX, e.group.position.z - prevZ);
      if (moved < sp * 0.3 * dt) e.stuckT += dt;
      else e.stuckT = 0;
      if (e.stuckT > 0.65) {
        e.stuckT = 0;
        e.orbitDir *= -1;
        e.group.position.x -= dirX * 0.4;
        e.group.position.z -= dirZ * 0.4;
      }

      if (dist < e.range && canAttack) {
        e.state = "windup";
        e.stateT = 0;
      } else if (e.kind === "brute" && this.wave >= 2 && e.attackCd <= 0 && tokens < this.maxAttackers() && dist > 5 && dist < 13.5) {
        /* bull rush from mid range */
        e.state = "charge";
        e.stateT = 0;
        e.chargeLocked = false;
        e.attackCd = 1.2;
        sfx.spawnRoar();
        this.trauma = Math.min(1.4, this.trauma + 0.12);
      }
    } else if (e.state === "windup") {
      e.stateT += dt;
      if (e.stateT >= WINDUP_TIME[e.kind] * windupMul) {
        e.state = "strike";
        e.stateT = 0;
        sfx.swing();
        this.spawnSwipe(e.group.position, Math.atan2(dx, dz), ENEMY_DEFS[e.kind].scale);
      }
    } else if (e.state === "strike") {
      e.stateT += dt;
      /* pounce — runners close the gap mid-swing so backpedalling isn't free */
      const lunge = e.kind === "runner" ? 9.5 : e.kind === "scrapper" ? 2.6 : 0;
      if (lunge > 0 && e.stateT < 0.16) {
        e.group.position.x += Math.sin(e.group.rotation.y) * lunge * dt;
        e.group.position.z += Math.cos(e.group.rotation.y) * lunge * dt;
        this.collideCircle(e.group.position, 0.45 * ENEMY_DEFS[e.kind].scale);
      }
      if (e.stateT >= 0.09 && e.stateT - dt < 0.09) {
        /* impact frame */
        if (dist < e.range * 1.25) this.damagePlayer(e.dmg, e.group.position);
      }
      if (e.stateT >= 0.4) {
        e.attackCd = (e.kind === "brute" ? 1.5 : e.kind === "runner" ? 0.8 : 0.95) * (e.enraged ? 0.72 : 1);
        e.state = "chase";
      }
    } else if (e.state === "charge") {
      e.stateT += dt;
      const tele = 0.7;
      if (e.stateT < tele) {
        /* stomping telegraph — keeps tracking the player, begging to be sidestepped */
        e.walkT += dt * 6;
        if (Math.floor(e.stateT / 0.12) !== Math.floor((e.stateT - dt) / 0.12)) {
          this.tmpV3.copy(e.group.position);
          this.tmpV3.y += 0.1;
          this.spawnParticles(this.tmpV3, 3, ["#4a3c2a", "#2a231b", "#5a4a36"], 1.4, 0.35, 4);
        }
        const targetRot = Math.atan2(dx, dz);
        let dr = targetRot - e.group.rotation.y;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        e.group.rotation.y += dr * Math.min(1, dt * 7);
      } else {
        if (!e.chargeLocked) {
          e.chargeLocked = true;
          e.chargeDirX = dirX;
          e.chargeDirZ = dirZ;
          sfx.spawnRoar();
        }
        const rush = 8.6;
        const px = e.group.position.x;
        const pz = e.group.position.z;
        e.group.position.x += e.chargeDirX * rush * dt;
        e.group.position.z += e.chargeDirZ * rush * dt;
        this.collideCircle(e.group.position, 0.5 * ENEMY_DEFS[e.kind].scale);
        e.walkT += dt * 15;
        const adv = Math.hypot(e.group.position.x - px, e.group.position.z - pz);
        const dNow = Math.hypot(this.pos.x - e.group.position.x, this.pos.z - e.group.position.z);
        if (dNow < 1.55) {
          /* trampled */
          this.damagePlayer(e.dmg * 2, e.group.position);
          this.trauma = Math.min(1.4, this.trauma + 0.5);
          sfx.barrelClang();
          e.state = "stagger";
          e.stateT = 0;
        } else if (adv < rush * dt * 0.4) {
          /* slammed into architecture — briefly defenseless */
          e.state = "stagger";
          e.stateT = 0;
          e.attackCd = 1.1;
          sfx.barrelClang();
          this.trauma = Math.min(1.4, this.trauma + 0.14);
          this.tmpV3.copy(e.group.position);
          this.tmpV3.y += 0.2;
          this.spawnParticles(this.tmpV3, 8, ["#4a3c2a", "#2a231b"], 2.2, 0.4, 6);
        } else if (e.stateT - tele > 1.15) {
          e.state = "stagger";
          e.stateT = 0;
          e.attackCd = 1.1;
        }
      }
    } else if (e.state === "stagger") {
      e.stateT += dt;
      e.walkT += dt * 2.5;
      if (e.stateT >= 1.05) {
        e.state = "chase";
        e.attackCd = Math.max(e.attackCd, 0.85);
      }
    }

    /* reactive dodge impulse — gunfire response */
    if (e.dodgeT > 0) {
      e.dodgeT -= dt;
      e.group.position.x += e.dodgeVx * dt;
      e.group.position.z += e.dodgeVz * dt;
      const dk = Math.exp(-9 * dt);
      e.dodgeVx *= dk;
      e.dodgeVz *= dk;
    }

    /* true frame velocity from actual displacement — every mover contributes
       (chase, flanking orbit, pounce lunge, feint hop, bull rush, dodge,
       knockback), so the ragdoll inherits exactly how the body was moving */
    const invDt = dt > 0.0001 ? 1 / dt : 0;
    e.mvx = (e.group.position.x - prevX) * invDt;
    e.mvz = (e.group.position.z - prevZ) * invDt;

    this.animRaider(e, dt, t);
  }

  /* how many raiders are currently committed to an attack */
  private attackersActive(): number {
    let n = 0;
    for (const e of this.enemies) if (e.state === "windup" || e.state === "strike" || e.state === "charge") n++;
    return n;
  }

  private maxAttackers(): number {
    return Math.min(2 + Math.floor(this.wave / 2), 5);
  }

  /* enemies hear the shot — nearby raiders may sidestep, and a heavy blast
     interrupts telegraphed attacks (the shotgun is a parry) */
  private notifyShot(shotgun: boolean) {
    for (const e of this.enemies) {
      if (e.state === "dead" || e.state === "rise") continue;
      const d = e.group.position.distanceTo(this.pos);
      const rr = shotgun ? 7.5 : 4.2;
      if (d > rr) continue;
      const chance = shotgun
        ? e.kind === "runner" ? 0.8 : e.kind === "scrapper" ? 0.5 : 0.25
        : e.kind === "runner" ? 0.3 : 0.15;
      if (Math.random() >= chance) continue;
      const ex = e.group.position.x - this.pos.x;
      const ez = e.group.position.z - this.pos.z;
      const el = Math.hypot(ex, ez) || 1;
      const side = Math.random() < 0.5 ? 1 : -1;
      e.dodgeVx = (-ez / el) * side * 6.5;
      e.dodgeVz = (ex / el) * side * 6.5;
      e.dodgeT = 0.28;
      e.dodgeDir = side;
      if (e.state === "windup") {
        e.state = "chase";
        e.stateT = 0;
        e.attackCd = Math.max(e.attackCd, 0.55);
      } else if (e.state === "charge" && !e.chargeLocked && shotgun) {
        /* a point-blank blast can still stop the bull */
        e.state = "stagger";
        e.stateT = 0;
        e.attackCd = 1.1;
        sfx.barrelClang();
      }
    }
  }

  /* drive the skeletal rig from the enemy's current state */
  private animRaider(e: Enemy, dt: number, t: number) {
    const dx = this.pos.x - e.group.position.x;
    const dz = this.pos.z - e.group.position.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    let yl = Math.atan2(dx, dz) - e.group.rotation.y;
    while (yl > Math.PI) yl -= Math.PI * 2;
    while (yl < -Math.PI) yl += Math.PI * 2;
    const headY = e.group.position.y + 1.6 * ENEMY_DEFS[e.kind].scale;
    updateRaiderAnim(e.rig, e.kind, {
      state: e.state,
      stateT: e.stateT,
      walkT: e.walkT,
      t,
      dt,
      yawLocal: yl,
      pitchToPlayer: Math.atan2(1.66 + this.pos.y - headY, Math.max(1.2, dist)),
      hitstun: Math.max(0, e.hitstun),
      feint: e.feintT > 0 ? Math.sin((1 - e.feintT / 0.22) * Math.PI) : 0,
      dodgeLean: e.dodgeT > 0 ? e.dodgeDir * Math.min(1, e.dodgeT / 0.18) : 0,
      windupMul: Math.max(0.72, 1 - (this.wave - 1) * 0.018),
    });
  }

  /* melee swipe arc — a fading additive slash in front of the attacker */
  private spawnSwipe(pos: THREE.Vector3, yaw: number, scale: number) {
    if (!this.swipeGeo) this.swipeGeo = new THREE.RingGeometry(0.55, 1.05, 14, 1, -1.0, 2.0);
    let s = this.swipes.find((x) => x.life <= 0);
    if (!s) {
      if (this.swipes.length >= 16) return;
      const mat = new THREE.MeshBasicMaterial({
        color: "#ffb066",
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.swipeGeo, mat);
      this.scene.add(mesh);
      s = { mesh, mat, life: 0, base: 1 };
      this.swipes.push(s);
    }
    s.life = 0.13;
    s.base = scale;
    s.mesh.visible = true;
    s.mesh.position.set(pos.x + Math.sin(yaw) * 0.55 * scale, pos.y + 1.12 * scale, pos.z + Math.cos(yaw) * 0.55 * scale);
    s.mesh.rotation.set(-0.35, yaw, Math.random() * 6.28);
    s.mesh.scale.setScalar(0.6 * scale);
  }

  private updateSwipes(dt: number) {
    for (const s of this.swipes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const k = 1 - Math.max(0, s.life) / 0.13;
      s.mat.opacity = (1 - k) * 0.85;
      s.mesh.scale.setScalar((0.6 + 0.75 * k) * s.base);
      s.mesh.rotation.z += dt * 16;
      if (s.life <= 0) s.mesh.visible = false;
    }
  }

  private updateFx(dt: number) {
    /* particles */
    for (let i = 0; i < this.pCount; i++) {
      if (this.pLife[i] <= 0) {
        this.pCol[i * 3] = 0;
        this.pCol[i * 3 + 1] = 0;
        this.pCol[i * 3 + 2] = 0;
        this.pPos[i * 3 + 1] = -50;
        continue;
      }
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pPos[i * 3 + 1] < 0.03) {
        this.pPos[i * 3 + 1] = 0.03;
        this.pVel[i * 3 + 1] *= -0.4;
      }
      const f = Math.max(0, this.pLife[i] / this.pMax[i]);
      this.pCol[i * 3] = this.pBase[i * 3] * f;
      this.pCol[i * 3 + 1] = this.pBase[i * 3 + 1] * f;
      this.pCol[i * 3 + 2] = this.pBase[i * 3 + 2] * f;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    /* tracers */
    for (let i = 0; i < this.tCount; i++) {
      if (this.tLife[i] <= 0) continue;
      this.tLife[i] -= dt;
      const f = Math.max(0, this.tLife[i] / this.tMax[i]);
      for (let k = 0; k < 6; k++) this.tCol[i * 6 + k] *= Math.pow(f, 0.4);
      if (this.tLife[i] <= 0) {
        for (let k = 0; k < 6; k++) this.tCol[i * 6 + k] = 0;
      }
    }
    (this.tracerLines.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    /* muzzle flashes */
    for (const f of this.muzzleFlashes) {
      if (f.life > 0) {
        f.life -= dt;
        if (f.life <= 0) f.mesh.visible = false;
      }
    }
    for (const l of this.flashLights) {
      if (l.life > 0) {
        l.life -= dt;
        l.light.intensity *= Math.exp(-22 * dt);
        if (l.life <= 0) l.light.intensity = 0;
      }
    }
    for (const r of this.rings) {
      if (r.life > 0) {
        r.life -= dt;
        r.mesh.scale.addScalar(dt * r.speed);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.life / 0.5) * 0.95;
        if (r.life <= 0) r.mesh.visible = false;
      }
    }
  }
}
