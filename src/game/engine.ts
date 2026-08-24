import * as THREE from "three";
import { sfx } from "./audio";
import { buildRaiderRig, updateRaiderAnim, WINDUP_TIME, type RaiderRig } from "./raider";
import { RecoilRig, RECOIL_SPECS, RECOIL_INTENSITY } from "./recoil";
import { GUN_MODS, tierLabel, type GunModId } from "./gunmods";
import { GUN_RECOIL, GunRecoilDriver } from "./gunrecoil";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { createRagdoll, impulseRagdoll, stepRagdoll, type Ragdoll } from "./ragdoll";
import {
  floorTexture,
  wallTexture,
  crateTexture,
  barrelTexture,
  hazardTexture,
  concreteTexture,
  flashTexture,
  shaftTexture,
  poolTexture,
} from "./textures";

/* ============================== Types ============================== */

export type GamePhase = "attract" | "playing" | "paused" | "dead" | "draft";

export type Rarity = "common" | "rare" | "epic";

export interface SkillCard {
  id: string;
  name: string;
  desc: string;
  /** skill category, or the owning gun's tag for gun-mod cards */
  tag: string;
  rarity: Rarity;
  level: number; /* times already installed */
  maxLevel: number;
  /* gun-mod cards carry an explicit trade-off ledger */
  pros?: string[];
  cons?: string[];
}

export interface HudData {
  hp: number;
  maxHp: number;
  ammo: number;
  reserve: number;
  weapon: number;
  weaponName: string;
  /** live cartridge readout: designation · muzzle velocity out of this barrel */
  ammoLine: string;
  /** short tags of gun-mods installed on the current weapon */
  mods: string[];
  wave: number;
  score: number;
  kills: number;
  spreadGap: number;
  reloading: boolean;
  reloadT: number;
  /** true when the chambered mag is nearly empty */
  lowAmmo: boolean;
  combo: number;
  enemiesLeft: number;
}

export type GameEvent =
  | { type: "playing" }
  | { type: "paused" }
  | { type: "dead"; stats: FinalStats }
  | { type: "hitmarker"; head: boolean; kill: boolean }
  | { type: "damage"; angle: number }
  | { type: "wave"; wave: number; count: number }
  | { type: "cleared"; wave: number; bonus: number }
  | { type: "kill"; text: string }
  | { type: "pickup"; text: string }
  | { type: "draft"; cards: SkillCard[] }
  | { type: "locker"; open: boolean; owned: string[]; tiers: Record<string, number>; equipped: (string | null)[] }
  | { type: "debug"; on: boolean };

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
  /* squad tactics — per-raider personality so the pack reads as a team,
     not a swarm: which side it arcs in from, how much space it likes,
     how eagerly it pushes, and where on the firing arc a gunner stands */
  flank: number;
  caution: number;
  aggression: number;
  hesitateT: number;
  hesitateCd: number;
  laneAngle: number;
  laneTarget: number;
  repositionT: number;
  /* scrapper burst fire */
  burst: number;
  burstT: number;
  /* overhead damage gauge */
  barBackMat: THREE.MeshBasicMaterial;
  barFill: THREE.Mesh;
  barMat: THREE.MeshBasicMaterial;
}

interface Barrel {
  mesh: THREE.Mesh;
  hp: number;
  fuse: number;
  dead: boolean;
}

/* one coordinated arrival group within a wave */
interface SpawnPulse {
  queue: EnemyKind[];
  /** which breach gate this element pours through */
  gate: [number, number];
  /** seconds until this pulse begins arriving */
  delay: number;
  /** seconds between individual raiders in the pulse */
  interval: number;
  /** internal spawn timer */
  t: number;
}

/* Supply drops are per-weapon. Rarity follows how much damage the gun deals
   per second of trigger time — the harder it outputs, the scarcer its crate
   (the pistol eats infinite rounds, so it never drops). */
type PickupKind = "health" | "shells" | "smg" | "belt" | "attach";

interface Pickup {
  group: THREE.Group;
  kind: PickupKind;
  life: number;
  modId?: GunModId;
  tier?: number;
}

interface WeaponDef {
  name: string;
  tag: string;
  /** flat damage per projectile — tuned by hand, no ballistics underneath */
  dmg: number;
  /** generic supply name used by drops and the HUD */
  ammoName: string;
  pellets: number;
  spread: number;
  kick: number;
  cooldown: number;
  magSize: number;
  reloadTime: number;
  auto: boolean;
  fovPunch: number;
  bloom: number;
  moveMul: number;
  /** shove per hit — 4+ also breaks a wound-up melee attack */
  knock: number;
  /** muzzle flash size multiplier */
  flash: number;
  /** tracer color */
  tracer: string;
  /** how hard a kill throws the ragdoll */
  ragdoll: number;

  /* ---- handling profile: this is what balances the guns, not damage ----
     Damage is fixed per gun. These stats decide what fraction of your
     shots actually LAND, so a heavy gun only out-damages a light one if
     you commit to it (brace, burst, stand still). High damage is bought
     with instability, never handed out free. */
  /** idle wander of the viewmodel — how much the gun drifts in your hands */
  swayAmp: number;
  /** how much aiming calms the sway, 0–1 — a braced gun settles, a hog doesn't */
  swaySettle: number;
  /** barrel heat added per shot — sustained fire blooms the cone */
  bloomRate: number;
  /** heat shed per second — how fast the barrel cools */
  bloomRecover: number;
  /** cone added per unit of movement speed — punishes run-and-gun */
  moveSpread: number;
  /** cone added per shot that decays — full-auto compounds this fast */
  spreadKick: number;
}

/* ============================== Engine ============================== */

/* graphics settings — internal render resolution and antialiasing filter */
export type ResMode = "480" | "720" | "1080" | "native";
export type AAMode = "off" | "fxaa" | "msaa";
const RES_HEIGHT: Record<Exclude<ResMode, "native">, number> = { "480": 480, "720": 720, "1080": 1080 };

const VW = 854;
const VH = 480;
const ARENA = 31;
const UP = new THREE.Vector3(0, 1, 0);
const TRACER_SPEED = 340; /* world units/sec the streak head travels */

/* Balance contract — damage is fixed; HANDLING is the currency. Each gun's
   effective DPS = dmg × rate × hit-rate, and hit-rate is set by the handling
   profile below. So the choice is never "which does more damage" but
   "how much instability am I willing to manage for the damage I want":
   · P-9   26 dmg — the stable anchor. Barely blooms, snaps to ADS instantly,
           fires true on the move. Lower DPS, but nearly every shot lands.
   · M870  14 × 8 — huge burst damage up close, but a wide cone, slow to aim,
           and moving shots scatter. Pay for it with positioning + timing.
   · VK-9  15 dmg — middling. Quick to aim, but sustained fire heats fast and
           it drifts more than the sidearm. Bursts stay tight, dumps don't.
   · MG-7  22 dmg — the most damage per second on paper, and the hardest to
           land. Wanders at rest, lurches when you flick, blooms hard under
           full-auto, punishes movement, and takes forever to shoulder. You
           only get its DPS if you plant, brace, and fire in bursts. */
const WEAPONS: WeaponDef[] = [
  { name: "P-9 SCRAPLOCK", tag: "P-9", dmg: 26, ammoName: "PISTOL ROUNDS", pellets: 1, spread: 0.008, kick: 0.014, cooldown: 0.155, magSize: 12, reloadTime: 0.95, auto: true, fovPunch: 1.2, bloom: 0.052, moveMul: 1, knock: 1.6, flash: 0.62, tracer: "#ffe8b0", ragdoll: 5.5, swayAmp: 0.5, swaySettle: 1.0, bloomRate: 0.36, bloomRecover: 1.0, moveSpread: 0.0028, spreadKick: 0.005 },
  { name: "M870 BREAKER", tag: "BREAKER", dmg: 14, ammoName: "SHOTGUN SHELLS", pellets: 8, spread: 0.055, kick: 0.06, cooldown: 0.82, magSize: 6, reloadTime: 0.5, auto: false, fovPunch: 5, bloom: 0.02, moveMul: 1, knock: 6.5, flash: 1.0, tracer: "#ffc37e", ragdoll: 11, swayAmp: 0.65, swaySettle: 0.8, bloomRate: 0.10, bloomRecover: 0.9, moveSpread: 0.010, spreadKick: 0.030 },
  { name: "VK-9 WESPE", tag: "VK-9", dmg: 15, ammoName: "SMG ROUNDS", pellets: 1, spread: 0.013, kick: 0.0075, cooldown: 0.082, magSize: 24, reloadTime: 1.4, auto: true, fovPunch: 0.5, bloom: 0.09, moveMul: 1, knock: 1.0, flash: 0.46, tracer: "#ffe08f", ragdoll: 4.2, swayAmp: 0.8, swaySettle: 0.7, bloomRate: 0.45, bloomRecover: 0.7, moveSpread: 0.005, spreadKick: 0.010 },
  { name: "MG-7 HOG", tag: "MG-7", dmg: 22, ammoName: "LMG BELT", pellets: 1, spread: 0.03, kick: 0.02, cooldown: 0.118, magSize: 60, reloadTime: 2.6, auto: true, fovPunch: 1.0, bloom: 0.085, moveMul: 0.85, knock: 3.0, flash: 0.8, tracer: "#ffb45e", ragdoll: 8, swayAmp: 2.2, swaySettle: 0.28, bloomRate: 0.10, bloomRecover: 0.35, moveSpread: 0.018, spreadKick: 0.020 },
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
  /* GUNLINE: disciplined mid-range fire. Holds a 7–10 m lane, fires bursts
     with lead, and backpedals under pressure while still shooting. */
  scrapper: { hp: 90, speed: 3.2, dmg: 7, range: 9, score: 100, scale: 1 },
  /* LANCER: no longer a swarm of gnats — a deliberate leaper. Slower than a
     sprint, tougher than before, and every landing hurts. Kite it or eat 9. */
  runner: { hp: 68, speed: 5.0, dmg: 9, range: 5.2, score: 150, scale: 0.88 },
  /* SIEGE: the anchor. Too armored to flinch off small arms, closes with
     steered bull rushes, and every rush ends in a ground slam — miss the
     trample and you still eat the shockwave. */
  brute: { hp: 470, speed: 2.7, dmg: 26, range: 3.0, score: 400, scale: 1.45 },
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
  /* attachments are LOOT — picked up off dead raiders, stocked in the Gun
     Locker, and only mounted on a gun by deliberate choice. Each part is a
     single physical item: it rides one weapon at a time, and Mk.II is an
     upgrade of the same part, not a second copy. */
  private ownedMods: GunModId[] = [];
  private ownedTier: Partial<Record<GunModId, number>> = {};
  private equippedMods: (GunModId | null)[] = [null, null, null, null];
  private lockerOpen = false;
  /* cached short-tags of the current gun's mods, rebuilt only on change */
  private modsCache: string[] = [];
  private modsCacheKey = "";
  private bobT = 0;
  private bobY = 0;
  private trauma = 0;
  private fovKick = 0;
  private lastLandVy = 0;
  /* polish timers — hitstop on kill, low-hp heartbeat, furnace embers */
  private hitstop = 0;
  private heartT = 0;
  private emberT = 0;
  private keys = new Set<string>();
  private firing = false;
  private mouseDX = 0;
  private mouseDY = 0;
  private lookSens = 1;
  /* input coalescing — wheel and swap spam get throttled to deliberate steps */
  private lastWheelT = 0;
  private lastSwitchT = 0;

  /* options-menu mouse sensitivity multiplier */
  setSensitivity(v: number) {
    this.lookSens = Math.max(0.3, Math.min(2.5, v));
  }

  /* ---------------- graphics settings: resolution + antialiasing ---------------- */
  private resMode: ResMode = "480";
  private aaMode: AAMode = "off";
  private composer: EffectComposer | null = null;

  setResolution(m: ResMode) {
    this.resMode = m;
    try {
      localStorage.setItem("fo_res", m);
    } catch {
      /* private mode */
    }
    this.applyGraphics();
  }

  setAA(m: AAMode) {
    this.aaMode = m;
    try {
      localStorage.setItem("fo_aa", m);
    } catch {
      /* private mode */
    }
    this.applyGraphics();
  }

  private onWinResize = () => this.applyGraphics();

  /* rebuild the output chain: buffer size, upscale filter and post passes */
  private applyGraphics() {
    if (this.disposed || !this.renderer) return;
    const aspect = Math.max(0.5, window.innerWidth / Math.max(1, window.innerHeight));
    let w: number;
    let h: number;
    if (this.resMode === "native") {
      w = Math.max(320, window.innerWidth);
      h = Math.max(240, window.innerHeight);
    } else {
      h = RES_HEIGHT[this.resMode];
      w = Math.max(640, Math.round(h * aspect));
    }
    this.renderer.setSize(w, h, false);
    /* 480i keeps the chunky PS2 upscale; sharper modes get smooth filtering */
    this.canvas.style.imageRendering = this.resMode === "480" ? "pixelated" : "auto";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    /* tear down the old post chain */
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    if (this.aaMode === "off") return;

    /* MSAA samples live on the composer's render target; FXAA is a screen pass */
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: this.aaMode === "msaa" ? 4 : 0 });
    const comp = new EffectComposer(this.renderer, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    if (this.aaMode === "fxaa") {
      const fx = new ShaderPass(FXAAShader);
      (fx.material.uniforms["resolution"].value as THREE.Vector2).set(1 / w, 1 / h);
      comp.addPass(fx);
    }
    comp.addPass(new OutputPass());
    comp.setSize(w, h);
    this.composer = comp;
  }

  /* weapons */
  private weaponIdx = 0;
  private mags = [12, 6, 24, 60];
  private reserves = [Infinity, 24, 96, 120];
  private fireCd = 0;
  private wState: "idle" | "lowering" | "raising" | "reloading" = "idle";
  private wT = 0;
  private pendingWeapon = 0;
  private shellT = 0;
  private heat = 0;
  /** per-shot cone penalty that decays — full-auto guns stack this quickly */
  private kickSpread = 0;
  private vmGroups: THREE.Group[] = [];
  private vmMuzzles: THREE.Object3D[] = [];
  private vmBase = new THREE.Vector3(0.3, -0.28, -0.55);
  private vmSlide: THREE.Mesh | null = null;
  private vmPump: THREE.Mesh | null = null;
  private vmBolt: THREE.Mesh | null = null;
  private vmMgBolt: THREE.Mesh | null = null;
  /* per-weapon viewmodel recoil choreography (see gunrecoil.ts) */
  private vmRecoil: GunRecoilDriver[] = [0, 1, 2, 3].map((i) => new GunRecoilDriver(GUN_RECOIL[i]));
  private rackT = -1;
  private aimAmt = 0;
  private aiming = false;
  /* data-driven recoil rig — caliber/mass/bore-height/contact specs drive
     every shot's climb, shove, drift, roll and settle (see recoil.ts) */
  private rig = new RecoilRig();
  private rigSpec = RECOIL_SPECS[0];
  /* small view-space corrections so a braced gun tracks the target tighter */
  private aimYaw = 0;
  private aimPitch = 0;
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
  /* enemy projectiles — pooled tracer streaks with real travel time */
  private bullets: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }[] = [];
  private bFrom: Float32Array = new Float32Array(0);
  private bDir: Float32Array = new Float32Array(0);
  private bSpd: Float32Array = new Float32Array(0);
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
  private tFrom!: Float32Array;
  private tDir!: Float32Array;
  private tBase!: Float32Array;
  private tLen!: Float32Array;
  private tDist!: Float32Array;
  private tNext = 0;
  private tracerLines!: THREE.LineSegments;

  private flashTex: THREE.Texture[] = [];
  private muzzleFlashes: { group: THREE.Group; matA: THREE.MeshBasicMaterial; matB: THREE.MeshBasicMaterial; life: number; max: number; len: number; wid: number }[] = [];
  private flashLights: { light: THREE.PointLight; life: number }[] = [];
  private moonLight: THREE.DirectionalLight | null = null;
  private motePoints: THREE.Points | null = null;
  private mPos!: Float32Array;
  private mPh!: Float32Array;
  private mSpd!: Float32Array;
  private mBox!: Uint8Array;
  private moteT = 0;
  private rings: { mesh: THREE.Mesh; life: number; speed: number }[] = [];

  /* waves */
  private wave = 0;
  private score = 0;
  private kills = 0;
  private combo = 0;
  private comboT = 0;
  private waveMode: "intermission" | "active" = "intermission";
  private waveT = 0;
  /* a wave arrives as coordinated pulses (vanguard → gunline → heavies),
     each from its own gate, instead of one undifferentiated trickle */
  private spawnPulses: SpawnPulse[] = [];
  private spawnT = 0;
  /* squad "brain" — cheap per-frame signals that make the three archetypes
     interlock: are melee in the player's face, are guns suppressing */
  private squadMeleeEngaged = false;
  private squadGunnersFiring = 0;
  private squadBrutesActive = false;
  private playT = 0;

  private raycaster = new THREE.Raycaster();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();
  private tmpQ2 = new THREE.Quaternion();

  constructor(canvas: HTMLCanvasElement, onEvent: (e: GameEvent) => void, onHud: (h: HudData) => void) {
    this.canvas = canvas;
    this.onEvent = onEvent;
    this.onHud = onHud;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#161008");
    /* slightly lifted so the annex back wall stays readable from the hall */
    this.scene.fog = new THREE.FogExp2(new THREE.Color("#161008"), 0.021);

    this.camera = new THREE.PerspectiveCamera(75, VW / VH, 0.05, 120);
    this.camera.rotation.order = "YXZ";

    this.buildWorld();
    this.buildViewModels();
    /* the pump-action beats of the BREAKER are driven by its recoil rig */
    this.vmRecoil[1].onMech = () => sfx.pump();
    this.buildFxPools();
    this.bindInput();

    /* graphics settings persist between sessions */
    try {
      const r = localStorage.getItem("fo_res") as ResMode | null;
      const a = localStorage.getItem("fo_aa") as AAMode | null;
      if (r === "480" || r === "720" || r === "1080" || r === "native") this.resMode = r;
      if (a === "off" || a === "fxaa" || a === "msaa") this.aaMode = a;
    } catch {
      /* private mode — defaults stand */
    }
    this.applyGraphics();
    window.addEventListener("resize", this.onWinResize);

    this.clock.start();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.update(dt);
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unbindInput();
    window.removeEventListener("resize", this.onWinResize);
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.renderer.dispose();
  }

  /* ============================== Input ============================== */

  private onKeyDown = (e: KeyboardEvent) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "Tab"].includes(e.code))
      e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    /* Gun Locker opens from the floor or the pause screen */
    if (e.code === "KeyB" && (this.phase === "playing" || this.phase === "paused")) {
      this.toggleLocker();
      return;
    }
    /* F9 — debug toggle: god mode + full Mk.II locker */
    if (e.code === "F9") {
      this.toggleDebug();
      return;
    }
    if (this.phase !== "playing") return;
    if (e.code === "Digit1") this.switchTo(0);
    if (e.code === "Digit2") this.switchTo(1);
    if (e.code === "Digit3") this.switchTo(2);
    if (e.code === "Digit4") this.switchTo(3);
    if (e.code === "KeyR") this.startReload();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  /* losing focus mid-combat must never leave a key or button stuck */
  private onBlur = () => {
    this.sanitizeInput();
    if (this.phase === "playing") {
      try {
        document.exitPointerLock(); /* routes through onLockChange → paused */
      } catch {
        /* already unlocked */
      }
    }
  };
  private sanitizeInput() {
    this.keys.clear();
    this.firing = false;
    this.aiming = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === this.canvas) {
      /* clamp single-event deltas — the first event after a re-lock can
         carry a huge spike that would otherwise spin the view 180° */
      this.mouseDX += Math.max(-75, Math.min(75, e.movementX));
      this.mouseDY += Math.max(-75, Math.min(75, e.movementY));
    }
  };
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault(); /* no middle-click autoscroll */
    const locked = document.pointerLockElement === this.canvas;
    if (this.phase === "playing" && locked) {
      /* buttons only arm while actually in control of the gun */
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
    } else if (this.phase === "playing" && !locked) {
      /* safety: a click while un-locked re-engages the pointer lock */
      this.lockPointer();
    }
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.firing = false;
    if (e.button === 2) this.aiming = false;
  };
  private onWheel = () => {
    if (this.phase !== "playing") return;
    /* one deliberate step per notch — a fast flick must not cycle the
       whole arsenal through a flurry of swap animations */
    const now = performance.now();
    if (now - this.lastWheelT < 150) return;
    this.lastWheelT = now;
    this.switchTo((this.weaponIdx + 1) % WEAPONS.length);
  };
  private onCtx = (e: Event) => e.preventDefault();
  private onDocCtx = (e: Event) => e.preventDefault();
  private onLockChange = () => {
    if (document.pointerLockElement === this.canvas) {
      if (this.phase !== "playing") {
        this.phase = "playing";
        this.lockerOpen = false;
        this.onEvent({ type: "playing" });
      }
    } else if (this.phase === "playing") {
      /* dropped the lock (Esc, Alt+Tab, another window) — park every input
         so nothing is still held when play resumes */
      this.sanitizeInput();
      this.phase = "paused";
      this.onEvent({ type: "paused" });
    }
  };

  private bindInput() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
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
    window.removeEventListener("blur", this.onBlur);
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
    /* a button click that started the run must not also arm the trigger */
    this.sanitizeInput();
    this.lockPointer();
  }

  resume() {
    sfx.ensure();
    this.sanitizeInput();
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
    this.ownedMods = [];
    this.ownedTier = {};
    this.equippedMods = [null, null, null, null];
    this.refreshModVisuals();
    WEAPONS[0].magSize = 12;
    this.pos.set(0, 0, 8);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.weaponIdx = 0;
    this.mags = WEAPONS.map((wp) => wp.magSize);
    this.reserves = [Infinity, 24, 96, 120];
    this.wState = "idle";
    this.fireCd = 0;
    this.heat = 0;
    this.kickSpread = 0;
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.playT = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.trauma = 0;
    this.rig.hardReset();
    this.rigSpec = RECOIL_SPECS[0];
    this.aimYaw = 0;
    this.aimPitch = 0;
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
    for (const b of this.bullets) {
      b.life = 0;
      b.mesh.visible = false;
    }
    this.aiming = false;
    this.aimAmt = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.swayVX = 0;
    this.swayVY = 0;
    this.rackT = -1;
    for (const d of this.vmRecoil) d.settle();
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
    /* a handful of irregular powder-burn crowns so no two blasts match */
    for (let i = 0; i < 5; i++) this.flashTex.push(flashTexture());

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
    /* the east wall is split around a wide doorway (z −5..+5) that opens
       into the boiler annex; a lintel keeps the wall above the opening */
    mkWall(28, ARENA + 1, -19, Math.PI / 2);
    mkWall(28, ARENA + 1, 19, Math.PI / 2);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.2, wallH - 4.6, 10), wallMat);
    lintel.position.set(ARENA + 1, 4.6 + (wallH - 4.6) / 2, 0);
    lintel.userData.hit = { kind: "solid" };
    this.scene.add(lintel);
    this.shootables.push(lintel);
    /* walls are collidable boxes (the annex doorway has to be real geometry,
       not the old square clamp) */
    this.addObstacle(0, -ARENA - 1, ARENA + 2, 0.6);
    this.addObstacle(0, ARENA + 1, ARENA + 2, 0.6);
    this.addObstacle(-ARENA - 1, 0, 0.6, ARENA + 2);
    this.addObstacle(ARENA + 1, -19, 0.6, 14);
    this.addObstacle(ARENA + 1, 19, 0.6, 14);

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
    mkTrim(28, ARENA + 1, -19, Math.PI / 2);
    mkTrim(28, ARENA + 1, 19, Math.PI / 2);
    /* door jambs in hazard paint + a wall sign over the opening */
    for (const jz of [-5.3, 5.3]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(1.3, 4.6, 0.6), trimMat);
      jamb.position.set(ARENA + 1, 2.3, jz);
      this.scene.add(jamb);
      this.addObstacle(ARENA + 1, jz, 0.65, 0.3);
    }
    const doorSign = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 5.4), trimMat);
    doorSign.position.set(ARENA + 0.3, 5.5, 0);
    this.scene.add(doorSign);

    /* ============================== boiler annex ==============================
       A second room east of the foundry hall (x 32..53, z ±17) — tighter,
       darker, lit by two furnace boilers and a cold window on the back wall. */
    const ANX_X = 53; /* back wall */
    const ANX_Z = 17; /* half-depth */
    /* floor — same plates, grubbier tint, tile scale matched to the hall */
    const texFloorAnx = texFloor.clone();
    texFloorAnx.repeat.set(3.4, 5.3);
    texFloorAnx.needsUpdate = true;
    const floorAnx = new THREE.Mesh(
      new THREE.PlaneGeometry(ANX_X - ARENA + 3, ANX_Z * 2 + 3),
      new THREE.MeshLambertMaterial({ map: texFloorAnx, color: "#a89a8c" })
    );
    floorAnx.rotation.x = -Math.PI / 2;
    floorAnx.position.set((ARENA + ANX_X) / 2 + 0.5, 0.001, 0);
    floorAnx.userData.hit = { kind: "solid" };
    this.scene.add(floorAnx);
    this.shootables.push(floorAnx);
    /* walls + base trim */
    mkWall(ANX_Z * 2 + 3, ANX_X, 0, Math.PI / 2); /* back */
    mkWall(ANX_X - ARENA + 3, (ARENA + ANX_X) / 2 + 0.5, -ANX_Z, 0); /* north */
    mkWall(ANX_X - ARENA + 3, (ARENA + ANX_X) / 2 + 0.5, ANX_Z, 0); /* south */
    mkTrim(ANX_Z * 2 + 3, ANX_X, 0, Math.PI / 2);
    mkTrim(ANX_X - ARENA + 3, (ARENA + ANX_X) / 2 + 0.5, -ANX_Z, 0);
    mkTrim(ANX_X - ARENA + 3, (ARENA + ANX_X) / 2 + 0.5, ANX_Z, 0);
    /* colliders */
    this.addObstacle(ANX_X, 0, 0.6, ANX_Z + 1.5);
    this.addObstacle((ARENA + ANX_X) / 2 + 0.5, -ANX_Z, (ANX_X - ARENA) / 2 + 1.6, 0.6);
    this.addObstacle((ARENA + ANX_X) / 2 + 0.5, ANX_Z, (ANX_X - ARENA) / 2 + 1.6, 0.6);
    /* roof beam */
    const beamAnx = new THREE.Mesh(new THREE.BoxGeometry(ANX_X - ARENA + 3, 0.7, 1.1), beamMat);
    beamAnx.position.set((ARENA + ANX_X) / 2 + 0.5, 10.4, 0);
    this.scene.add(beamAnx);

    /* the boilers — two riveted tanks glowing from their peep doors */
    const boilerMat = new THREE.MeshLambertMaterial({ color: "#3a3f45", flatShading: true });
    const boilerBand = new THREE.MeshLambertMaterial({ color: "#2a2e33", flatShading: true });
    const boilerSpots: [number, number][] = [
      [39, -10],
      [47, 8],
    ];
    for (const [bx, bz] of boilerSpots) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 5.6, 12), boilerMat);
      tank.position.set(bx, 2.8, bz);
      tank.userData.hit = { kind: "solid" };
      this.scene.add(tank);
      this.shootables.push(tank);
      this.addObstacle(bx, bz, 1.7, 1.7);
      for (const by of [1.6, 4.0]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.62, 0.28, 12), boilerBand);
        band.position.set(bx, by, bz);
        this.scene.add(band);
      }
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), boilerMat);
      dome.position.set(bx, 5.6, bz);
      this.scene.add(dome);
      /* the fire peep — faces the doorway */
      const peepDir = new THREE.Vector3(32.5 - bx, 0, -bz).normalize();
      const peep = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.14), new THREE.MeshBasicMaterial({ color: "#ff6b1a" }));
      peep.position.set(bx + peepDir.x * 1.52, 2.2, bz + peepDir.z * 1.52);
      peep.lookAt(bx + peepDir.x * 4, 2.2, bz + peepDir.z * 4);
      this.scene.add(peep);
      const bl = new THREE.PointLight(new THREE.Color("#ff6b1a"), 30, 14, 1.6);
      bl.position.set(bx + peepDir.x * 2.2, 2.6, bz + peepDir.z * 2.2);
      this.scene.add(bl);
      /* stack pipe up through the roof */
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 5.2, 8), boilerBand);
      stack.position.set(bx, 7.9, bz);
      this.scene.add(stack);
    }

    /* pipe rack along the back wall */
    const pipeCols = ["#5d6167", "#7a4a2a", "#5d6167"];
    for (let i = 0; i < 3; i++) {
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, ANX_Z * 2 - 2, 8),
        new THREE.MeshLambertMaterial({ color: pipeCols[i], flatShading: true })
      );
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(51.6, 6.6 + i * 0.55, 0);
      this.scene.add(pipe);
    }

    /* scrap crates by the doorway — cover on both sides of the threshold */
    const crateMatAnx = new THREE.MeshLambertMaterial({ map: texCrate });
    const crateSpotsAnx: [number, number, number][] = [
      [35.4, -6.2, 1.7],
      [36.6, 6.6, 1.5],
    ];
    for (const [cx, cz, cs] of crateSpotsAnx) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(cs, cs, cs), crateMatAnx);
      c.position.set(cx, cs / 2, cz);
      c.rotation.y = Math.random() * 0.7;
      c.userData.hit = { kind: "solid" };
      this.scene.add(c);
      this.shootables.push(c);
      this.addObstacle(cx, cz, cs / 2 + 0.05, cs / 2 + 0.05);
    }

    /* catwalk against the back wall — headroom underneath, purely visual */
    const catMatAnx = new THREE.MeshLambertMaterial({ color: "#2c2f33", flatShading: true });
    const walk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 13), catMatAnx);
    walk.position.set(50.5, 4.3, 0);
    this.scene.add(walk);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 13), catMatAnx);
    rail.position.set(48.95, 4.9, 0);
    this.scene.add(rail);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.3, 0.18), catMatAnx);
      leg.position.set(i % 2 === 0 ? 49.3 : 51.7, 2.15, i < 2 ? -5.5 : 5.5);
      this.scene.add(leg);
    }

    /* one cold hanging lamp in the annex */
    const cordAnx = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.0, 4), beamMat);
    cordAnx.position.set(42.5, 9.3, 0);
    this.scene.add(cordAnx);
    const bulbAnx = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), new THREE.MeshBasicMaterial({ color: "#cfe0ee" }));
    bulbAnx.position.set(42.5, 7.7, 0);
    this.scene.add(bulbAnx);
    const lampAnx = new THREE.PointLight(new THREE.Color("#9fc2de"), 46, 20, 1.5);
    lampAnx.position.set(42.5, 7.5, 0);
    this.scene.add(lampAnx);
    this.lamps.push({ light: lampAnx, base: 46, broken: false, seed: Math.random() * 10 });

    /* spawn gates — dark alcoves with red lamps */
    const gateMat = new THREE.MeshBasicMaterial({ color: "#050302" });
    const gatePositions: [number, number, number][] = [
      [0, -ARENA + 0.4, 0],
      [0, ARENA - 0.4, Math.PI],
      [-ARENA + 0.4, 0, Math.PI / 2],
      /* the fourth gate now pours raiders out of the annex back wall */
      [ANX_X - 0.8, 0, -Math.PI / 2],
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

    this.buildWindows();

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
      /* volatile pair guarding the annex boilers */
      [42.5, -13, true], [43.5, 12.5, true],
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

  /* ============================== Windows & moonlight ============================== */

  private buildWindows() {
    const texShaft = shaftTexture();
    const texPool = poolTexture();
    const TILT = 0.576; /* 33° off vertical */
    const REACH = 5.2; /* horizontal run of a shaft, window (y≈8) to floor */
    const LEN = 9.6;

    const frameMat = new THREE.MeshLambertMaterial({ color: "#23201d", flatShading: true });
    const glassMat = new THREE.MeshBasicMaterial({ color: "#8fabc4", transparent: true, opacity: 0.96 });
    const shaftMat = new THREE.MeshBasicMaterial({
      map: texShaft,
      color: "#9fc2de",
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
    });
    const shaftMatB = shaftMat.clone();
    shaftMatB.opacity = 0.075;
    const poolMat = new THREE.MeshBasicMaterial({
      map: texPool,
      color: "#7d9fbf",
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
    });

    /* one framed clerestory window, built facing +z at the origin */
    const mkWindow = () => {
      const g = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), glassMat);
      glass.position.set(0, 8, 0);
      g.add(glass);
      const mkF = (w: number, h: number, x: number, y: number, d = 0.26) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
        m.position.set(x, y, 0.08);
        g.add(m);
      };
      mkF(4.5, 0.26, 0, 9.62);
      mkF(4.5, 0.26, 0, 6.38);
      mkF(0.26, 3.5, -2.13, 8);
      mkF(0.26, 3.5, 2.13, 8);
      mkF(0.11, 3, -0.68, 8, 0.2); /* mullions */
      mkF(0.11, 3, 0.68, 8, 0.2);
      mkF(4, 0.11, 0, 8, 0.2); /* transom */
      const sill = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.16, 0.5), frameMat);
      sill.position.set(0, 6.28, 0.18);
      g.add(sill);
      return g;
    };

    /* crossed gradient quads faking the volumetric beam */
    const mkShaft = () => {
      const g = new THREE.Group();
      const a = new THREE.Mesh(new THREE.PlaneGeometry(3.6, LEN), shaftMat);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(3.6, LEN), shaftMatB);
      b.rotation.y = 1.15;
      g.add(a);
      g.add(b);
      return g;
    };

    /* ---- north wall (z = -32): five windows, shafts on the outer + middle ---- */
    const northX = [-24, -12, 0, 12, 24];
    for (const wx of northX) {
      const win = mkWindow();
      win.position.set(wx, 0, -31.32);
      this.scene.add(win);
    }
    for (const wx of [-24, 0, 24]) {
      const sh = mkShaft();
      sh.position.set(wx, 4, -31.3 + REACH / 2);
      sh.rotation.x = -TILT;
      this.scene.add(sh);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 6.6), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(wx, 0.03, -31.3 + REACH);
      this.scene.add(pool);
    }

    /* The old east-wall windows are gone: that wall (x=32) is now an interior
       partition around the annex doorway, so exterior windows there made no
       sense. Daylight for this side now comes from the annex back wall. */

    /* ---- annex back wall (x = 53): clerestory windows, cold light spilling
       in past the boilers. The glass sits just inside the wall's inner face
       (x=52.4) so it actually renders from within the room. ---- */
    for (const wz of [-11, 0, 11]) {
      const win = mkWindow();
      win.rotation.y = -Math.PI / 2;
      win.position.set(52.32, 0, wz);
      this.scene.add(win);
      const sh = mkShaft();
      sh.position.set(52.3 - REACH / 2, 4, wz);
      sh.rotation.z = -TILT;
      this.scene.add(sh);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 3.8), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(52.3 - REACH, 0.03, wz);
      this.scene.add(pool);
    }

    /* cold directional fill so geometry on the window side actually reads lit */
    const moon = new THREE.DirectionalLight(new THREE.Color("#86a7c8"), 0.5);
    moon.position.set(18, 30, -46);
    moon.target.position.set(-4, 0, 10);
    this.scene.add(moon);
    this.scene.add(moon.target);
    this.moonLight = moon;

    /* ---- dust motes drifting through the lit air ---- */
    const N = 90;
    this.mPos = new Float32Array(N * 3);
    this.mPh = new Float32Array(N);
    this.mSpd = new Float32Array(N);
    this.mBox = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const box = i < 58 ? 0 : 1;
      this.mBox[i] = box;
      this.mPh[i] = Math.random() * Math.PI * 2;
      this.mSpd[i] = 0.1 + Math.random() * 0.26;
      if (box === 0) {
        this.mPos[i * 3] = -27 + Math.random() * 54;
        this.mPos[i * 3 + 1] = 0.5 + Math.random() * 8.5;
        this.mPos[i * 3 + 2] = -29 + Math.random() * 9;
      } else {
        this.mPos[i * 3] = 22 + Math.random() * 8;
        this.mPos[i * 3 + 1] = 0.5 + Math.random() * 8.5;
        this.mPos[i * 3 + 2] = -24 + Math.random() * 48;
      }
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.BufferAttribute(this.mPos, 3));
    const mm = new THREE.PointsMaterial({
      size: 0.055,
      color: "#b6cfe4",
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.5,
    });
    this.motePoints = new THREE.Points(mg, mm);
    this.motePoints.frustumCulled = false;
    this.scene.add(this.motePoints);
  }

  private updateMotes(dt: number) {
    if (!this.motePoints) return;
    this.moteT += dt;
    const t = this.moteT;
    for (let i = 0; i < this.mSpd.length; i++) {
      const ph = this.mPh[i];
      this.mPos[i * 3 + 1] += this.mSpd[i] * dt;
      this.mPos[i * 3] += Math.sin(t * 0.31 + ph) * 0.14 * dt;
      this.mPos[i * 3 + 2] += Math.cos(t * 0.24 + ph) * 0.11 * dt;
      if (this.mPos[i * 3 + 1] > 9.2) this.mPos[i * 3 + 1] = 0.4;
    }
    (this.motePoints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    /* slow cloud-pass breathing on the moonlight */
    if (this.moonLight) this.moonLight.intensity = 0.5 + Math.sin(t * 0.11) * 0.07;
  }
  private buildViewModels() {
    /* ---- shared material rack: two-tone steel, walnut, polymer, olive, brass ---- */
    const metal = new THREE.MeshLambertMaterial({ color: "#4a5058", flatShading: true });
    const darkMetal = new THREE.MeshLambertMaterial({ color: "#23262b", flatShading: true });
    const steel = new THREE.MeshLambertMaterial({ color: "#6a7078", flatShading: true });
    const boltSteel = new THREE.MeshLambertMaterial({ color: "#565c63", flatShading: true });
    const darkPoly = new THREE.MeshLambertMaterial({ color: "#2a2622", flatShading: true });
    const blackPoly = new THREE.MeshLambertMaterial({ color: "#14120f", flatShading: true });
    const gunBlack = new THREE.MeshLambertMaterial({ color: "#1c1f23", flatShading: true });
    const wood = new THREE.MeshLambertMaterial({ color: "#6b4426", flatShading: true });
    const woodLight = new THREE.MeshLambertMaterial({ color: "#7d5230", flatShading: true });
    const darkWood = new THREE.MeshLambertMaterial({ color: "#4a2d17", flatShading: true });
    const gripM = new THREE.MeshLambertMaterial({ color: "#2e2117", flatShading: true });
    const rubber = new THREE.MeshLambertMaterial({ color: "#171412", flatShading: true });
    const heavy = new THREE.MeshLambertMaterial({ color: "#33383e", flatShading: true });
    const olive = new THREE.MeshLambertMaterial({ color: "#4a4f3c", flatShading: true });
    const brass = new THREE.MeshLambertMaterial({ color: "#c9a24a", flatShading: true });
    const amberBand = new THREE.MeshLambertMaterial({ color: "#b07a1c", flatShading: true });
    const portDark = new THREE.MeshBasicMaterial({ color: "#0b0b0d" });
    const amber = new THREE.MeshBasicMaterial({ color: "#ffb42e" });
    const dotWhite = new THREE.MeshBasicMaterial({ color: "#d8d2c4" });
    const redGlow = new THREE.MeshBasicMaterial({ color: "#ff2e1f" });
    const B = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    const C = (rt: number, rb: number, h: number, m: THREE.Material, s = 8) => {
      const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), m);
      me.rotation.x = Math.PI / 2;
      return me;
    };
    const SP = (r: number, m: THREE.Material) => new THREE.Mesh(new THREE.SphereGeometry(r, 6, 6), m);

    /* ============ P-9 SCRAPLOCK — blued service pistol ============ */
    const pistol = new THREE.Group();
    const slide = B(0.075, 0.085, 0.34, metal);
    slide.position.set(0, 0.055, -0.08);
    pistol.add(slide);
    /* cocking serrations ride on the slide so they reciprocate with it */
    for (let i = 0; i < 5; i++)
      for (const sx of [-1, 1]) {
        const sr = B(0.004, 0.052, 0.011, darkMetal);
        sr.position.set(0.0395 * sx, 0, 0.105 + i * 0.013);
        slide.add(sr);
      }
    for (let i = 0; i < 2; i++)
      for (const sx of [-1, 1]) {
        const sr = B(0.004, 0.052, 0.011, darkMetal);
        sr.position.set(0.0395 * sx, 0, -0.14 - i * 0.013);
        slide.add(sr);
      }
    const slideTop = B(0.03, 0.008, 0.3, darkMetal);
    slideTop.position.set(0, 0.046, 0);
    slide.add(slideTop);
    const extractor = B(0.006, 0.02, 0.05, darkMetal);
    extractor.position.set(0.04, 0.012, 0.02);
    slide.add(extractor);
    const crownP = B(0.062, 0.062, 0.012, darkMetal);
    crownP.position.set(0, 0, -0.172);
    slide.add(crownP);
    /* polymer frame + accessory rail */
    const frame = B(0.065, 0.06, 0.26, darkPoly);
    frame.position.set(0, -0.01, -0.05);
    pistol.add(frame);
    for (let i = 0; i < 3; i++) {
      const notch = B(0.05, 0.008, 0.016, blackPoly);
      notch.position.set(0, -0.043, -0.125 - i * 0.024);
      pistol.add(notch);
    }
    /* trigger guard + blade */
    const guardF = B(0.012, 0.05, 0.012, darkPoly);
    guardF.position.set(0, -0.065, -0.085);
    pistol.add(guardF);
    const guardB = B(0.012, 0.055, 0.012, darkPoly);
    guardB.position.set(0, -0.06, 0.0);
    pistol.add(guardB);
    const guardU = B(0.012, 0.012, 0.075, darkPoly);
    guardU.position.set(0, -0.09, -0.04);
    pistol.add(guardU);
    const triggerBlade = B(0.008, 0.035, 0.02, steel);
    triggerBlade.position.set(0, -0.055, -0.035);
    triggerBlade.rotation.x = 0.2;
    pistol.add(triggerBlade);
    /* hammer, beavertail, thumb safety */
    const hammerP = B(0.02, 0.04, 0.016, steel);
    hammerP.position.set(0, 0.055, 0.1);
    hammerP.rotation.x = -0.5;
    pistol.add(hammerP);
    const beaver = B(0.05, 0.02, 0.05, darkPoly);
    beaver.position.set(0, 0.012, 0.1);
    beaver.rotation.x = -0.35;
    pistol.add(beaver);
    const safetyL = B(0.008, 0.018, 0.05, steel);
    safetyL.position.set(-0.037, 0.015, 0.03);
    pistol.add(safetyL);
    /* checkered walnut grip — bottom rakes back toward the shooter */
    const gripP = B(0.06, 0.16, 0.08, wood);
    gripP.position.set(0, -0.1, 0.06);
    gripP.rotation.x = -0.28;
    pistol.add(gripP);
    for (const sx of [-1, 1]) {
      const panel = B(0.004, 0.11, 0.052, darkWood);
      panel.position.set(0.0315 * sx, -0.01, 0);
      gripP.add(panel);
    }
    for (let r = 0; r < 5; r++)
      for (const sx of [-1, 1]) {
        const line = B(0.005, 0.011, 0.052, woodLight);
        line.position.set(0.0318 * sx, -0.052 + r * 0.026, 0);
        gripP.add(line);
      }
    const screwP1 = B(0.006, 0.012, 0.012, steel);
    screwP1.position.set(0.033, 0.03, 0.01);
    gripP.add(screwP1);
    const screwP2 = screwP1.clone();
    screwP2.position.x = -0.033;
    gripP.add(screwP2);
    const baseP = B(0.056, 0.02, 0.076, darkMetal);
    baseP.position.set(0, -0.192, 0.088);
    baseP.rotation.x = -0.28;
    pistol.add(baseP);
    /* sights — rear dots + amber front blade */
    const rearSight = B(0.05, 0.028, 0.02, darkMetal);
    rearSight.position.set(0, 0.112, 0.06);
    pistol.add(rearSight);
    for (const sx of [-1, 1]) {
      const dot = B(0.008, 0.008, 0.006, dotWhite);
      dot.position.set(0.015 * sx, 0.12, 0.052);
      pistol.add(dot);
    }
    const fSightP = B(0.016, 0.035, 0.018, darkMetal);
    fSightP.position.set(0, 0.115, -0.23);
    pistol.add(fSightP);
    const fDotP = B(0.007, 0.007, 0.005, amber);
    fDotP.position.set(0, 0.128, -0.233);
    pistol.add(fDotP);
    const muzzleP = new THREE.Object3D();
    muzzleP.position.set(0, 0.055, -0.3);
    pistol.add(muzzleP);
    const ejectP = new THREE.Object3D();
    ejectP.position.set(0.055, 0.06, -0.06);
    pistol.add(ejectP);

    /* ============ M870 BREAKER — walnut pump with a vent rib ============ */
    const shotgun = new THREE.Group();
    const barrelS = C(0.035, 0.035, 0.78, darkMetal, 10);
    barrelS.position.set(0, 0.05, -0.28);
    shotgun.add(barrelS);
    /* vent rib with a red bead up front, crown at the muzzle */
    const ribS = B(0.014, 0.01, 0.58, blackPoly);
    ribS.position.set(0, 0.092, -0.29);
    shotgun.add(ribS);
    const bead = SP(0.008, redGlow);
    bead.position.set(0, 0.104, -0.56);
    shotgun.add(bead);
    const crownS = C(0.039, 0.039, 0.016, steel, 10);
    crownS.position.set(0, 0.05, -0.668);
    shotgun.add(crownS);
    /* magazine tube: cap + knurled ring */
    const tube = C(0.03, 0.03, 0.5, metal, 10);
    tube.position.set(0, -0.02, -0.2);
    shotgun.add(tube);
    const tubeCap = C(0.033, 0.033, 0.03, steel, 10);
    tubeCap.position.set(0, -0.02, -0.46);
    shotgun.add(tubeCap);
    const tubeRing = C(0.034, 0.034, 0.02, darkMetal, 10);
    tubeRing.position.set(0, -0.02, -0.36);
    shotgun.add(tubeRing);
    /* barrel band tying tube to barrel */
    const bandS = B(0.02, 0.09, 0.02, darkMetal);
    bandS.position.set(0, 0.015, -0.43);
    shotgun.add(bandS);
    /* ribbed walnut pump — the animated forend */
    const pump = B(0.07, 0.08, 0.16, wood);
    pump.position.set(0, -0.02, -0.3);
    shotgun.add(pump);
    for (let i = 0; i < 5; i++)
      for (const sx of [-1, 1]) {
        const groove = B(0.004, 0.062, 0.013, darkWood);
        groove.position.set(0.0365 * sx, 0, -0.052 + i * 0.026);
        pump.add(groove);
      }
    /* action bars back to the receiver */
    const barL = C(0.006, 0.006, 0.22, steel, 6);
    barL.position.set(-0.02, 0.03, 0.17);
    shotgun.add(barL);
    const barR = barL.clone();
    barR.position.x = 0.02;
    shotgun.add(barR);
    /* receiver with ejection + loading ports */
    const receiver = B(0.08, 0.11, 0.24, metal);
    receiver.position.set(0, 0.02, 0.12);
    shotgun.add(receiver);
    const port = B(0.012, 0.07, 0.1, portDark);
    port.position.set(0.045, 0.02, 0.1);
    shotgun.add(port);
    const gateS = B(0.06, 0.012, 0.09, portDark);
    gateS.position.set(0, -0.042, 0.14);
    shotgun.add(gateS);
    /* crossbolt safety + hammer */
    const safetyS = B(0.016, 0.016, 0.012, redGlow);
    safetyS.position.set(0, 0.005, 0.246);
    shotgun.add(safetyS);
    const hammerS = B(0.02, 0.03, 0.014, darkMetal);
    hammerS.position.set(0, -0.02, 0.246);
    shotgun.add(hammerS);
    /* walnut stock: lighter comb, rubber pad, sling swivel */
    const stock = B(0.065, 0.12, 0.24, wood);
    stock.position.set(0, -0.03, 0.34);
    stock.rotation.x = -0.15;
    shotgun.add(stock);
    const comb = B(0.05, 0.02, 0.2, woodLight);
    comb.position.set(0, 0.062, 0.01);
    stock.add(comb);
    const padS = B(0.069, 0.124, 0.02, rubber);
    padS.position.set(0, 0, 0.125);
    stock.add(padS);
    const slingS = B(0.014, 0.02, 0.014, darkMetal);
    slingS.position.set(0, -0.065, 0.1);
    stock.add(slingS);
    const muzzleS = new THREE.Object3D();
    muzzleS.position.set(0, 0.05, -0.72);
    shotgun.add(muzzleS);

    /* ============ VK-9 WESPE — stamped prototype SMG, grip-fed, no stock ============ */
    const smg = new THREE.Group();
    const smgBody = B(0.085, 0.1, 0.42, darkMetal);
    smgBody.position.set(0, 0.03, -0.02);
    smg.add(smgBody);
    /* stamped side panels + rivet lines */
    for (const sx of [-1, 1]) {
      const panelK = B(0.004, 0.06, 0.3, blackPoly);
      panelK.position.set(0.045 * sx, 0.03, -0.02);
      smg.add(panelK);
    }
    for (let i = 0; i < 6; i++) {
      const rv = B(0.005, 0.008, 0.008, steel);
      rv.position.set(i % 2 === 0 ? 0.0475 : -0.0475, i < 3 ? 0.062 : -0.004, -0.16 + (i % 3) * 0.14);
      smg.add(rv);
    }
    /* fire selector lever on the left */
    const selectorK = B(0.008, 0.05, 0.014, steel);
    selectorK.position.set(-0.047, 0.02, 0.1);
    selectorK.rotation.x = 0.6;
    smg.add(selectorK);
    /* top cover + stamped ribs */
    const topCover = B(0.062, 0.028, 0.4, metal);
    topCover.position.set(0, 0.092, -0.03);
    smg.add(topCover);
    for (let i = 0; i < 3; i++) {
      const rib = B(0.09, 0.012, 0.03, metal);
      rib.position.set(0, 0.0, -0.12 + i * 0.09);
      smg.add(rib);
    }
    /* reciprocating open-bolt cover (animated) with cocking serrations */
    const bolt = B(0.05, 0.02, 0.1, boltSteel);
    bolt.position.set(0, 0.113, -0.12);
    smg.add(bolt);
    for (let i = 0; i < 3; i++)
      for (const sx of [-1, 1]) {
        const bs = B(0.004, 0.012, 0.008, darkMetal);
        bs.position.set(0.027 * sx, 0, -0.024 + i * 0.024);
        bolt.add(bs);
      }
    const chgHandle = B(0.012, 0.012, 0.07, darkMetal);
    chgHandle.position.set(0.045, 0.113, -0.12);
    smg.add(chgHandle);
    const chgKnob = SP(0.011, steel);
    chgKnob.position.set(0.085, 0.113, -0.12);
    smg.add(chgKnob);
    /* barrel shroud with cooling slots + end cap */
    const shroud = B(0.052, 0.052, 0.2, metal);
    shroud.position.set(0, 0.045, -0.32);
    smg.add(shroud);
    for (let i = 0; i < 4; i++)
      for (const sx of [-1, 1]) {
        const slotK = B(0.004, 0.026, 0.022, portDark);
        slotK.position.set(0.0275 * sx, 0, -0.066 + i * 0.044);
        shroud.add(slotK);
      }
    const shroudCap = B(0.058, 0.058, 0.014, darkMetal);
    shroudCap.position.set(0, 0, -0.1);
    shroud.add(shroudCap);
    /* barrel tip + crown past the shroud */
    const tipK = C(0.016, 0.016, 0.06, darkMetal, 8);
    tipK.position.set(0, 0.045, -0.43);
    smg.add(tipK);
    /* hooded front sight with an amber dot */
    const fSightBase = B(0.04, 0.012, 0.02, darkMetal);
    fSightBase.position.set(0, 0.078, -0.4);
    smg.add(fSightBase);
    for (const sx of [-1, 1]) {
      const prong = B(0.008, 0.045, 0.014, darkMetal);
      prong.position.set(0.016 * sx, 0.1, -0.4);
      smg.add(prong);
    }
    const fPost = B(0.008, 0.03, 0.008, steel);
    fPost.position.set(0, 0.098, -0.4);
    smg.add(fPost);
    const fDotK = B(0.005, 0.005, 0.004, amber);
    fDotK.position.set(0, 0.116, -0.4);
    smg.add(fDotK);
    /* rear peep */
    const rSight = B(0.05, 0.03, 0.02, darkMetal);
    rSight.position.set(0, 0.095, 0.14);
    smg.add(rSight);
    for (const sx of [-1, 1]) {
      const peep = B(0.012, 0.016, 0.008, portDark);
      peep.position.set(0.019 * sx, 0.1, 0.132);
      smg.add(peep);
    }
    /* grip magazine — witness holes, finger grooves, amber proof band */
    const smgGrip = B(0.062, 0.2, 0.08, gunBlack);
    smgGrip.position.set(0, -0.09, 0.03);
    smgGrip.rotation.x = 0.14;
    smg.add(smgGrip);
    for (let i = 0; i < 3; i++)
      for (const sx of [-1, 1]) {
        const hole = B(0.004, 0.014, 0.014, portDark);
        hole.position.set(0.0325 * sx, -0.04 + i * 0.045, 0);
        smgGrip.add(hole);
      }
    for (let i = 0; i < 3; i++) {
      const fg = B(0.05, 0.012, 0.012, blackPoly);
      fg.position.set(0, -0.02 - i * 0.04, -0.042);
      smgGrip.add(fg);
    }
    const magBand = B(0.064, 0.018, 0.082, amberBand);
    magBand.position.set(0, -0.075, 0);
    smgGrip.add(magBand);
    const magBase = B(0.05, 0.06, 0.07, darkMetal);
    magBase.position.set(0, -0.21, 0.045);
    magBase.rotation.x = 0.14;
    smg.add(magBase);
    /* two-part prototype tag + ejection port */
    const tag = B(0.012, 0.03, 0.09, amber);
    tag.position.set(0.048, 0.03, 0.02);
    smg.add(tag);
    const tagLine = B(0.003, 0.02, 0.06, portDark);
    tagLine.position.set(0.055, 0.03, 0.02);
    smg.add(tagLine);
    const portK = B(0.012, 0.05, 0.11, portDark);
    portK.position.set(0.048, 0.05, -0.08);
    smg.add(portK);
    const muzzleK = new THREE.Object3D();
    muzzleK.position.set(0, 0.045, -0.435);
    smg.add(muzzleK);

    /* ============ MG-7 HOG — belt-fed GPMG, M60/M2 lineage ============ */
    const mg = new THREE.Group();
    /* receiver + olive top cover with a latch */
    const mgBody = B(0.11, 0.13, 0.46, heavy);
    mgBody.position.set(0, 0.02, 0.02);
    mg.add(mgBody);
    const topMg = B(0.1, 0.03, 0.42, olive);
    topMg.position.set(0, 0.095, 0.0);
    mg.add(topMg);
    const latchMg = B(0.03, 0.02, 0.03, darkMetal);
    latchMg.position.set(0, 0.115, 0.16);
    mg.add(latchMg);
    /* side panels + rivet pattern */
    for (const sx of [-1, 1]) {
      const panMg = B(0.004, 0.09, 0.36, blackPoly);
      panMg.position.set(0.057 * sx, 0.02, 0.0);
      mg.add(panMg);
    }
    for (let i = 0; i < 8; i++) {
      const rvMg = B(0.005, 0.008, 0.008, steel);
      rvMg.position.set(i % 2 === 0 ? 0.059 : -0.059, i < 4 ? 0.06 : -0.02, -0.15 + (i % 4) * 0.1);
      mg.add(rvMg);
    }
    /* amber ammo-counter window on the left panel */
    const counter = B(0.004, 0.025, 0.05, amber);
    counter.position.set(-0.059, 0.02, 0.12);
    mg.add(counter);
    /* box feed hanging off the lower-left: latches, band, stamped ribs, handle */
    const boxMag = B(0.1, 0.12, 0.22, olive);
    boxMag.position.set(-0.105, -0.055, 0.04);
    mg.add(boxMag);
    const boxLid = B(0.02, 0.13, 0.23, heavy);
    boxLid.position.set(-0.162, -0.055, 0.04);
    mg.add(boxLid);
    for (let i = 0; i < 3; i++) {
      const mgRib = B(0.104, 0.124, 0.014, darkMetal);
      mgRib.position.set(-0.105, -0.055, -0.03 + i * 0.07);
      mg.add(mgRib);
    }
    const boxLatch = B(0.014, 0.03, 0.03, steel);
    boxLatch.position.set(-0.105, 0.012, 0.1);
    mg.add(boxLatch);
    const boxHandle = B(0.014, 0.02, 0.1, steel);
    boxHandle.position.set(-0.178, -0.055, 0.04);
    mg.add(boxHandle);
    const boxBand = B(0.104, 0.124, 0.014, amberBand);
    boxBand.position.set(-0.105, -0.055, 0.12);
    mg.add(boxBand);
    /* feed chute with a belt dangling out — brass-tipped links */
    const chute = B(0.05, 0.05, 0.12, darkMetal);
    chute.position.set(-0.062, -0.005, 0.02);
    chute.rotation.z = 0.85;
    mg.add(chute);
    for (let i = 0; i < 4; i++) {
      const link = B(0.05, 0.016, 0.02, steel);
      link.position.set(-0.1 - i * 0.012, -0.14 - i * 0.05, -0.02 + i * 0.012);
      link.rotation.z = 0.3 + i * 0.12;
      mg.add(link);
      const tipL = B(0.05, 0.008, 0.02, brass);
      tipL.position.set(0, -0.012, 0);
      link.add(tipL);
    }
    /* heavy finned barrel + change latch */
    const barrelM = C(0.032, 0.036, 0.62, heavy, 10);
    barrelM.position.set(0, 0.045, -0.42);
    mg.add(barrelM);
    for (let i = 0; i < 6; i++) {
      const fin = C(0.042, 0.042, 0.012, metal, 10);
      fin.position.set(0, 0.045, -0.2 - i * 0.08);
      mg.add(fin);
    }
    const barLatch = B(0.02, 0.03, 0.02, steel);
    barLatch.position.set(0.062, 0.045, -0.16);
    mg.add(barLatch);
    /* gas tube + folded bipod */
    const gasTube = C(0.02, 0.02, 0.4, darkMetal, 8);
    gasTube.position.set(0, -0.01, -0.3);
    mg.add(gasTube);
    for (const sx of [-1, 1]) {
      const leg = B(0.012, 0.012, 0.26, steel);
      leg.position.set(0.03 * sx, -0.03, -0.4);
      leg.rotation.x = 0.12;
      leg.rotation.z = sx * 0.1;
      mg.add(leg);
      const foot = B(0.02, 0.012, 0.03, rubber);
      foot.position.set(0.03 * sx, -0.03, -0.53);
      mg.add(foot);
    }
    /* muzzle brake with vent slots */
    const brakeM = C(0.04, 0.04, 0.1, metal, 8);
    brakeM.position.set(0, 0.045, -0.74);
    mg.add(brakeM);
    for (let i = 0; i < 3; i++) {
      const slot = B(0.082, 0.014, 0.016, portDark);
      slot.position.set(0, 0.045, -0.715 - i * 0.03);
      mg.add(slot);
    }
    /* front sight + rubber-padded carrying handle */
    const mgFSight = B(0.014, 0.06, 0.014, darkMetal);
    mgFSight.position.set(0, 0.1, -0.55);
    mg.add(mgFSight);
    const handle = B(0.02, 0.05, 0.14, heavy);
    handle.position.set(0, 0.115, -0.35);
    mg.add(handle);
    const handlePad = B(0.024, 0.012, 0.1, rubber);
    handlePad.position.set(0, 0.145, -0.35);
    mg.add(handlePad);
    /* reciprocating bolt carrier (animated) with a charging knob */
    const mgBolt = B(0.02, 0.03, 0.12, boltSteel);
    mgBolt.position.set(0.06, 0.02, 0.02);
    mg.add(mgBolt);
    const mgKnob = SP(0.013, steel);
    mgKnob.position.set(0.075, 0.02, -0.03);
    mgBolt.add(mgKnob);
    /* olive stock: walnut cheek riser + rubber pad; grooved pistol grip */
    const mgStock = B(0.08, 0.14, 0.26, olive);
    mgStock.position.set(0, -0.05, 0.36);
    mgStock.rotation.x = -0.12;
    mg.add(mgStock);
    const cheekMg = B(0.07, 0.03, 0.16, wood);
    cheekMg.position.set(0, 0.08, 0.0);
    mgStock.add(cheekMg);
    const padMg = B(0.084, 0.144, 0.02, rubber);
    padMg.position.set(0, 0, 0.135);
    mgStock.add(padMg);
    const mgGrip = B(0.06, 0.14, 0.07, gripM);
    mgGrip.position.set(0, -0.1, 0.16);
    mgGrip.rotation.x = -0.22;
    mg.add(mgGrip);
    for (let i = 0; i < 3; i++) {
      const gg = B(0.062, 0.012, 0.012, blackPoly);
      gg.position.set(0, -0.02 - i * 0.035, -0.036);
      mgGrip.add(gg);
    }
    /* ejection port + muzzle anchor */
    const portM = B(0.012, 0.06, 0.13, portDark);
    portM.position.set(0.06, 0.02, -0.04);
    mg.add(portM);
    const muzzleM = new THREE.Object3D();
    muzzleM.position.set(0, 0.045, -0.8);
    mg.add(muzzleM);

    const gunLight = new THREE.PointLight(new THREE.Color("#ffe8c8"), 1.1, 2.4, 1.8);
    gunLight.position.set(0.1, 0.1, -0.2);

    for (const vm of [pistol, shotgun, smg, mg]) {
      vm.position.copy(this.vmBase);
      vm.visible = false;
      this.camera.add(vm);
    }
    pistol.visible = true;
    pistol.add(gunLight);
    this.scene.add(this.camera);
    this.vmGroups = [pistol, shotgun, smg, mg];
    this.vmMuzzles = [muzzleP, muzzleS, muzzleK, muzzleM];
    this.vmSlide = slide;
    this.vmPump = pump;
    this.vmBolt = bolt;
    this.vmMgBolt = mgBolt;
    this.gunLight = gunLight;
    this.buildModAttachments([pistol, shotgun, smg, mg]);
  }

  /* ---- universal gun-mod hardware (see gunmods.ts) ---- */
  private modVisuals: Record<GunModId, THREE.Object3D[]>[] = [];
  private flashLight: THREE.SpotLight | null = null;
  /* laser hardware, re-aimed per frame so the dot sits on real geometry */
  private laserGroups: (THREE.Group | null)[] = [null, null, null, null];
  private laserBeams: (THREE.Line | null)[] = [null, null, null, null];
  private laserDots: (THREE.Mesh | null)[] = [null, null, null, null];
  /* flashlight torch anchors + their downrange aim targets */
  private lightGroups: (THREE.Group | null)[] = [null, null, null, null];
  private lightTargets: (THREE.Object3D | null)[] = [null, null, null, null];
  private tmpLA = new THREE.Vector3();
  private tmpLB = new THREE.Vector3();
  private tmpLC = new THREE.Vector3();

  private buildModAttachments(vms: THREE.Group[]) {
    const steel = new THREE.MeshLambertMaterial({ color: "#5d6167", flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: "#23262b", flatShading: true });
    const black = new THREE.MeshLambertMaterial({ color: "#101215", flatShading: true });
    const sizes = [0.045, 0.06, 0.05, 0.055]; /* suppressor radius per gun */

    const amberAt = new THREE.MeshLambertMaterial({ color: "#b07a1c", flatShading: true });
    /* where each gun's extended feed hangs: pistol/smg grip mags, shotgun a
       longer tube up front, the HOG a deeper left-side box */
    const magPos: [number, number, number][] = [
      [0, -0.26, 0.07],
      [0, -0.02, -0.34],
      [0, -0.27, 0.035],
      [-0.105, -0.17, 0.04],
    ];

    this.modVisuals = vms.map((vm, i) => {
      const muzzle = this.vmMuzzles[i];
      const rec: Record<GunModId, THREE.Object3D[]> = { suppressor: [], brake: [], mag: [], laser: [], light: [] };
      const r = sizes[i];
      const bx = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      const cy = (rt: number, rb: number, h: number, m: THREE.Material, s = 10) => {
        const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), m);
        me.rotation.x = Math.PI / 2;
        return me;
      };

      /* suppressor — a plain black cylinder, no detail at all */
      const supp = cy(r, r, 0.3, black);
      supp.position.set(0, 0, -0.16);
      muzzle.add(supp);
      rec.suppressor.push(supp);

      /* muzzle brake — finned compensator with a crown and dark vents */
      const brake = new THREE.Group();
      const body = cy(r * 1.25, r * 1.25, 0.13, steel, 8);
      brake.add(body);
      for (let f = 0; f < 3; f++) {
        const fin = bx(r * 2.6, 0.014, 0.02, steel);
        fin.position.z = -0.045 + f * 0.045;
        brake.add(fin);
        const vent = bx(r * 2.3, 0.006, 0.012, new THREE.MeshBasicMaterial({ color: "#0b0b0d" }));
        vent.position.z = -0.045 + f * 0.045;
        brake.add(vent);
      }
      const brCrown = cy(r * 1.3, r * 1.3, 0.014, dark);
      brCrown.position.z = -0.07;
      brake.add(brCrown);
      brake.position.set(0, 0, -0.08);
      muzzle.add(brake);
      rec.brake.push(brake);

      /* extended feed — shaped per gun so it reads as a real part */
      const mag = new THREE.Group();
      if (i === 1) {
        /* shotgun: tube extension under the barrel */
        mag.add(cy(0.031, 0.031, 0.24, dark));
        const extCap = cy(0.034, 0.034, 0.02, steel);
        extCap.position.z = -0.12;
        mag.add(extCap);
        const extBand = cy(0.033, 0.033, 0.02, amberAt);
        extBand.position.z = 0.06;
        mag.add(extBand);
      } else if (i === 3) {
        /* HOG: a deeper left-side box with latches */
        mag.add(bx(0.1, 0.12, 0.22, dark));
        const lidM = bx(0.02, 0.125, 0.23, steel);
        lidM.position.set(-0.06, 0, 0);
        mag.add(lidM);
        const bandM = bx(0.104, 0.124, 0.014, amberAt);
        bandM.position.set(0, 0, 0.1);
        mag.add(bandM);
      } else {
        /* pistol/smg: a longer grip magazine with baseplate + band */
        mag.add(bx(0.062, 0.17, 0.078, dark));
        const plateM = bx(0.066, 0.02, 0.082, steel);
        plateM.position.set(0, -0.095, 0);
        mag.add(plateM);
        const bandP = bx(0.064, 0.018, 0.08, amberAt);
        bandP.position.set(0, 0.05, 0);
        mag.add(bandP);
      }
      mag.position.set(magPos[i][0], magPos[i][1], magPos[i][2]);
      vm.add(mag);
      rec.mag.push(mag);

      /* laser — rail clamp, emitter with windage dial, faint red beam */
      const laser = new THREE.Group();
      const clamp = bx(0.03, 0.02, 0.05, steel);
      clamp.position.set(0, -0.052, -0.02);
      laser.add(clamp);
      const emitter = bx(0.04, 0.05, 0.09, black);
      emitter.position.set(0, -0.075, -0.02);
      laser.add(emitter);
      const dial = cy(0.012, 0.012, 0.05, steel, 6);
      dial.rotation.z = Math.PI / 2;
      dial.position.set(0.032, -0.075, 0.01);
      laser.add(dial);
      const lensL = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), new THREE.MeshBasicMaterial({ color: "#ff3020" }));
      lensL.position.set(0, -0.075, -0.066);
      laser.add(lensL);
      /* beam + dot are re-aimed every frame by updateLaser() so the dot sits
         exactly where the beam hits — start collapsed, hidden until placed */
      const beam = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.075, -0.07), new THREE.Vector3(0, -0.075, -0.07)]),
        new THREE.LineBasicMaterial({ color: "#ff3020", transparent: true, opacity: 0.5 })
      );
      laser.add(beam);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), new THREE.MeshBasicMaterial({ color: "#ff3020" }));
      dot.visible = false;
      laser.add(dot);
      muzzle.add(laser);
      rec.laser.push(laser);
      this.laserGroups[i] = laser;
      this.laserBeams[i] = beam;
      this.laserDots[i] = dot;

      /* flashlight — knurled torch and warm lens; the actual light is a real
         SpotLight mounted here when equipped (no fake volumetric cone) */
      const light = new THREE.Group();
      const torch = cy(0.032, 0.038, 0.12, dark, 8);
      torch.position.set(0, -0.08, -0.05);
      light.add(torch);
      for (let k = 0; k < 2; k++) {
        const knurl = cy(0.037, 0.037, 0.012, steel, 8);
        knurl.position.set(0, -0.08, -0.02 - k * 0.045);
        light.add(knurl);
      }
      const tail = bx(0.03, 0.03, 0.02, steel);
      tail.position.set(0, -0.08, 0.02);
      light.add(tail);
      const lens = cy(0.03, 0.03, 0.012, new THREE.MeshBasicMaterial({ color: "#fff3c4" }), 8);
      lens.position.set(0, -0.08, -0.112);
      light.add(lens);
      /* no fake cone — a real SpotLight (this.flashLight) is parented to this
         torch when equipped, aimed at a far downrange target */
      const aim = new THREE.Object3D();
      aim.position.set(0, -0.08, -20);
      light.add(aim);
      muzzle.add(light);
      rec.light.push(light);
      this.lightGroups[i] = light;
      this.lightTargets[i] = aim;

      return rec;
    });

    /* one real torch spotlight, re-parented to whichever gun has the
       flashlight mounted (see refreshModVisuals). Starts dark and detached. */
    this.flashLight = new THREE.SpotLight("#ffe9c4", 0, 26, 0.45, 0.4, 1.7);
    this.flashLight.position.set(0, -0.08, -0.12);
  }

  /* show/hide each gun's mounted hardware */
  private refreshModVisuals() {
    const eq = this.equippedMods[this.weaponIdx];
    this.modVisuals.forEach((rec, i) => {
      (Object.keys(rec) as GunModId[]).forEach((id) => {
        rec[id].forEach((o) => (o.visible = i === this.weaponIdx && eq === id));
      });
    });
    /* mount the real torch spotlight on the active gun when the light is
       equipped; otherwise kill it. Parenting it to the torch means the beam
       follows the gun's bob, sway and recoil for free. */
    if (this.flashLight) {
      if (eq === "light") {
        const group = this.lightGroups[this.weaponIdx];
        const target = this.lightTargets[this.weaponIdx];
        if (group && target) {
          group.add(this.flashLight);
          this.flashLight.position.set(0, -0.08, -0.12);
          this.flashLight.target = target;
          this.flashLight.intensity = this.ownedTier.light === 2 ? 95 : 60;
        } else {
          this.flashLight.intensity = 0;
        }
    } else {
        this.flashLight.intensity = 0;
      }
    }
  }

  /* Aim the active gun's laser at whatever the beam actually hits, so the
     dot sits on the wall / crate / raider instead of floating in space. */
  private updateLaser() {
    const wi = this.weaponIdx;
    const laser = this.laserGroups[wi];
    const beam = this.laserBeams[wi];
    const dot = this.laserDots[wi];
    if (!laser || !beam || !dot) return;
    if (this.equippedMods[wi] !== "laser") {
      dot.visible = false;
      return;
    }
    laser.updateWorldMatrix(true, false);
    /* aperture world position (the little red lens at the front) */
    const origin = this.tmpLA.set(0, -0.075, -0.066);
    laser.localToWorld(origin);
    const dir = this.camera.getWorldDirection(this.tmpLB);
    this.raycaster.set(origin, dir);
    this.raycaster.far = 80;
    const hits = this.raycaster.intersectObjects(this.shootables, false);
    const dist = hits.length > 0 ? hits[0].distance : 60;
    /* dot rests just short of the surface so it reads on top of it */
    const dotDist = Math.max(0.06, dist - 0.04);
    const dotWorld = this.tmpLC.copy(origin).addScaledVector(dir, dotDist);
    dot.position.copy(laser.worldToLocal(dotWorld.clone()));
    /* keep the dot legible at range without ballooning up close */
    dot.scale.setScalar(Math.min(1.7, 0.55 + dist * 0.02));
    dot.visible = true;
    /* beam runs from the aperture to the impact point — mutate the existing
       attribute in place so no geometry is allocated per frame */
    const endWorld = this.tmpLC.copy(origin).addScaledVector(dir, dist);
    const endLocal = laser.worldToLocal(endWorld.clone());
    const pos = beam.geometry.getAttribute("position") as THREE.BufferAttribute;
    pos.setXYZ(1, endLocal.x, endLocal.y, endLocal.z);
    pos.needsUpdate = true;
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
    this.tFrom = new Float32Array(this.tCount * 3);
    this.tDir = new Float32Array(this.tCount * 3);
    this.tBase = new Float32Array(this.tCount * 3);
    this.tLen = new Float32Array(this.tCount);
    this.tDist = new Float32Array(this.tCount);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(this.tPos, 3));
    tg.setAttribute("color", new THREE.BufferAttribute(this.tCol, 3));
    const tm = new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.tracerLines = new THREE.LineSegments(tg, tm);
    this.tracerLines.frustumCulled = false;
    this.scene.add(this.tracerLines);

    /* muzzle flash: a camera-facing billboard (always visible from the
       shooter's POV) made of two crown quads rolled 45° apart for a fuller
       star. Per-entry materials so each burst fades on its own clock. */
    const flashGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 6; i++) {
      const crown = this.flashTex[i % this.flashTex.length];
      const matA = new THREE.MeshBasicMaterial({ map: crown, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, opacity: 0 });
      const matB = matA.clone();
      const group = new THREE.Group();
      const planeA = new THREE.Mesh(flashGeo, matA);
      const planeB = new THREE.Mesh(flashGeo, matB);
      planeB.rotation.z = Math.PI / 4; /* second crown rolled 45° → richer star */
      group.add(planeA);
      group.add(planeB);
      group.visible = false;
      this.scene.add(group);
      this.muzzleFlashes.push({ group, matA, matB, life: 0, max: 0.05, len: 0.5, wid: 0.5 });
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
    for (let i = 0; i < 40; i++) {
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

  /* A short luminous streak that physically travels from muzzle to impact —
     the head leads, a dimmer tail trails behind, then it absorbs into the
     hit point and fades. Reads as a real tracer, kept subtle and brief. */
  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color: string) {
    const i = this.tNext;
    this.tNext = (this.tNext + 1) % this.tCount;

    this.tFrom[i * 3] = from.x;
    this.tFrom[i * 3 + 1] = from.y;
    this.tFrom[i * 3 + 2] = from.z;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
    this.tDir[i * 3] = dx / dist;
    this.tDir[i * 3 + 1] = dy / dist;
    this.tDir[i * 3 + 2] = dz / dist;
    this.tDist[i] = dist;
    this.tLen[i] = 1.6 + Math.random() * 0.9; /* short streak */

    /* start as a collapsed point at the muzzle */
    this.tPos[i * 6] = from.x;
    this.tPos[i * 6 + 1] = from.y;
    this.tPos[i * 6 + 2] = from.z;
    this.tPos[i * 6 + 3] = from.x;
    this.tPos[i * 6 + 4] = from.y;
    this.tPos[i * 6 + 5] = from.z;

    /* subtle: scale the warm color down so it glows without blowing out */
    const c = new THREE.Color(color).multiplyScalar(0.5);
    this.tBase[i * 3] = c.r;
    this.tBase[i * 3 + 1] = c.g;
    this.tBase[i * 3 + 2] = c.b;

    const travel = dist / TRACER_SPEED;
    const fade = 0.045;
    this.tLife[i] = travel + fade;
    this.tMax[i] = this.tLife[i];
  }

  private spawnMuzzleFlash() {
    if (this.hasMod("suppressor")) return; /* a can shows nothing */
    const muzzle = this.vmMuzzles[this.weaponIdx];
    muzzle.getWorldPosition(this.tmpV);
    this.camera.getWorldDirection(this.tmpV2);
    /* the blast blooms at the tip of whatever is threaded onto the muzzle */
    this.tmpV.addScaledVector(this.tmpV2, this.attachLen());
    for (const f of this.muzzleFlashes) {
      if (f.life <= 0) {
        f.group.visible = true;
        f.group.position.copy(this.tmpV).addScaledVector(this.tmpV2, 0.04);
        /* billboard facing the shooter with a random in-screen roll — a real
           blast reads as a radial star from the POV and never repeats */
        this.tmpQ2.setFromAxisAngle(this.tmpV3.set(0, 0, 1), Math.random() * Math.PI * 2);
        f.group.quaternion.copy(this.camera.quaternion).multiply(this.tmpQ2);
        /* suppressor trims the flash to a dim puff; a brake flares it wider */
        const base = WEAPONS[this.weaponIdx].flash * (this.hasMod("suppressor") ? 0.35 : this.hasMod("brake") ? 1.25 : 1);
        f.len = base * (0.8 + Math.random() * 0.45);
        f.wid = f.len * (0.78 + Math.random() * 0.3);
        f.group.scale.set(f.len, f.wid, 1);
        f.matA.opacity = 1;
        f.matB.opacity = 1;
        f.max = 0.038 + Math.random() * 0.016;
        f.life = f.max;
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
    const scaleHp = 1 + (this.wave - 1) * 0.12;
    const scaleSp = 1 + Math.min(this.wave, 14) * 0.016;

    const s = def.scale;
    g.scale.setScalar(s);
    g.position.set(x, -1.4 * s, z);

    /* overhead damage gauge — appears the moment a raider takes a hit,
       drains left-to-right and shifts green → red as it empties */
    const barBackMat = new THREE.MeshBasicMaterial({ color: "#0d0a07", transparent: true, opacity: 0, depthWrite: false });
    const barMat = new THREE.MeshBasicMaterial({ color: "#7dff5e", transparent: true, opacity: 0, depthWrite: false });
    const barBack = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.105), barBackMat);
    const barFill = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.06), barMat);
    barBack.position.set(0, 2.18, 0);
    barFill.position.set(0, 2.18, 0.002);
    g.add(barBack);
    g.add(barFill);

    /* runners alternate orbit sides to pincer; scrappers grow bolder each wave */
    const orbitDir = kind === "runner" ? -this.lastRunnerDir : Math.random() < 0.5 ? -1 : 1;
    if (kind === "runner") this.lastRunnerDir = orbitDir;

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
      /* squad personality — rolled per raider so no two waves play alike */
      flank: Math.random() < 0.5 ? -1 : 1,
      caution: kind === "scrapper" ? 0.7 + Math.random() * 0.25 : kind === "runner" ? 0.12 + Math.random() * 0.2 : 0.35 + Math.random() * 0.2,
      aggression: 0.85 + Math.random() * 0.3,
      hesitateT: Math.random() * 0.5,
      hesitateCd: 2 + Math.random() * 3,
      laneAngle: Math.atan2(x - this.pos.x, z - this.pos.z),
      laneTarget: Math.atan2(x - this.pos.x, z - this.pos.z),
      repositionT: 2 + Math.random() * 3,
      burst: 0,
      burstT: 0,
      barBackMat,
      barFill,
      barMat,
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

  private damageEnemy(
    e: Enemy,
    dmg: number,
    point: THREE.Vector3,
    head: boolean,
    knock: number,
    dir: THREE.Vector3,
    weaponTag: string,
    force: number
  ) {
    if (e.state === "dead") return;
    if (e.state === "charge" && !head) dmg *= 0.5; /* charging brutes shrug off body shots */
    e.hp -= dmg;
    e.flash = 1;
    /* heavies wade through small-arms fire — only a real hit checks them */
    const heavy = e.kind === "brute";
    e.hitstun = heavy && knock < 5 ? 0.04 : 0.13;
    const kb = heavy && knock < 5 ? 0.3 : 1;
    e.kvx += dir.x * knock * kb;
    e.kvz += dir.z * knock * kb;
    /* only a genuinely heavy blow (shotgun blast, barrel blast) breaks a
       wound-up attack — light full-auto fire must not stun-lock */
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
    this.hitstop = 0.045; /* a beat of frozen time sells the kill */
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
    else if (r < 0.23 * this.dropMul) this.dropPickup(e.group.position, this.rollAmmoDrop());

    /* attachment loot — a separate, much rarer roll so a good haul feels
       earned. Brutes rummage richer; the Salvage Rig multiplies it all. */
    if (Math.random() < (e.kind === "brute" ? 0.16 : 0.05) * this.dropMul) this.dropAttachment(e.group.position);
  }

  /* pick a part weighted by its drop weight, then roll its tier.
     You can only find a Mk.II of a part you already own the Mk.I of,
     and duplicates are stripped for salvage instead of wasting a crate. */
  private dropAttachment(at: THREE.Vector3) {
    const unowned = GUN_MODS.filter((m) => !this.ownedMods.includes(m.id));
    let pick: (typeof GUN_MODS)[number] | null = null;
    let tier = 1;
    if (unowned.length > 0) {
      let total = 0;
      for (const m of unowned) total += m.weight;
      let roll = Math.random() * total;
      pick = unowned[0];
      for (const m of unowned) {
        roll -= m.weight;
        if (roll <= 0) {
          pick = m;
          break;
        }
      }
    } else {
      /* everything owned — chance at a Mk.II upgrade for a part you have */
      const upgradable = GUN_MODS.filter((m) => (this.ownedTier[m.id] ?? 1) < 2);
      if (upgradable.length === 0) {
        this.score += 75;
        this.onEvent({ type: "pickup", text: "SPARE PARTS — +75 SALVAGE" });
        return;
      }
      pick = upgradable[(Math.random() * upgradable.length) | 0];
      tier = 2;
    }
    this.dropPickup(at, "attach", pick.id, tier);
  }

  /* Rarity tracks raw output — the harder a gun hits, the scarcer its
     supply. Pistol rounds are infinite so they never appear here. */
  private rollAmmoDrop(): PickupKind {
    const table: { kind: PickupKind; weight: number }[] = [
      { kind: "shells", weight: 5.0 }, /* shotgun shells — plentiful */
      { kind: "smg", weight: 3.0 }, /* smg rounds — uncommon */
      { kind: "belt", weight: 0.8 }, /* lmg belt — rare */
    ];
    let total = 0;
    for (const t of table) total += t.weight;
    let roll = Math.random() * total;
    for (const t of table) {
      roll -= t.weight;
      if (roll <= 0) return t.kind;
    }
    return "shells";
  }

  private dropPickup(at: THREE.Vector3, kind: PickupKind, modId?: GunModId, tier = 1) {
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
    } else if (kind === "attach" && modId) {
      /* gun-part crate — Mk.II cases glow hot so you never walk past one */
      const m = GUN_MODS.find((x) => x.id === modId);
      const glowCol = tier >= 2 ? "#ff6b1a" : m?.rarity === "epic" ? "#ff2e1f" : "#ffb42e";
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.4), new THREE.MeshLambertMaterial({ color: "#43403b", flatShading: true }));
      g.add(box);
      const glow = new THREE.MeshBasicMaterial({ color: glowCol });
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.05, 0.42), glow);
      lid.position.y = 0.18;
      g.add(lid);
      const gem = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), glow);
      gem.position.y = 0.34;
      gem.rotation.y = Math.PI / 4;
      g.add(gem);
      const beam = new THREE.PointLight(new THREE.Color(glowCol), tier >= 2 ? 30 : 16, 7, 1.8);
      beam.position.y = 0.6;
      g.add(beam);
    } else {
      /* per-cartridge supply crate — rarity reads in the paint */
      const palette: Record<Exclude<PickupKind, "health" | "attach">, { box: string; band: string }> = {
        shells: { box: "#7a3324", band: "#ff6b4a" }, /* common — red shotgun box */
        smg: { box: "#5c6248", band: "#a8c46a" }, /* uncommon — olive smg crate */
        belt: { box: "#3d4348", band: "#ffb42e" }, /* rare — dark lmg ammo can */
      };
      const c = palette[kind as keyof typeof palette];
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.36), new THREE.MeshLambertMaterial({ color: c.box, flatShading: true }));
      g.add(box);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.1, 0.38), new THREE.MeshBasicMaterial({ color: c.band }));
      g.add(band);
    }
    g.position.set(at.x, 0.3, at.z);
    this.scene.add(g);
    this.pickups.push({ group: g, kind, life: 18, modId, tier });
  }

  /* ============================== Weapons ============================== */

  private switchTo(idx: number) {
    if (idx === this.weaponIdx || this.wState === "lowering" || this.wState === "raising") return;
    /* key-mashing or wheel spam gets coalesced into one swap per beat */
    const now = performance.now();
    if (now - this.lastSwitchT < 120) return;
    this.lastSwitchT = now;
    this.vmRecoil[this.weaponIdx].settle(); /* holster the old gun's kick cleanly */
    this.pendingWeapon = idx;
    this.wState = "lowering";
    this.wT = 0.16;
    sfx.uiMove();
  }

  private startReload() {
    const w = WEAPONS[this.weaponIdx];
    if (this.wState === "reloading") return;
    if (this.mags[this.weaponIdx] >= this.effMagSize(this.weaponIdx)) return;
    if (this.reserves[this.weaponIdx] <= 0) return;
    this.wState = "reloading";
    this.wT = this.effReload(w);
    this.shellT = 0;
    sfx.reload(0);
  }

  /* ---- attachment effect helpers — every number is tier-aware (gunmods.ts) ---- */
  private hasMod(id: GunModId): boolean {
    return this.equippedMods[this.weaponIdx] === id;
  }
  private modTier(id: GunModId): number {
    return this.ownedTier[id] === 2 ? 2 : 1;
  }
  private modDmgMul(): number {
    let m = 1;
    if (this.hasMod("suppressor")) m *= this.modTier("suppressor") === 2 ? 0.94 : 0.88;
    if (this.hasMod("light")) m *= this.modTier("light") === 2 ? 1.08 : 1.05; /* dazzled targets */
    return m;
  }
  private modSpreadMul(): number {
    let m = 1;
    if (this.hasMod("suppressor") && this.modTier("suppressor") === 2) m *= 0.8; /* Mk.II tighter pattern */
    if (this.hasMod("brake")) m *= this.modTier("brake") === 2 ? 1.1 : 1.2; /* side-vented gas scatters */
    if (this.hasMod("laser")) m *= this.modTier("laser") === 2 ? 0.55 : 0.65;
    return m;
  }
  private modBloomMul(): number {
    if (this.hasMod("laser")) return this.modTier("laser") === 2 ? 0.7 : 0.8;
    return 1;
  }
  private modRecoilScale(): number {
    return this.hasMod("brake") ? (this.modTier("brake") === 2 ? 0.6 : 0.7) : 1;
  }
  private modTraumaScale(): number {
    return this.hasMod("brake") ? (this.modTier("brake") === 2 ? 0.7 : 0.8) : 1;
  }
  /** how far the mounted muzzle device sticks out past the muzzle anchor —
      flashes, puffs and tracers all start at the hardware's tip */
  private attachLen(): number {
    return this.hasMod("suppressor") ? 0.3 : this.hasMod("brake") ? 0.15 : 0;
  }
  private modSwayMul(): number {
    let m = 1;
    if (this.hasMod("mag")) m *= 1.15; /* heavier feed */
    if (this.hasMod("laser")) m *= this.modTier("laser") === 2 ? 1.05 : 1.1; /* nose-heavy */
    return m;
  }
  private effMagSize(idx: number): number {
    const w = WEAPONS[idx];
    if (this.equippedMods[idx] !== "mag") return w.magSize;
    return Math.round(w.magSize * (this.ownedTier.mag === 2 ? 1.75 : 1.5));
  }
  private reserveCap(idx: number): number {
    const base = [Infinity, 48, 144, 180][idx];
    return base * (this.equippedMods[idx] === "mag" ? (this.ownedTier.mag === 2 ? 1.5 : 1.3) : 1);
  }

  private effReload(w: WeaponDef): number {
    let t = w.reloadTime / this.reloadMul;
    if (this.hasMod("mag")) t *= this.modTier("mag") === 2 ? 1.15 : 1.2; /* heavy feed, longer swap */
    if (this.hasMod("laser")) t *= 1.1; /* rail clutter */
    return t;
  }

  /* non-linear shoulder speed: at or below SMG weight (~3.2 kg) the gun
     snaps to the sights at the classic rate; past that the rate falls off
     a weight curve — a slight lag on the shotgun, a deliberate heave on
     the LMG. Only genuinely heavy guns pay for their shoulder time. */
  private adsRate(raise: boolean): number {
    const over = Math.max(0, this.rigSpec.massKg - 3.2);
    return (raise ? 12 : 9) / (1 + 0.42 * Math.pow(over, 1.1));
  }

  private currentSpread(): number {
    const w = WEAPONS[this.weaponIdx];
    /* barrel heat — sustained fire blooms the cone; aim suppresses most of it */
    const bloom = this.heat * this.heat * w.bloom * this.modBloomMul();
    const base = w.spread * (1 - 0.45 * this.aimAmt) * this.modSpreadMul();
    const speed = Math.hypot(this.vel.x, this.vel.z);
    /* movement penalty is per-weapon: a sidearm fires true on the move,
       a hog's shots go wide the moment you take a step */
    let s = base + bloom * (1 - 0.85 * this.aimAmt) + speed * w.moveSpread;
    /* per-shot kick cone — full-auto stacks this; it decays between bursts */
    s += this.kickSpread * (1 - 0.6 * this.aimAmt);
    if (!this.grounded) s += 0.02 * (1 - 0.5 * this.aimAmt);
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
      sfx.pump();
    } else if (this.wState === "reloading") {
      return false;
    }

    this.mags[this.weaponIdx]--;
    this.fireCd = w.cooldown / this.fireMul;
    this.shotsFired++;
    /* handling cost of pulling the trigger: barrel heat + a decaying kick cone.
       Full-auto guns pay both every shot, so holding the mouse down widens
       the cone until only bursts are accurate. */
    this.heat = Math.min(1, this.heat + w.bloomRate);
    this.kickSpread = Math.min(0.06, this.kickSpread + w.spreadKick);
    /* viewmodel recoil choreography — each gun kicks in its own character */
    this.vmRecoil[this.weaponIdx].fire();
    /* ---- data-driven recoil (see recoil.ts): the gun's caliber, mass,
       bore height and body contact points solve the impulse — climb torque
       J·h/I, shoulder shove J/M, yaw/roll/drift from the gun's recoil
       velocity — then springs carry every axis back to rest ---- */
    /* a muzzle brake vents gas, trimming the effective impulse (and shake) */
    const recoilScale = this.modRecoilScale();
    this.yaw += this.rig.fire(this.rigSpec, this.aimAmt, recoilScale);
    this.fovKick += this.rigSpec.fovGain * this.rig.variance * RECOIL_INTENSITY * recoilScale * (0.6 + Math.random() * 0.4);
    this.trauma = Math.min(1.4, this.trauma + this.rigSpec.traumaGain * this.rig.variance * RECOIL_INTENSITY * recoilScale);
    this.ejectShell();
    const suppressed = this.hasMod("suppressor");
    if (suppressed) {
      /* a can swallows the fireball — just a lazy smoke puff at its tip */
      this.vmMuzzles[this.weaponIdx].getWorldPosition(this.tmpV);
      this.camera.getWorldDirection(this.tmpV2);
      this.tmpV.addScaledVector(this.tmpV2, this.attachLen());
      this.spawnParticles(this.tmpV.clone(), 4, ["#777773", "#5c5c58", "#91918a"], 0.35, 0.5, -0.35);
    } else {
      const flashMul = this.hasMod("brake") ? 1.25 : 1;
      if (this.gunLight)
        this.gunLight.intensity = (this.weaponIdx === 1 ? 26 : this.weaponIdx === 2 ? 9 : this.weaponIdx === 3 ? 17 : 14) * flashMul;
    }
    if (this.weaponIdx === 1) sfx.shotgun();
    else if (this.weaponIdx === 2) sfx.smg();
    else if (this.weaponIdx === 3) sfx.mg();
    else sfx.pistol();
    /* the heavy report startles raiders like a shotgun blast would */
    this.notifyShot(this.weaponIdx === 1 || this.weaponIdx === 3);
    if (!suppressed) this.spawnMuzzleFlash();

    const spread = this.currentSpread();
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const muzzle = this.vmMuzzles[this.weaponIdx];
    muzzle.getWorldPosition(this.tmpV);
    /* tracers and hits originate at the muzzle device's tip when one is mounted */
    const origin = this.tmpV.clone().addScaledVector(camDir, this.attachLen());

    const berserkOn = this.berserk && this.hp < this.maxHp * 0.4;
    const crit = Math.random() < this.critChance;
    /* flat weapon damage — crits triple it, headshots (below) double it */
    const dmg =
      w.dmg *
      this.dmgMul *
      this.modDmgMul() *
      (berserkOn ? 1 + 0.3 * this.berserkBonus : 1) *
      (crit ? 3 : 1);
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
            /* flat damage; a hit above the shoulders pays double */
            const head = hits[0].point.y - data.enemy.group.position.y > 1.42 * ENEMY_DEFS[data.enemy.kind as EnemyKind].scale;
            this.damageEnemy(data.enemy, dmg * (head ? 2 : 1), hits[0].point, head || crit, w.knock, dir, w.tag, w.ragdoll);
          } else if (data.kind === "barrel") {
            anyHit = true;
            this.hitBarrel(data.barrel, w.tag);
          } else {
            this.spawnParticles(hits[0].point, 5, ["#ffb42e", "#ff6b1a", "#8a7f70"], 3.5, 0.3, 8);
            if (Math.random() < 0.3) sfx.ricochet();
          }
        }
      }
      this.spawnTracer(origin, hitPoint, w.tracer);
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

  private damagePlayer(dmg: number, from?: THREE.Vector3, projectile = false) {
    if (this.phase !== "playing") return;
    if (this.debug) return; /* god mode — the foundry can't touch you */
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
    /* attacker bearing relative to the player's facing, for the damage arc */
    let dmgAngle = 0;
    if (from) {
      const toX = from.x - this.pos.x;
      const toZ = from.z - this.pos.z;
      const fwd = toX * -Math.sin(this.yaw) + toZ * -Math.cos(this.yaw);
      const rgt = toX * Math.cos(this.yaw) + toZ * -Math.sin(this.yaw);
      dmgAngle = Math.atan2(rgt, fwd); /* 0 = ahead, + = right, ±π = behind */
    }
    this.onEvent({ type: "damage", angle: dmgAngle });
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
    /* ---------- squad composition: a coherent shape, not a grab-bag ----------
       Wave 1 is a runner pack to learn on. Wave 2 adds a gunline. Wave 3+
       anchors the assault with heavies. Ratios shift so the mid game is
       balanced and the late game leans on guns and brutes. */
    const count = Math.min(3 + this.wave * 2 + Math.floor(this.wave * this.wave * 0.14), 24);
    const brutes = this.wave >= 3 ? Math.min(1 + Math.floor((this.wave - 3) / 2), 4) : 0;
    const base = count - brutes;
    /* leapers are the vanguard but never the whole wave; the gunline becomes
       the backbone from wave 4 onward, heavies anchor it from wave 3 */
    const runners = this.wave >= 2 ? Math.max(2, Math.round(base * 0.45)) : base;
    const scrappers = this.wave >= 2 ? Math.max(1, base - runners) : 0;

    /* ---------- split the squad into coordinated pulses ----------
       vanguard (skirmishers) hits first and fast, the gunline sets up a beat
       later to suppress, heavies anchor last. Each pours through its own gate
       so the assault arrives from several directions at once. */
    const gates: [number, number][] = [
      [0, -ARENA + 2.5],
      [0, ARENA - 2.5],
      [-ARENA + 2.5, 0],
      [52.0, 0], /* raiders pour in through the annex */
    ];
    for (let i = gates.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [gates[i], gates[j]] = [gates[j], gates[i]];
    }
    const fill = (n: number, k: EnemyKind): EnemyKind[] => new Array(n).fill(k);
    const pulses: SpawnPulse[] = [];
    /* sometimes the gunline leads with suppressing fire instead of the rush */
    const gunsFirst = this.wave >= 3 && Math.random() < 0.35;
    const push = (queue: EnemyKind[], delay: number, interval: number) => {
      if (queue.length > 0) pulses.push({ queue, gate: gates[pulses.length % gates.length], delay, interval, t: 0 });
    };
    if (gunsFirst) {
      push(fill(scrappers, "scrapper"), 0.4, 0.7);
      push(fill(runners, "runner"), 1.8, 0.5);
    } else {
      push(fill(runners, "runner"), 0.4, 0.5);
      push(fill(scrappers, "scrapper"), 1.8, 0.7);
    }
    push(fill(brutes, "brute"), 3.2, 1.0);

    this.spawnPulses = pulses;
    this.spawnT = 0.5;
    this.waveMode = "active";
    this.onEvent({ type: "wave", wave: this.wave, count: this.queuedCount() });
    sfx.waveHorn();
  }

  /** raiders still queued across all pulses */
  private queuedCount(): number {
    let n = 0;
    for (const p of this.spawnPulses) n += p.queue.length;
    return n;
  }

  /** tick every pulse, releasing raiders on their own schedule */
  private processSpawns(dt: number) {
    for (const p of this.spawnPulses) {
      if (p.queue.length === 0) continue;
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.t -= dt;
      if (p.t <= 0) {
        const kind = p.queue.shift();
        if (kind) this.spawnFromPulse(kind, p.gate);
        p.t = p.interval * (0.7 + Math.random() * 0.6);
      }
    }
    this.spawnPulses = this.spawnPulses.filter((p) => p.queue.length > 0 || p.delay > 0);
  }

  private spawnFromPulse(kind: EnemyKind, gate: [number, number]) {
    if (this.enemies.filter((e) => e.state !== "dead").length >= 20) {
      return;
    }
    const [gx, gz] = gate;
    const x = gx + (Math.abs(gx) > 1 ? 0 : (Math.random() - 0.5) * 10);
    const z = gz + (Math.abs(gz) > 1 ? 0 : (Math.random() - 0.5) * 10);
    const e = this.buildEnemy(kind, x, z);
    this.enemies.push(e);
    this.tmpV.set(x, 0.5, z);
    this.spawnParticles(this.tmpV, 14, ["#ff2e1f", "#7a1a10"], 4, 0.5, 6);
    sfx.spawnRoar();
    for (const gl of this.gateLights) gl.intensity = 90;
  }

  private clearWave() {
    const bonus = 250 * this.wave;
    this.score += bonus;
    this.hp = Math.min(this.maxHp, this.hp + 12);
    this.reserves[1] = Math.min(this.reserveCap(1), this.reserves[1] + 10);
    this.reserves[2] = Math.min(this.reserveCap(2), this.reserves[2] + 24);
    this.reserves[3] = Math.min(this.reserveCap(3), this.reserves[3] + 30);
    this.onEvent({ type: "cleared", wave: this.wave, bonus });
    sfx.waveClear();
    if (this.wave % 3 === 0) this.offerDraft();
    else this.startIntermission();
  }

  /* ============================== Skill draft ============================== */

  private rollCards(n: number): SkillCard[] {
    type PoolItem = { weight: number; card: SkillCard };
    const pool: PoolItem[] = [];
    /* player skills only — attachments are floor loot now (see Gun Locker) */
    for (const s of SKILLS) {
      if ((this.skillLevels[s.id] ?? 0) >= s.maxLevel) continue;
      pool.push({
        weight: s.weight,
        card: { id: s.id, name: s.name, desc: s.desc, tag: s.tag, rarity: s.rarity, level: this.skillLevels[s.id] ?? 0, maxLevel: s.maxLevel },
      });
    }
    const cards: SkillCard[] = [];
    while (cards.length < n && pool.length > 0) {
      let total = 0;
      for (const it of pool) total += it.weight;
      let roll = Math.random() * total;
      let idx = 0;
      for (let i = 0; i < pool.length; i++) {
        roll -= pool[i].weight;
        if (roll <= 0) {
          idx = i;
          break;
        }
      }
      cards.push(pool[idx].card);
      pool.splice(idx, 1);
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

  /* ============================== Gun Locker ============================== */

  /* B — freeze the floor and open the attachment bench (App renders it).
     Pressing B again closes the bench back to the normal pause screen. */
  private toggleLocker() {
    if (this.phase === "playing") {
      this.sanitizeInput();
      this.phase = "paused";
      this.onEvent({ type: "paused" });
      this.lockerOpen = true;
      this.emitLocker(true);
      if (document.pointerLockElement === this.canvas) {
        try {
          document.exitPointerLock();
        } catch {
          /* already unlocked */
        }
      }
    } else if (this.phase === "paused") {
      this.lockerOpen = !this.lockerOpen;
      this.emitLocker(this.lockerOpen);
    }
  }

  /* called from the pause menu's GUN LOCKER button */
  openLockerFromPause() {
    if (this.phase !== "paused") return;
    this.lockerOpen = true;
    this.emitLocker(true);
  }

  private emitLocker(open: boolean) {
    this.onEvent({
      type: "locker",
      open,
      owned: [...this.ownedMods],
      tiers: { ...this.ownedTier } as Record<string, number>,
      equipped: [...this.equippedMods],
    });
  }

  equipMod(slot: number, id: string) {
    const mid = id as GunModId;
    if (slot < 0 || slot > 3 || !this.ownedMods.includes(mid)) return;
    this.equippedMods[slot] = mid;
    this.refreshModVisuals();
    sfx.reload(2);
    this.emitLocker(this.lockerOpen);
  }

  unequipMod(slot: number) {
    if (slot < 0 || slot > 3 || !this.equippedMods[slot]) return;
    this.equippedMods[slot] = null;
    this.refreshModVisuals();
    sfx.reload(0);
    this.emitLocker(this.lockerOpen);
  }

  /* ============================== debug ============================== */

  private debug = false;

  /** F9 — toggle god mode, grant the full Mk.II locker and top everything up.
      Parts stay granted when it's switched off; only the invincibility goes. */
  toggleDebug() {
    if (this.phase !== "playing" && this.phase !== "paused") return;
    this.debug = !this.debug;
    if (this.debug) {
      for (const m of GUN_MODS) {
        if (!this.ownedMods.includes(m.id)) this.ownedMods.push(m.id);
        this.ownedTier[m.id] = 2;
      }
      /* mount the laser on every rail so the aim ray is visible everywhere */
      this.equippedMods = ["laser", "laser", "laser", "laser"];
      this.refreshModVisuals();
      /* full heal, full mags, full reserves */
      this.hp = this.maxHp;
      this.mags = WEAPONS.map((wp, i) => this.effMagSize(i) || wp.magSize);
      this.reserves = [Infinity, this.reserveCap(1), this.reserveCap(2), this.reserveCap(3)];
      sfx.waveClear();
    }
    this.onEvent({ type: "debug", on: this.debug });
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
    /* outer shell: hall to the west, annex extending east to the back wall */
    p.x = Math.max(-ARENA + r, Math.min(52.4 - r, p.x));
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
    let dt = rawDt * slow;
    /* micro hit-stop on a fresh kill — the world blinks, then catches up */
    if (this.hitstop > 0) {
      this.hitstop -= rawDt;
      dt *= 0.15;
    }

    /* ambient life */
    for (const l of this.lamps) {
      const n = Math.sin(t * 9 + l.seed) * 0.5 + Math.sin(t * 23.7 + l.seed * 2) * 0.5;
      let i = l.base * (0.86 + 0.14 * n);
      if (l.broken) i = Math.random() < 0.86 ? l.base * (0.5 + Math.random() * 0.5) : l.base * 0.06;
      l.light.intensity = i;
    }
    for (const gl of this.gateLights) gl.intensity += (26 - gl.intensity) * Math.min(1, dt * 6);
    for (const f of this.fans) f.rotation.z += dt * 4.5;
    this.updateMotes(dt);
    /* furnace embers — a few live sparks drift up from the smelter mouth */
    this.emberT -= dt;
    if (this.emberT <= 0) {
      this.emberT = 0.4 + Math.random() * 0.3;
      this.tmpV3.set((Math.random() - 0.5) * 1.6, 1.7 + Math.random() * 0.4, 1.2 + (Math.random() - 0.5) * 0.5);
      this.spawnParticles(this.tmpV3.clone(), 2, ["#ff6b1a", "#ffb42e", "#ff9040"], 0.5, 1.1, -1.6);
    }

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
    /* ext. mag lugs a little weight; a flashlight costs a touch of speed */
    const modMove = (this.hasMod("mag") ? 0.95 : 1) * (this.hasMod("light") ? 0.97 : 1);
    const speed = (sprint ? 8.4 : 5.8) * (1 - 0.45 * this.aimAmt) * this.speedMul * berserkSpd * WEAPONS[this.weaponIdx].moveMul * modMove;
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
    const sens = 0.0022 * this.lookSens;
    this.yaw -= this.mouseDX * sens;
    this.pitch -= this.mouseDY * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    /* gun sway spring gets an impulse from look velocity (damped while aiming).
       Heavier guns resist the flick: impulse response falls off ~1/√mass */
    const swDamp = 1 - 0.55 * this.aimAmt;
    const swImp = (1 / Math.sqrt(this.rigSpec.massKg / 1.5)) * this.modSwayMul();
    this.swayVX += this.mouseDX * 0.011 * swDamp * swImp;
    this.swayVY += this.mouseDY * 0.009 * swDamp * swImp;
    this.mouseDX = 0;
    this.mouseDY = 0;

    /* apply view immediately so firing rays match the on-screen aim */
    this.camera.rotation.set(this.pitch + this.rig.camPitch + this.aimPitch, this.yaw + this.rig.camYaw + this.aimYaw, 0);
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

    /* low-integrity heartbeat — faster and louder the closer to scrap */
    if (this.phase === "playing" && this.hp > 0 && this.hp < 30) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        const urgency = 1 - this.hp / 30; /* 0 at 30hp → 1 at 0hp */
        this.heartT = 1.05 - urgency * 0.55;
        sfx.heartbeat(0.5 + urgency * 0.5);
      }
    }

    /* ---------- weapons ---------- */
    this.fireCd -= dt;
    this.heat = Math.max(0, this.heat - dt * WEAPONS[this.weaponIdx].bloomRecover);
    /* the kick cone settles between bursts — fire control is rewarded */
    this.kickSpread = Math.max(0, this.kickSpread - dt * 0.09);
    /* recoil rig — every axis is an under-damped spring settling to rest */
    this.rig.update(dt, this.rigSpec, this.aimAmt);
    /* the shooter fights the kick while aimed — but only as far as the gun
       allows. A pistol or shotgun re-acquires the target between shots; the
       HOG's full-auto climb is barely countered, so it rides up on you. */
    this.aimYaw = -this.rig.camYaw * this.aimAmt * Math.min(0.9, this.rigSpec.adsControl * 1.5);
    this.aimPitch = -this.rig.camPitch * this.aimAmt * this.rigSpec.adsControl;
    this.fovKick *= Math.exp(-8 * dt);
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
          /* the new gun brings its own ballistic spec; kill inherited motion */
          this.rigSpec = RECOIL_SPECS[this.weaponIdx];
          this.rig.softReset();
          this.refreshModVisuals();
          this.wState = "raising";
          this.wT = 0.2;
        } else {
          this.wState = "idle";
          sfx.equip(this.weaponIdx); /* each gun announces itself as it comes up */
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
          if (this.mags[1] >= this.effMagSize(1) || this.reserves[1] <= 0) {
            this.wState = "idle";
            sfx.reload(2);
          }
        }
      } else {
        this.wT -= dt;
        if (this.wT <= 0) {
          const take = Math.min(this.effMagSize(this.weaponIdx) - this.mags[this.weaponIdx], this.reserves[this.weaponIdx]);
          this.mags[this.weaponIdx] += take;
          if (isFinite(this.reserves[this.weaponIdx])) this.reserves[this.weaponIdx] -= take;
          sfx.reload(2);
          this.wState = "idle";
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
    /* time-to-aim is per-weapon: a sidearm snaps up, a hog takes a beat to
       shoulder — so heavy guns can't react-aim, they must be committed */
    this.aimAmt += (wantAim - this.aimAmt) * Math.min(1, dt * this.adsRate(wantAim > 0));
    const aim = this.aimAmt;

    /* ---------- sway spring integration — per-gun: light guns are springy
       and lively in the hands, heavy guns are damped and inertial ---------- */
    const swSt = this.rigSpec.swayStiff;
    const swDm = this.rigSpec.swayDamp;
    this.swayVX += (-this.swayX * swSt - this.swayVX * swDm) * dt;
    this.swayVY += (-this.swayY * swSt - this.swayVY * swDm) * dt;
    this.swayX += this.swayVX * dt;
    this.swayY += this.swayVY * dt;
    const swX = Math.max(-0.09, Math.min(0.09, this.swayX));
    const swY = Math.max(-0.07, Math.min(0.07, this.swayY));

    /* ---------- weapon timers ---------- */
    /* the active gun's recoil choreography advances every frame */
    this.vmRecoil[this.weaponIdx].update(dt);
    if (this.rackT >= 0) {
      this.rackT += dt;
      if (this.rackT > 0.36) this.rackT = -1;
    }

    /* ---------- viewmodel pose ---------- */
    const vm = this.vmGroups[this.weaponIdx];
    /* hip base vs aimed base (centered, pulled in, raised) */
    const baseX = this.vmBase.x * (1 - aim) + 0.0 * aim;
    const baseY = this.vmBase.y * (1 - aim) + -0.165 * aim;
    const baseZ = this.vmBase.z * (1 - aim) + -0.34 * aim;
    const idleAmp = 1 - aim * 0.85;
    /* handling wander — the gun drifts in your hands by its swayAmp, and
       aiming only calms it by swaySettle. A hog never truly settles, so its
       model keeps lurching even when braced — the visual echo of its spread. */
    const sway = w.swayAmp * (1 - aim * 0.85 * w.swaySettle);
    /* per-weapon recoil choreography (see gunrecoil.ts): every gun kicks in
       its own voice — the pistol snaps, the breaker shoves and racks, the
       wespe chatters, the hog heaves and hangs. The camera keeps its own
       smoothed feel, so the gun visibly leads the eye. */
    const rp = this.vmRecoil[this.weaponIdx].pose();
    /* human hold-sway — a held gun never sits perfectly still */
    const hsx = this.rig.holdX;
    const hsy = this.rig.holdY;
    let vy = baseY + this.bobY * 0.6 * idleAmp + Math.sin(this.bobT) * bobAmp * 0.6 * idleAmp - swY * 0.4 * sway - rp.dip + hsy * 0.009 * sway;
    let vx = baseX + Math.sin(this.bobT * 0.5) * bobAmp * 0.4 * idleAmp + swX * 0.45 * sway + hsx * 0.012 * sway;
    let vz = baseZ + rp.push + swY * 0.12 * sway;
    let vrx = rp.rise + swY * 1.1 * sway + hsy * 0.02 * sway;
    let vry = -swX * 0.9 * sway + hsx * 0.022 * sway;
    let vrz = Math.sin(this.bobT) * bobAmp * 0.3 * idleAmp + swX * 0.5 * sway + rp.roll;

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
      } else if (this.weaponIdx === 1) {
        /* shotgun: nose up, each shell shoved in with a wrist twist */
        vy -= 0.14;
        vrx = -0.5;
        const shellPh = Math.sin((this.shellT / this.effReload(w)) * Math.PI);
        vy -= 0.05 * shellPh;
        vrz += 0.3 * shellPh;
        vx -= 0.03 * shellPh;
      } else if (this.weaponIdx === 3) {
        /* MG: nose down, swap the heavy box mag — slow deliberate tilt */
        const prog = 1 - this.wT / this.effReload(w);
        const dip = Math.sin(prog * Math.PI);
        vy -= 0.24 * dip;
        vrx = -0.6 * dip;
        vrz += 0.3 * dip;
        vx += 0.04 * dip;
      } else {
        /* SMG: cant the gun out and yank the grip mag */
        const prog = 1 - this.wT / this.effReload(w);
        const dip = Math.sin(prog * Math.PI);
        vy -= 0.26 * dip;
        vrx = -0.45 * dip;
        vrz = -0.55 * dip;
        vx += 0.09 * dip;
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

    /* ---------- animated gun parts ----------
       the recoil driver hands each gun its operating-part stroke: the slide
       whips, the open bolt buzzes, the heavy carrier drags, the pump racks. */
    const mech = rp.mech;
    if (this.vmSlide) this.vmSlide.position.z = -0.08 + (this.weaponIdx === 0 ? mech : 0);
    if (this.vmBolt) this.vmBolt.position.z = -0.12 + (this.weaponIdx === 2 ? mech : 0);
    if (this.vmMgBolt) this.vmMgBolt.position.z = 0.02 + (this.weaponIdx === 3 ? mech : 0);
    if (this.vmPump) {
      let pz = this.weaponIdx === 1 ? mech : 0;
      if (this.rackT >= 0) {
        pz = Math.max(pz, Math.sin(Math.min(1, this.rackT / 0.36) * Math.PI) * 0.06);
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
      this.processSpawns(dt);
      if (this.queuedCount() === 0 && this.enemies.every((e) => e.state === "dead")) {
        this.clearWave();
      }
    }

    /* ---------- squad brain: read the battlefield so archetypes interlock ---------- */
    this.updateSquadBrain();

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
        } else if (p.kind === "shells") {
          this.reserves[1] = Math.min(this.reserveCap(1), this.reserves[1] + 6);
          this.onEvent({ type: "pickup", text: "+6 SHOTGUN SHELLS" });
        } else if (p.kind === "smg") {
          this.reserves[2] = Math.min(this.reserveCap(2), this.reserves[2] + 24);
          this.onEvent({ type: "pickup", text: "+24 SMG ROUNDS" });
        } else if (p.kind === "belt") {
          this.reserves[3] = Math.min(this.reserveCap(3), this.reserves[3] + 30);
          this.onEvent({ type: "pickup", text: "+30 LMG BELT" });
        } else if (p.kind === "attach" && p.modId) {
          /* pocket the part — it waits in the Gun Locker until mounted */
          const m = GUN_MODS.find((x) => x.id === p.modId);
          if (!this.ownedMods.includes(p.modId)) {
            this.ownedMods.push(p.modId);
            this.ownedTier[p.modId] = p.tier ?? 1;
            this.onEvent({ type: "pickup", text: `${m?.name ?? "GUN PART"} ${tierLabel(p.tier ?? 1)} — PRESS [B] TO MOUNT` });
          } else {
            this.ownedTier[p.modId] = Math.max(this.ownedTier[p.modId] ?? 1, p.tier ?? 1);
            this.onEvent({ type: "pickup", text: `${m?.name ?? "GUN PART"} UPGRADED TO ${tierLabel(p.tier ?? 1)}` });
          }
          sfx.waveClear();
          p.life = 0;
          continue;
        }
        sfx.pickup(p.kind === "health" ? "health" : "ammo");
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
    this.updateEnemyBullets(dt);
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
    this.camera.rotation.set(this.pitch + this.rig.camPitch + this.aimPitch, this.yaw + this.rig.camYaw + this.aimYaw, shR);

    /* glue the laser dot to whatever the beam hits this frame */
    this.updateLaser();

    /* ---------- HUD ---------- */
    const alive = this.enemies.filter((e) => e.state !== "dead").length + this.queuedCount();
    const eq = this.equippedMods[this.weaponIdx];
    const modKey = `${this.weaponIdx}|${eq ?? "-"}`;
    if (modKey !== this.modsCacheKey) {
      this.modsCacheKey = modKey;
      const m = eq ? GUN_MODS.find((x) => x.id === eq) : undefined;
      this.modsCache = m ? [m.short] : [];
    }
    this.onHud({
      hp: Math.ceil(this.hp),
      maxHp: this.maxHp,
      ammo: this.mags[this.weaponIdx],
      reserve: this.weaponIdx === 0 ? -1 : this.reserves[this.weaponIdx],
      weapon: this.weaponIdx,
      weaponName: w.name,
      ammoLine:
        w.pellets > 1
          ? `${w.dmg}×${w.pellets} DMG · PUMP · ${w.ammoName}`
          : `${w.dmg} DMG · ${(1 / w.cooldown).toFixed(1)} RPS · ${w.ammoName}`,
      mods: this.modsCache,
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
      lowAmmo: this.mags[this.weaponIdx] <= Math.ceil(this.effMagSize(this.weaponIdx) * 0.25),
      combo: this.combo > 1 ? this.combo : 0,
      enemiesLeft: this.waveMode === "active" ? alive : 0,
    });
  }

  private semiLock = false;

  /* The squad reads the battlefield once per frame and each archetype keys
     off the result: melee push harder under covering fire, gunners back off
     and open lanes when melee is in the player's face, and everyone spreads. */
  private updateSquadBrain() {
    let meleeEngaged = false;
    let gunnersFiring = 0;
    let brutes = 0;
    for (const e of this.enemies) {
      if (e.state === "dead" || e.state === "rise") continue;
      if (e.kind === "scrapper") {
        if (e.state === "windup" || e.state === "strike") gunnersFiring++;
      } else {
        brutes += e.kind === "brute" ? 1 : 0;
        const d = Math.hypot(this.pos.x - e.group.position.x, this.pos.z - e.group.position.z);
        if (d < 3.4 || e.state === "windup" || e.state === "strike" || e.state === "charge") meleeEngaged = true;
      }
    }
    this.squadMeleeEngaged = meleeEngaged;
    this.squadGunnersFiring = gunnersFiring;
    this.squadBrutesActive = brutes > 0;
  }

  private updateEnemy(e: Enemy, dt: number, t: number) {
    e.flash = Math.max(0, e.flash - dt * 6);
    for (const m of e.rig.flashMats) m.emissive.setRGB(e.flash * 0.85, e.flash * 0.1, e.flash * 0.04);
    e.rig.eyeMat.color.copy(e.rig.eyeBase).lerp(FLASH_WHITE, e.flash * 0.8);
    e.attackCd -= dt;
    e.feintCd -= dt;

    /* desperation — wounded raiders fight faster, eyes burning */
    if (!e.enraged && e.state !== "dead" && e.hp < e.maxHp * 0.25) {
      e.enraged = true;
      e.speed *= 1.18;
      sfx.spawnRoar();
    }
    if (e.enraged) {
      e.rig.eyeMat.color.lerp(FLASH_WHITE, (Math.sin(t * 9 + e.rig.seed) + 1) * 0.3);
    }

    /* damage gauge — lights up on the first hit, drains left-to-right,
       hue slides green → red as the raider nears scrap */
    e.barMat.opacity = e.state === "dead" || e.state === "rise" ? 0 : e.hp < e.maxHp ? 0.95 : 0;
    e.barBackMat.opacity = e.barMat.opacity * 0.75;
    const ratio = Math.max(0, Math.min(1, e.hp / e.maxHp));
    e.barFill.scale.x = Math.max(0.001, ratio);
    e.barFill.position.x = -(1 - ratio) * 0.43;
    e.barMat.color.setHSL(0.33 * ratio, 0.9, 0.55);

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
      /* per-raider hesitation — a brief stumble keeps the rush organic */
      e.hesitateCd -= dt;
      if (e.hesitateCd <= 0) {
        e.hesitateT = 0.15 + Math.random() * 0.35;
        e.hesitateCd = 2.5 + Math.random() * 3;
      }
      if (e.hesitateT > 0) e.hesitateT -= dt;
      const hesitating = e.hesitateT > 0;
      /* melee close faster while their gunners lay down covering fire */
      const covering = e.kind !== "scrapper" && this.squadGunnersFiring > 0 ? 1.22 : 1;
      const sp = e.speed * stunMul * e.aggression * covering;
      const tangX = -dirZ * e.orbitDir;
      const tangZ = dirX * e.orbitDir;
      const orbitR = e.range * 1.3;
      let moveX = 0;
      let moveZ = 0;
      let moveMul = 1;

      if (e.kind === "scrapper") {
        /* GUNNER: holds a firing lane on an arc at its flank side. It drifts
           along the arc, periodically shifts to a fresh lane so the squad's
           fire spreads, and yields ground when melee is in the thick of it
           so the lanes stay clear. */
        e.repositionT -= dt;
        if (e.repositionT <= 0) {
          e.laneTarget = e.laneAngle + (Math.random() - 0.5) * 1.7 + e.flank * 0.4;
          e.repositionT = 2.5 + Math.random() * 3;
        }
        let dAng = e.laneTarget - e.laneAngle;
        while (dAng > Math.PI) dAng -= Math.PI * 2;
        while (dAng < -Math.PI) dAng += Math.PI * 2;
        e.laneAngle += dAng * Math.min(1, dt * 1.3);
        /* hold a lane inside the firing band — it may shift with the fight,
           but never drift so far out that the gun can't reach */
        const desired = Math.min(
          e.range + 0.6,
          e.range * 0.8 + e.caution * 1.2 + (this.squadMeleeEngaged ? 2.2 : 0) + (this.squadBrutesActive ? 0.6 : 0)
        );
        const tx = this.pos.x + Math.sin(e.laneAngle) * desired;
        const tz = this.pos.z + Math.cos(e.laneAngle) * desired;
        moveX = tx - e.group.position.x;
        moveZ = tz - e.group.position.z;
        const md = Math.hypot(moveX, moveZ);
        moveMul = md < 0.7 ? 0 : Math.min(1, md / 2.5);
        /* pressed at close range — give ground fast, gun still up.
           This is what makes them a gunner instead of a brawler. */
        if (dist < 4.2) {
          moveX = -dirX;
          moveZ = -dirZ;
          moveMul = 1.35;
        }
      } else if (!canAttack && dist < orbitR + 1.4) {
        /* denied the attack token — pace just out of reach on your own side,
           hunting an opening instead of piling in */
        const radial = Math.max(-0.85, Math.min(0.85, (dist - orbitR) * 0.8));
        moveX = tangX * 0.95 + dirX * radial;
        moveZ = tangZ * 0.95 + dirZ * radial;
        moveMul = 0.85 * (hesitating ? 0.5 : 1);
      } else if (e.kind === "runner") {
        /* LANCER: stalks in from its assigned flank, wide at range, then
           squares up once inside leap distance and crouches for the spring */
        const sweep = Math.max(0, Math.min(1, (dist - 6.5) / 6));
        const off = e.flank * 3.4 * sweep;
        const tx = this.pos.x - dirZ * off;
        const tz = this.pos.z + dirX * off;
        const ax = tx - e.group.position.x;
        const az = tz - e.group.position.z;
        const ad = Math.hypot(ax, az) || 1;
        const wob = Math.sin(e.wobble * 2.2) * 0.16;
        moveX = ax / ad + -dirZ * wob;
        moveZ = az / ad + dirX * wob;
        moveMul = (hesitating ? 0.3 : 1) * (dist < e.range ? 0.25 : 1);
      } else {
        /* HEAVY: the slow, steady anchor — a slight lane offset keeps
           multiple brutes from stacking on the same point */
        const off = e.flank * 1.5;
        const tx = this.pos.x - dirZ * off;
        const tz = this.pos.z + dirX * off;
        const ax = tx - e.group.position.x;
        const az = tz - e.group.position.z;
        const ad = Math.hypot(ax, az) || 1;
        moveX = ax / ad;
        moveZ = az / ad;
        moveMul = (hesitating ? 0.4 : 1) * 0.92;
      }
      const ml = Math.hypot(moveX, moveZ) || 1;
      e.mvx = (moveX / ml) * sp * moveMul;
      e.mvz = (moveZ / ml) * sp * moveMul;
      e.group.position.x += e.mvx * dt + e.kvx * dt;
      e.group.position.z += e.mvz * dt + e.kvz * dt;

      e.walkT += dt * sp * 1.9;

      /* separation — gunners keep a wide firing line so the squad spreads
         into distinct lanes instead of bunching on one ray */
      for (const o of this.enemies) {
        if (o === e || o.state === "dead") continue;
        const sx = e.group.position.x - o.group.position.x;
        const sz = e.group.position.z - o.group.position.z;
        const sd = Math.hypot(sx, sz);
        const bothRanged = e.kind === "scrapper" && o.kind === "scrapper";
        const min = bothRanged ? 2.8 : 0.85 * ENEMY_DEFS[e.kind].scale;
        if (sd < min && sd > 0.001) {
          const push = bothRanged ? 0.7 : 0.5;
          e.group.position.x += (sx / sd) * (min - sd) * push;
          e.group.position.z += (sz / sd) * (min - sd) * push;
        }
      }
      this.collideCircle(e.group.position, 0.45 * ENEMY_DEFS[e.kind].scale);

      /* face player */
      const targetRot = Math.atan2(dx, dz);
      let dr = targetRot - e.group.rotation.y;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      e.group.rotation.y += dr * Math.min(1, dt * 10);

      /* anti-stuck — wedged behind cover? flip orbit side and back off.
         (skipped when the raider is deliberately holding position) */
      const moved = Math.hypot(e.group.position.x - prevX, e.group.position.z - prevZ);
      if (moveMul > 0.2 && moved < sp * 0.3 * dt) e.stuckT += dt;
      else if (moveMul > 0.2) e.stuckT = 0;
      if (e.stuckT > 0.65) {
        e.stuckT = 0;
        e.orbitDir *= -1;
        e.group.position.x -= dirX * 0.4;
        e.group.position.z -= dirZ * 0.4;
      }

      /* attack triggers, per archetype */
      const inReach =
        e.kind === "scrapper"
          ? dist < e.range + 0.8 && dist > 2.0 /* gunline fires from its whole lane */
          : e.kind === "runner"
            ? dist < e.range /* leapers spring from ~5 m */
            : dist < e.range;
      if (inReach && canAttack) {
        e.state = "windup";
        e.stateT = 0;
        if (e.kind === "scrapper") {
          /* staggered group fire — each gun waits its turn, so volleys arrive
             in waves instead of one wall of lead */
          const gunsInVolley = this.enemies.filter((o) => o !== e && o.kind === "scrapper" && o.state !== "dead" && (o.state === "windup" || o.state === "strike")).length;
          e.attackCd = 2.3 + Math.min(gunsInVolley, 3) * 0.5 + Math.random() * 0.9;
        }
      } else if (e.kind === "brute" && e.attackCd <= 0 && tokens < this.maxAttackers() && dist > 3.5 && dist < 16) {
        /* bull rush is the brute's primary way of crossing the floor —
           it doesn't slowly shuffle, it launches */
        e.state = "charge";
        e.stateT = 0;
        e.chargeLocked = false;
        e.attackCd = 2.0;
        sfx.spawnRoar();
        this.trauma = Math.min(1.4, this.trauma + 0.12);
      }
    } else if (e.state === "windup") {
      e.stateT += dt;
      if (e.stateT >= WINDUP_TIME[e.kind] * windupMul) {
        e.state = "strike";
        e.stateT = 0;
        if (e.kind === "scrapper") {
          e.burst = 3;
          e.burstT = 0;
        } else if (e.kind === "runner") {
          /* the spring re-aims at launch — it tracked you through the crouch */
          e.chargeDirX = dirX;
          e.chargeDirZ = dirZ;
          sfx.spawnRoar();
        } else {
          sfx.swing();
          /* brutes get their big red arc on the impact frame instead */
          this.spawnSwipe(e.group.position, Math.atan2(dx, dz), ENEMY_DEFS[e.kind].scale, false);
        }
      }
    } else if (e.state === "strike") {
      e.stateT += dt;
      if (e.kind === "scrapper") {
        /* burst fire — three quick scrap shots, accuracy improving per wave */
        e.burstT -= dt;
        if (e.burstT <= 0 && e.burst > 0) {
          e.burst--;
          e.burstT = 0.19;
          const spreadMul = Math.max(0.62, 1 - (this.wave - 1) * 0.03);
          this.spawnRaiderBullet(e, spreadMul);
        }
        if (e.burstT > 0.05) {
          /* hold position while firing, tracking the target */
          const targetRot = Math.atan2(dx, dz);
          let dr = targetRot - e.group.rotation.y;
          while (dr > Math.PI) dr -= Math.PI * 2;
          while (dr < -Math.PI) dr += Math.PI * 2;
          e.group.rotation.y += dr * Math.min(1, dt * 9);
        }
        if (e.burst <= 0 && e.burstT <= 0) {
          e.state = "chase";
        }
      } else if (e.kind === "runner") {
        /* the spring — an arcing leap along the locked direction. It covers
           ~4 m in a fifth of a second; anything underneath lands hurt. */
        const leapDur = 0.2;
        if (e.stateT < leapDur) {
          const ls = 20;
          e.group.position.x += e.chargeDirX * ls * dt;
          e.group.position.z += e.chargeDirZ * ls * dt;
          e.group.position.y = Math.sin(Math.min(1, e.stateT / leapDur) * Math.PI) * 1.0;
          this.collideCircle(e.group.position, 0.4);
          if (Math.hypot(this.pos.x - e.group.position.x, this.pos.z - e.group.position.z) < 1.3) {
            this.damagePlayer(e.dmg, e.group.position);
            e.stateT = leapDur; /* connected — land early */
          }
        } else {
          e.group.position.y = 0;
          if (e.stateT >= leapDur + 0.28) {
            /* landing recovery — your window to answer */
            e.attackCd = 1.5 * (e.enraged ? 0.72 : 1);
            e.state = "chase";
          }
        }
      } else {
        /* brute cleave impact frame */
        if (e.stateT >= 0.09 && e.stateT - dt < 0.09) {
          /* wide cleave — the maul's arc and its shockwave catch everything close */
          this.spawnSwipe(e.group.position, e.group.rotation.y, ENEMY_DEFS.brute.scale, true);
          this.trauma = Math.min(1.4, this.trauma + 0.32);
          this.tmpV3.copy(e.group.position);
          this.tmpV3.y += 0.12;
          this.spawnParticles(this.tmpV3, 12, ["#4a3c2a", "#2a231b", "#8a7f70", "#ffb42e"], 3.0, 0.42, 7);
          sfx.barrelClang();
          if (dist < 3.6) {
            this.damagePlayer(e.dmg, e.group.position);
            /* the slam shoves you off your footing */
            const sh = 1.15;
            this.pos.x = Math.max(-30, Math.min(51.4, this.pos.x + (dx / dist) * sh));
            this.pos.z = Math.max(-30, Math.min(30, this.pos.z + (dz / dist) * sh));
          }
        }
        if (e.stateT >= 0.4) {
          e.attackCd = 1.3 * (e.enraged ? 0.72 : 1);
          e.state = "chase";
        }
      }
    } else if (e.state === "charge") {
      e.stateT += dt;
      const tele = 0.55;
      if (e.stateT < tele) {
        /* stomping telegraph — paws the floor and tracks you, daring a dodge */
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
        e.group.rotation.y += dr * Math.min(1, dt * 8);
      } else {
        if (!e.chargeLocked) {
          e.chargeLocked = true;
          e.chargeDirX = dirX;
          e.chargeDirZ = dirZ;
          sfx.spawnRoar();
        }
        /* for the first beat of the rush the brute can still steer — a lazy
           sidestep gets clipped, only a committed dodge is safe */
        const steer = 0.4;
        if (e.stateT - tele < steer) {
          const want = Math.atan2(dx, dz);
          const cur = Math.atan2(e.chargeDirX, e.chargeDirZ);
          let dd = want - cur;
          while (dd > Math.PI) dd -= Math.PI * 2;
          while (dd < -Math.PI) dd += Math.PI * 2;
          dd = Math.max(-2.3 * dt, Math.min(2.3 * dt, dd));
          const ang = cur + dd;
          e.chargeDirX = Math.sin(ang);
          e.chargeDirZ = Math.cos(ang);
          e.group.rotation.y = ang;
        }
        const rush = 10.2;
        const px = e.group.position.x;
        const pz = e.group.position.z;
        e.group.position.x += e.chargeDirX * rush * dt;
        e.group.position.z += e.chargeDirZ * rush * dt;
        this.collideCircle(e.group.position, 0.5 * ENEMY_DEFS[e.kind].scale);
        e.walkT += dt * 15;
        const adv = Math.hypot(e.group.position.x - px, e.group.position.z - pz);
        const dNow = Math.hypot(this.pos.x - e.group.position.x, this.pos.z - e.group.position.z);
        if (dNow < 1.6) {
          /* trampled */
          this.damagePlayer(e.dmg * 1.75, e.group.position);
          this.trauma = Math.min(1.4, this.trauma + 0.5);
          sfx.barrelClang();
          e.state = "stagger";
          e.stateT = 0;
        } else if (adv < rush * dt * 0.4 || e.stateT - tele > 1.05) {
          /* the rush always ends in a ground slam — dangerous even when the
             trample whiffs. The recovery afterwards is your opening. */
          this.bruteSlam(e);
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
    /* suppressor muffles the report; a laser/light gives your position away */
    const quiet = this.hasMod("suppressor");
    const loud = this.hasMod("laser") || this.hasMod("light");
    for (const e of this.enemies) {
      if (e.state === "dead" || e.state === "rise") continue;
      const d = e.group.position.distanceTo(this.pos);
      const rr = (shotgun ? 7.5 : 4.2) * (quiet ? 0.5 : 1);
      if (d > rr) continue;
      let chance = shotgun
        ? e.kind === "runner" ? 0.8 : e.kind === "scrapper" ? 0.28 : 0.25
        : e.kind === "runner" ? 0.3 : e.kind === "scrapper" ? 0.09 : 0.15;
      if (quiet) chance *= 0.5;
      if (loud) chance *= 1.25;
      if (Math.random() >= chance) continue;
      const ex = e.group.position.x - this.pos.x;
      const ez = e.group.position.z - this.pos.z;
      const el = Math.hypot(ex, ez) || 1;
      const side = Math.random() < 0.5 ? 1 : -1;
      /* gunners shuffle out of the way rather than dive; heavies barely budge */
      const dodgeImp = e.kind === "runner" ? 6.5 : e.kind === "scrapper" ? 3.8 : 2.6;
      e.dodgeVx = (-ez / el) * side * dodgeImp;
      e.dodgeVz = (ex / el) * side * dodgeImp;
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
  /* the shockwave a brute lands at the end of a bull rush — missing the
     trample doesn't make you safe if you're standing near the landing */
  private bruteSlam(e: Enemy) {
    e.state = "chase";
    e.stateT = 0;
    e.attackCd = 2.0;
    this.spawnSwipe(e.group.position, e.group.rotation.y, ENEMY_DEFS.brute.scale, true);
    this.trauma = Math.min(1.4, this.trauma + 0.34);
    sfx.barrelClang();
    this.tmpV3.copy(e.group.position);
    this.tmpV3.y += 0.15;
    this.spawnParticles(this.tmpV3, 14, ["#4a3c2a", "#2a231b", "#8a7f70", "#ffb42e"], 3.2, 0.45, 7);
    const dxs = this.pos.x - e.group.position.x;
    const dzs = this.pos.z - e.group.position.z;
    const ds = Math.hypot(dxs, dzs) || 1;
    if (ds < 3.2) {
      this.damagePlayer(20, e.group.position);
      const sh = 1.2;
      this.pos.x = Math.max(-30, Math.min(51.4, this.pos.x + (dxs / ds) * sh));
      this.pos.z = Math.max(-30, Math.min(30, this.pos.z + (dzs / ds) * sh));
    }
  }

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
      ranged: e.kind === "scrapper",
    });
  }

  /* melee swipe arc — a fading additive slash in front of the attacker */
  private spawnSwipe(pos: THREE.Vector3, yaw: number, scale: number, wide = false) {
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
    s.life = wide ? 0.2 : 0.13;
    s.base = wide ? scale * 1.7 : scale;
    s.mat.color.set(wide ? "#ff5a3c" : "#ffb066");
    s.mesh.visible = true;
    const reach = wide ? 1.15 : 0.55;
    s.mesh.position.set(pos.x + Math.sin(yaw) * reach * scale, pos.y + 1.12 * scale, pos.z + Math.cos(yaw) * reach * scale);
    s.mesh.rotation.set(-0.35, yaw, Math.random() * 6.28);
    s.mesh.scale.setScalar(0.6 * s.base);
  }

  /* ============================== Enemy projectiles ============================== */

  private spawnRaiderBullet(e: Enemy, spreadMul: number) {
    if (!e.rig.muzzle) return;
    let b = this.bullets.find((x) => x.life <= 0);
    if (!b) {
      if (this.bullets.length >= 18) return;
      const mat = new THREE.MeshBasicMaterial({
        color: "#ffd98f",
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.9), mat);
      this.scene.add(mesh);
      b = { mesh, mat, life: 0 };
      this.bullets.push(b);
      this.bFrom = new Float32Array(this.bullets.length * 3);
      this.bDir = new Float32Array(this.bullets.length * 3);
      this.bSpd = new Float32Array(this.bullets.length);
    }
    const i = this.bullets.indexOf(b);
    e.rig.muzzle.getWorldPosition(this.tmpV);
    const ox = this.tmpV.x;
    const oy = this.tmpV.y;
    const oz = this.tmpV.z;
    /* lead the target a touch, then smear with wave-scaled inaccuracy */
    const tx = this.pos.x + this.vel.x * 0.15;
    const ty = 1.35 + this.pos.y;
    const tz = this.pos.z + this.vel.z * 0.15;
    let dx = tx - ox;
    let dy = ty - oy;
    let dz = tz - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    /* sloppy iron sights — wide cone that only tightens slowly with waves */
    const sm = 0.21 * spreadMul;
    dx += (Math.random() - 0.5) * sm;
    dy += (Math.random() - 0.5) * sm * 0.6;
    dz += (Math.random() - 0.5) * sm;
    const dl = Math.hypot(dx, dy, dz) || 1;
    this.bFrom[i * 3] = ox;
    this.bFrom[i * 3 + 1] = oy;
    this.bFrom[i * 3 + 2] = oz;
    this.bDir[i * 3] = dx / dl;
    this.bDir[i * 3 + 1] = dy / dl;
    this.bDir[i * 3 + 2] = dz / dl;
    this.bSpd[i] = 22;
    b.life = 1.4;
    b.mesh.visible = true;
    b.mat.opacity = 0.9;
    /* muzzle flash + report — these guns are loud enough to alert the room */
    this.tmpV2.set(ox, oy, oz);
    this.spawnParticles(this.tmpV2.clone(), 3, ["#ffd98f", "#ff9b3c"], 1.6, 0.14, 2);
    sfx.raiderShot();
  }

  private updateEnemyBullets(dt: number) {
    const headY = 1.66 + this.pos.y;
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      const dx = this.bDir[i * 3];
      const dy = this.bDir[i * 3 + 1];
      const dz = this.bDir[i * 3 + 2];
      this.bFrom[i * 3] += dx * this.bSpd[i] * dt;
      this.bFrom[i * 3 + 1] += dy * this.bSpd[i] * dt;
      this.bFrom[i * 3 + 2] += dz * this.bSpd[i] * dt;
      const x = this.bFrom[i * 3];
      const y = this.bFrom[i * 3 + 1];
      const z = this.bFrom[i * 3 + 2];
      b.mesh.position.set(x, y, z);
      b.mesh.lookAt(x + dx, y + dy, z + dz);
      /* hit the player — a cylinder around the body */
      const pdx = x - this.pos.x;
      const pdz = z - this.pos.z;
      if (pdx * pdx + pdz * pdz < 0.16 && y > 0.1 && y < headY + 0.25) {
        this.damagePlayer(8, this.tmpV3.set(x, y, z), true);
        this.trauma = Math.min(1.4, this.trauma + 0.06);
        b.life = 0;
      } else if (y < 0.05) {
        /* sparks off the floor plates */
        this.spawnParticles(this.tmpV3.set(x, 0.06, z).clone(), 3, ["#ffb42e", "#8a7f70"], 1.6, 0.16, 5);
        b.life = 0;
      } else if (Math.abs(x) > ARENA + 1 || Math.abs(z) > ARENA + 1) {
        b.life = 0;
      }
      if (b.life <= 0) b.mesh.visible = false;
      else b.mat.opacity = Math.min(0.9, b.life * 5);
    }
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

    /* tracers — short streaks that travel muzzle → impact, then fade */
    for (let i = 0; i < this.tCount; i++) {
      if (this.tLife[i] <= 0) continue;
      this.tLife[i] -= dt;

      const elapsed = this.tMax[i] - this.tLife[i];
      const dist = this.tDist[i];
      const len = this.tLen[i];
      const head = Math.min(TRACER_SPEED * elapsed, dist);
      const tail = Math.max(0, Math.min(head - len, dist));

      const fx = this.tFrom[i * 3];
      const fy = this.tFrom[i * 3 + 1];
      const fz = this.tFrom[i * 3 + 2];
      const ddx = this.tDir[i * 3];
      const ddy = this.tDir[i * 3 + 1];
      const ddz = this.tDir[i * 3 + 2];

      /* tail vertex, then head vertex */
      this.tPos[i * 6] = fx + ddx * tail;
      this.tPos[i * 6 + 1] = fy + ddy * tail;
      this.tPos[i * 6 + 2] = fz + ddz * tail;
      this.tPos[i * 6 + 3] = fx + ddx * head;
      this.tPos[i * 6 + 4] = fy + ddy * head;
      this.tPos[i * 6 + 5] = fz + ddz * head;

      /* full brightness while traveling, fades after the head arrives */
      const b = Math.min(1, this.tLife[i] / 0.045);
      const br = this.tBase[i * 3] * b;
      const bg = this.tBase[i * 3 + 1] * b;
      const bb = this.tBase[i * 3 + 2] * b;
      /* tail is dimmer than the head for a comet falloff */
      this.tCol[i * 6] = br * 0.22;
      this.tCol[i * 6 + 1] = bg * 0.22;
      this.tCol[i * 6 + 2] = bb * 0.22;
      this.tCol[i * 6 + 3] = br;
      this.tCol[i * 6 + 4] = bg;
      this.tCol[i * 6 + 5] = bb;

      if (this.tLife[i] <= 0) {
        for (let k = 0; k < 6; k++) this.tCol[i * 6 + k] = 0;
      }
    }
    (this.tracerLines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.tracerLines.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    /* muzzle flashes — smoothstep opacity fade, blast stretches as it dies */
    for (const f of this.muzzleFlashes) {
      if (f.life > 0) {
        f.life -= dt;
        const k = Math.max(0, f.life / f.max);
        const o = k * k * (3 - 2 * k);
        f.matA.opacity = o;
        f.matB.opacity = o;
        const g = 1 + (1 - k) * 0.35; /* blast blooms outward as it dies */
        f.group.scale.set(f.len * g, f.wid * g, 1);
        if (f.life <= 0) f.group.visible = false;
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
