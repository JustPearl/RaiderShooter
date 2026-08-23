import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FoundryGame, type GameEvent, type HudData, type FinalStats, type GamePhase, type SkillCard, type ResMode, type AAMode } from "./game/engine";
import { sfx } from "./game/audio";
import { GUN_MODS, tierLabel, type GunModId } from "./game/gunmods";

interface KillEntry {
  id: number;
  text: string;
}
interface Banner {
  key: number;
  title: string;
  sub: string;
  tone: "orange" | "green" | "red";
}

let uid = 1;

function OptRow(props: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-[12px] tracking-[0.24em] text-[#cdbfa8]">{props.label}</span>
        <span className="font-display text-[15px] text-[#ffb42e]" style={{ textShadow: "0 0 12px rgba(255,180,46,0.5)" }}>
          {props.display}
        </span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        className="opt-range w-full"
      />
    </div>
  );
}

function SegmentedRow<T extends string>(props: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  hint?: string;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-[12px] tracking-[0.24em] text-[#cdbfa8]">{props.label}</span>
        {props.hint && <span className="text-[9px] font-semibold tracking-[0.18em] text-[#6e6353]">{props.hint}</span>}
      </div>
      <div className="seg-row flex gap-1.5">
        {props.options.map((o) => (
          <button
            key={o.value}
            onClick={() => {
              sfx.uiMove();
              props.onChange(o.value);
            }}
            className={`seg-btn ${o.value === props.value ? "seg-on" : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<FoundryGame | null>(null);

  const [phase, setPhase] = useState<GamePhase>("attract");
  const [stats, setStats] = useState<FinalStats | null>(null);
  const [killFeed, setKillFeed] = useState<KillEntry[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [hitmark, setHitmark] = useState<{ key: number; head: boolean; kill: boolean } | null>(null);
  const hitTimer = useRef(0);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const [draftCards, setDraftCards] = useState<SkillCard[] | null>(null);
  const [curWave, setCurWave] = useState(0);
  const [weapon, setWeapon] = useState(0);
  const [locker, setLocker] = useState<{
    owned: GunModId[];
    tiers: Record<string, number>;
    equipped: (GunModId | null)[];
  } | null>(null);
  const [lockerSel, setLockerSel] = useState(0);

  /* fast-path refs (updated every frame without re-render) */
  const hpFill = useRef<HTMLDivElement>(null);
  const hpText = useRef<HTMLSpanElement>(null);
  const hpWrap = useRef<HTMLDivElement>(null);
  const ammoText = useRef<HTMLSpanElement>(null);
  const reserveText = useRef<HTMLSpanElement>(null);
  const ammoLineText = useRef<HTMLDivElement>(null);
  const modsText = useRef<HTMLDivElement>(null);
  const weaponName = useRef<HTMLDivElement>(null);
  const waveText = useRef<HTMLSpanElement>(null);
  const scoreText = useRef<HTMLSpanElement>(null);
  const killsText = useRef<HTMLSpanElement>(null);
  const hostilesText = useRef<HTMLSpanElement>(null);
  const gapRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const comboRef = useRef<HTMLDivElement>(null);
  const dmgRef = useRef<HTMLDivElement>(null);
  const lowHpRef = useRef<HTMLDivElement>(null);
  const ringWrapRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const pipsRef = useRef<HTMLDivElement>(null);
  const slotRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const lastWeapon = useRef(-1);

  /* ------- options (persisted to localStorage) ------- */
  const loadOpt = (key: string, def: number, min: number, max: number) => {
    const v = parseFloat(localStorage.getItem(key) ?? "");
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  };
  const [brightness, setBrightness] = useState(() => loadOpt("fo-brightness", 1, 0.5, 1.6));
  const [volume, setVolume] = useState(() => loadOpt("fo-volume", 1, 0, 1));
  const [sens, setSens] = useState(() => loadOpt("fo-sens", 1, 0.5, 2));
  /* graphics — persisted under the same keys the engine reads at boot */
  const [resMode, setResMode] = useState<ResMode>(() => {
    try {
      const r = localStorage.getItem("fo_res");
      return r === "720" || r === "1080" || r === "native" ? r : "480";
    } catch {
      return "480";
    }
  });
  const [aaMode, setAaMode] = useState<AAMode>(() => {
    try {
      const a = localStorage.getItem("fo_aa");
      return a === "fxaa" || a === "msaa" ? a : "off";
    } catch {
      return "off";
    }
  });
  const [optOpen, setOptOpen] = useState(false);

  /* lift the 480i signal before the CRT filter; persisted per panel */
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.style.filter = `contrast(1.07) saturate(1.1) brightness(${(1.02 * brightness).toFixed(3)})`;
    }
    localStorage.setItem("fo-brightness", String(brightness));
  }, [brightness]);

  useEffect(() => {
    sfx.setVolume(volume);
    localStorage.setItem("fo-volume", String(volume));
  }, [volume]);

  useEffect(() => {
    gameRef.current?.setSensitivity(sens);
    localStorage.setItem("fo-sens", String(sens));
  }, [sens]);

  useEffect(() => {
    gameRef.current?.setResolution(resMode);
  }, [resMode]);

  useEffect(() => {
    gameRef.current?.setAA(aaMode);
  }, [aaMode]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const onEvent = (e: GameEvent) => {
      switch (e.type) {
        case "playing":
          setPhase("playing");
          setKillFeed([]);
          setDraftCards(null);
          setLocker(null);
          break;
        case "paused":
          setPhase("paused");
          break;
        case "draft":
          setDraftCards(e.cards);
          setPhase("draft");
          break;
        case "locker":
          if (e.open) setLocker({ owned: e.owned as GunModId[], tiers: e.tiers, equipped: e.equipped as (GunModId | null)[] });
          else setLocker(null);
          break;
        case "dead":
          setStats(e.stats);
          setPhase("dead");
          break;
        case "hitmarker":
          setHitmark({ key: uid++, head: e.head, kill: e.kill });
          window.clearTimeout(hitTimer.current);
          hitTimer.current = window.setTimeout(() => setHitmark(null), 340);
          break;
        case "damage":
          if (dmgRef.current) {
            dmgRef.current.style.transition = "none";
            dmgRef.current.style.opacity = "0.75";
            requestAnimationFrame(() => {
              if (dmgRef.current) {
                dmgRef.current.style.transition = "opacity 0.55s ease-out";
                dmgRef.current.style.opacity = "0";
              }
            });
          }
          break;
        case "wave":
          setBanner({ key: uid++, title: `WAVE ${String(e.wave).padStart(2, "0")}`, sub: `${e.count} RAIDERS BREACHING THE FLOOR`, tone: "orange" });
          break;
        case "cleared":
          setCurWave(e.wave);
          setBanner({ key: uid++, title: `WAVE ${String(e.wave).padStart(2, "0")} CLEARED`, sub: `+${e.bonus} SALVAGE // +10 SHELLS // +24 SMG ROUNDS // +30 LMG BELT // +12 HP`, tone: "green" });
          break;
        case "kill": {
          const entry = { id: uid++, text: e.text };
          setKillFeed((f) => [...f.slice(-4), entry]);
          setTimeout(() => setKillFeed((f) => f.filter((k) => k.id !== entry.id)), 2400);
          break;
        }
        case "pickup":
          setToast({ key: uid++, text: e.text });
          break;
      }
    };

    const onHud = (h: HudData) => {
      const ratio = h.hp / h.maxHp;
      if (hpFill.current) {
        hpFill.current.style.width = `${ratio * 100}%`;
        hpFill.current.style.background = ratio > 0.5 ? "#7dff5e" : ratio > 0.25 ? "#ffb42e" : "#ff2e1f";
        hpFill.current.style.boxShadow = `0 0 12px ${ratio > 0.25 ? "rgba(125,255,94,0.5)" : "rgba(255,46,31,0.7)"}`;
      }
      if (hpText.current) hpText.current.textContent = String(h.hp);
      if (lowHpRef.current) lowHpRef.current.style.visibility = ratio <= 0.3 ? "visible" : "hidden";
      if (ammoText.current) {
        ammoText.current.textContent = String(h.ammo);
        ammoText.current.style.color = h.ammo === 0 ? "#ff2e1f" : h.ammo <= 2 ? "#ffb42e" : "#ffe8c8";
      }
      if (reserveText.current) reserveText.current.textContent = h.reserve < 0 ? "∞" : String(h.reserve);
      if (ammoLineText.current) ammoLineText.current.textContent = h.ammoLine;
      if (modsText.current) {
        const mt = h.mods.length ? h.mods.join(" · ") : "";
        if (modsText.current.textContent !== mt) modsText.current.textContent = mt;
        modsText.current.style.opacity = mt ? "1" : "0";
      }
      if (weaponName.current) weaponName.current.textContent = h.weaponName;
      if (waveText.current) waveText.current.textContent = String(Math.max(1, h.wave)).padStart(2, "0");
      if (scoreText.current) scoreText.current.textContent = String(h.score).padStart(6, "0");
      if (killsText.current) killsText.current.textContent = String(h.kills).padStart(3, "0");
      if (hostilesText.current) hostilesText.current.textContent = String(h.enemiesLeft);
      const g = h.spreadGap;
      if (gapRefs[0].current) gapRefs[0].current!.style.transform = `translate(-50%,-50%) translateY(${-(4 + g)}px)`;
      if (gapRefs[1].current) gapRefs[1].current!.style.transform = `translate(-50%,-50%) translateY(${4 + g}px)`;
      if (gapRefs[2].current) gapRefs[2].current!.style.transform = `translate(-50%,-50%) translateX(${-(4 + g)}px)`;
      if (gapRefs[3].current) gapRefs[3].current!.style.transform = `translate(-50%,-50%) translateX(${4 + g}px)`;
      if (comboRef.current) {
        comboRef.current.style.opacity = h.combo > 1 ? "1" : "0";
        comboRef.current.textContent = `×${h.combo}`;
      }
      if (ringRef.current && ringWrapRef.current) {
        const C = 2 * Math.PI * 20;
        ringRef.current.style.strokeDashoffset = String(C * (1 - h.reloadT));
        ringWrapRef.current.style.opacity = h.reloading ? "1" : "0";
      }
      if (pipsRef.current) {
        pipsRef.current.style.display = h.weapon === 1 ? "flex" : "none";
        for (let i = 0; i < 6; i++) {
          const pip = pipsRef.current.children[i] as HTMLElement | undefined;
          if (pip) pip.style.background = i < h.ammo ? "#ff6b1a" : "rgba(255,107,26,0.15)";
        }
      }
      if (lastWeapon.current !== h.weapon) {
        lastWeapon.current = h.weapon;
        setWeapon(h.weapon);
        for (let i = 0; i < slotRefs.length; i++) {
          if (slotRefs[i].current) {
            slotRefs[i].current!.style.borderColor = i === h.weapon ? "#ff6b1a" : "rgba(184,168,143,0.25)";
            slotRefs[i].current!.style.color = i === h.weapon ? "#ffb42e" : "rgba(184,168,143,0.45)";
          }
        }
      }
    };

    const game = new FoundryGame(canvasRef.current, onEvent, onHud);
    gameRef.current = game;
    game.setSensitivity(sens);
    return () => {
      game.dispose();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 2600);
    return () => clearTimeout(t);
  }, [banner]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(t);
  }, [toast]);

  const pickCard = (i: number) => {
    const c = draftCards?.[i];
    if (!c || phase !== "draft") return;
    sfx.pickup("ammo");
    gameRef.current?.chooseCard(c.id);
  };

  useEffect(() => {
    if (phase !== "draft") return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === "Digit1") pickCard(0);
      if (ev.code === "Digit2") pickCard(1);
      if (ev.code === "Digit3") pickCard(2);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, draftCards]);

  const inGame = phase === "playing";

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0d0a07] select-none">
      <canvas ref={canvasRef} className="game-canvas" />

      {/* ======= PS2 480i CRT stack ======= */}
      <div className="crt-scanlines" />
      <div className="crt-grille" />
      <div className="crt-flicker" />
      <div className="crt-vignette" />
      <div className="crt-dither" />

      {/* ======= damage + low hp ======= */}
      <div
        ref={dmgRef}
        className="pointer-events-none fixed inset-0 z-40"
        style={{ opacity: 0, background: "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 30%, rgba(255,20,8,0.6) 100%)" }}
      />
      <div ref={lowHpRef} className="lowhp-vignette pointer-events-none fixed inset-0 z-40" style={{ visibility: "hidden" }} />

      {/* ======= HUD ======= */}
      {inGame && (
        <div className="pointer-events-none fixed inset-0 z-50">
          {/* crosshair */}
          <div className="absolute left-1/2 top-1/2">
            <div className="absolute h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ffb42e]" style={{ boxShadow: "0 0 6px rgba(255,180,46,0.9)" }} />
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                ref={gapRefs[i]}
                className="absolute left-0 top-0 bg-[#ffb42e]"
                style={{
                  width: i < 2 ? 2 : 9,
                  height: i < 2 ? 9 : 2,
                  boxShadow: "0 0 4px rgba(0,0,0,0.9), 0 0 5px rgba(255,180,46,0.6)",
                  transform: "translate(-50%,-50%)",
                }}
              />
            ))}
            {hitmark && (
              <div key={hitmark.key} className="hitmarker absolute left-0 top-0" style={{ color: hitmark.kill ? "#ff2e1f" : hitmark.head ? "#ffb42e" : "#ffffff" }}>
                {[45, -45, 135, -135].map((r) => (
                  <div
                    key={r}
                    className="absolute"
                    style={{
                      width: 2,
                      height: 9,
                      background: "currentColor",
                      left: -1,
                      top: -12,
                      transformOrigin: "1px 12px",
                      transform: `rotate(${r}deg)`,
                      boxShadow: "0 0 6px currentColor",
                    }}
                  />
                ))}
              </div>
            )}
            <div ref={comboRef} className="font-display absolute left-0 top-9 -translate-x-1/2 text-xl text-[#ff6b1a] hud-shadow" style={{ opacity: 0 }} />
            {/* reload progress ring around the reticle */}
            <div ref={ringWrapRef} className="absolute left-0 top-0" style={{ opacity: 0, transition: "opacity 0.12s ease" }}>
              <svg width="52" height="52" viewBox="0 0 52 52" style={{ transform: "translate(-50%,-50%) rotate(-90deg)", display: "block", overflow: "visible" }}>
                <circle cx="26" cy="26" r="20" fill="none" stroke="rgba(255,180,46,0.16)" strokeWidth="3" />
                <circle
                  ref={ringRef}
                  cx="26"
                  cy="26"
                  r="20"
                  fill="none"
                  stroke="#ffb42e"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 20}
                  strokeDashoffset={2 * Math.PI * 20}
                  style={{ filter: "drop-shadow(0 0 4px rgba(255,180,46,0.8))" }}
                />
              </svg>
            </div>
          </div>

          {/* top-left: wave + score */}
          <div className="absolute left-5 top-5">
            <div className="hud-panel px-4 py-2.5">
              <div className="flex items-end gap-3">
                <div>
                  <div className="text-[10px] font-semibold tracking-[0.28em] text-[#b8a88f]">WAVE</div>
                  <span ref={waveText} className="font-display text-4xl leading-none text-[#ff6b1a] hud-shadow">
                    01
                  </span>
                </div>
                <div className="mb-0.5">
                  <div className="text-[10px] font-semibold tracking-[0.28em] text-[#b8a88f]">SALVAGE</div>
                  <span ref={scoreText} className="text-lg font-bold leading-none tracking-wider text-[#ffe8c8]">
                    000000
                  </span>
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-4 text-[11px] tracking-widest text-[#b8a88f]">
                <span>
                  KILLS <span ref={killsText} className="font-bold text-[#ffb42e]">000</span>
                </span>
                <span>
                  HOSTILES <span ref={hostilesText} className="font-bold text-[#ff2e1f]">0</span>
                </span>
              </div>
            </div>
          </div>

          {/* top-right: kill feed */}
          <div className="absolute right-5 top-5 flex flex-col items-end gap-1">
            {killFeed.map((k) => (
              <div key={k.id} className="kill-entry hud-panel-r border border-[rgba(255,46,31,0.4)] bg-[rgba(20,10,8,0.82)] px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-[#ffc9a8]">
                {k.text}
              </div>
            ))}
          </div>

          {/* bottom-left: health */}
          <div className="absolute bottom-6 left-5">
            <div className="hud-panel px-4 py-3">
              <div className="flex items-center gap-3">
                <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0">
                  <rect x="3" y="7" width="14" height="6" fill="#ff2e1f" />
                  <rect x="7" y="3" width="6" height="14" fill="#ff2e1f" />
                </svg>
                <div ref={hpWrap} className="relative h-[16px] w-[240px] border border-[rgba(255,180,46,0.4)] bg-[rgba(0,0,0,0.6)]">
                  <div ref={hpFill} className="absolute inset-y-0 left-0" style={{ width: "100%", background: "#7dff5e" }} />
                  <div
                    className="absolute inset-0"
                    style={{ background: "repeating-linear-gradient(90deg, transparent 0 11px, rgba(0,0,0,0.55) 11px 12px)" }}
                  />
                </div>
                <span ref={hpText} className="font-display text-2xl leading-none text-[#ffe8c8] hud-shadow">
                  100
                </span>
              </div>
            </div>
          </div>

          {/* bottom-right: weapon + ammo */}
          <div className="absolute bottom-6 right-5 flex flex-col items-end gap-2">
            <div className="flex gap-2">
              {["1 P-9", "2 M870", "3 VK-9", "4 MG-7"].map((label, i) => (
                <div
                  key={label}
                  ref={slotRefs[i]}
                  className="border px-2.5 py-1 text-[11px] font-bold tracking-[0.2em]"
                  style={{ borderColor: i === weapon ? "#ff6b1a" : "rgba(184,168,143,0.25)", color: i === weapon ? "#ffb42e" : "rgba(184,168,143,0.45)", background: "rgba(13,10,7,0.75)" }}
                >
                  {label}
                </div>
              ))}
            </div>
            <div className="hud-panel hud-panel-r px-5 py-3 text-right">
              <div ref={weaponName} className="text-[11px] font-semibold tracking-[0.3em] text-[#b8a88f]">
                P-9 SCRAPLOCK
              </div>
              <div ref={ammoLineText} className="mt-0.5 text-[9.5px] font-semibold tracking-[0.14em] text-[#8a7f6c]">
                .45 ACP · 831 FPS · 5.1" BBL
              </div>
              <div
                ref={modsText}
                className="mt-1 text-[9px] font-bold tracking-[0.28em] text-[#ffb42e]"
                style={{ opacity: 0, transition: "opacity 0.2s ease", textShadow: "0 0 10px rgba(255,180,46,0.4)" }}
              >
                &nbsp;
              </div>
              <div className="flex items-baseline justify-end gap-2">
                <span ref={ammoText} className="font-display text-5xl leading-none text-[#ffe8c8] hud-shadow">
                  12
                </span>
                <span className="text-[13px] font-bold text-[#b8a88f]">/</span>
                <span ref={reserveText} className="text-xl font-bold text-[#ffb42e]">
                  ∞
                </span>
              </div>
              <div ref={pipsRef} className="mt-1.5 justify-end gap-1" style={{ display: "none" }}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-[8px] w-[14px]" style={{ background: "rgba(255,107,26,0.15)", clipPath: "polygon(0 0, 100% 0, 100% 70%, 50% 100%, 0 70%)" }} />
                ))}
              </div>
            </div>
          </div>

          {/* pickup toast */}
          {toast && (
            <div key={toast.key} className="kill-entry absolute bottom-36 left-1/2 -translate-x-1/2">
              <span className="font-display text-lg text-[#7dff5e] hud-shadow">{toast.text}</span>
            </div>
          )}
        </div>
      )}

      {/* ======= wave banner ======= */}
      {banner && (
        <div key={banner.key} className="pointer-events-none fixed inset-x-0 top-[26%] z-50 flex flex-col items-center">
          <div className="wave-banner text-center">
            <div className="hazard-tape mx-auto mb-3 h-[6px] w-64 opacity-80" />
            <div
              className="font-display text-6xl md:text-7xl hud-shadow"
              style={{ color: banner.tone === "green" ? "#7dff5e" : banner.tone === "red" ? "#ff2e1f" : "#ff6b1a" }}
            >
              {banner.title}
            </div>
            <div className="mt-2 text-sm font-semibold tracking-[0.4em] text-[#ffe8c8]">{banner.sub}</div>
            <div className="hazard-tape mx-auto mt-3 h-[6px] w-64 opacity-80" />
          </div>
        </div>
      )}

      {/* ======= MENU ======= */}
      {phase === "attract" && (
        <div className="fixed inset-0 z-[55] flex flex-col bg-[rgba(10,7,4,0.72)]" style={{ cursor: "crosshair" }}>
          <div className="menu-grid pointer-events-none absolute inset-0 opacity-60" />
          <div className="hazard-tape h-[10px] w-full shrink-0 opacity-90" />

          <div className="relative flex flex-1 flex-col justify-between overflow-y-auto px-8 py-8 md:flex-row md:items-center md:gap-10 md:px-16">
            {/* left: identity */}
            <div className="max-w-xl">
              <div className="mb-3 flex items-center gap-3">
                <svg width="34" height="34" viewBox="0 0 34 34">
                  <path d="M17 2 L30 9 V25 L17 32 L4 25 V9 Z" fill="none" stroke="#ff6b1a" strokeWidth="2.5" />
                  <path d="M11 22 V12 L17 18 L23 12 V22" fill="none" stroke="#ffb42e" strokeWidth="2.5" />
                </svg>
                <span className="text-xs font-bold tracking-[0.5em] text-[#b8a88f]">SHIFT PROTOCOL 480i</span>
              </div>
              <h1 className="title-slant font-display text-[64px] leading-[0.92] text-[#ff6b1a] md:text-[92px]" style={{ textShadow: "4px 4px 0 #2a1206, 0 0 34px rgba(255,107,26,0.45)" }}>
                FOUNDRY
                <span className="block text-[#ffe8c8]" style={{ textShadow: "4px 4px 0 #2a1206, 0 0 26px rgba(255,232,200,0.25)" }}>
                  ZERO
                </span>
              </h1>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-[#cdbfa8]">
                The smelter is dead. The raiders are not. You are the last hand on the night shift — hold the factory floor against{" "}
                <span className="font-bold text-[#ffb42e]">endless breach waves</span>. Pistols never run dry. Shells do. Make them count.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-4">
                <button
                  onClick={() => gameRef.current?.start()}
                  className="menu-btn hazard-tape relative font-display text-2xl tracking-wider text-[#14100c]"
                  style={{ padding: "14px 42px", boxShadow: "0 0 30px rgba(255,180,46,0.35)" }}
                >
                  <span className="absolute inset-[3px] flex items-center justify-center bg-[#ffb42e] px-8" style={{ clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))" }}>
                    CLOCK IN
                  </span>
                </button>
                <button
                  onClick={() => {
                    sfx.ensure();
                    sfx.uiMove();
                    setOptOpen(true);
                  }}
                  className="menu-btn border border-[rgba(184,168,143,0.4)] px-6 py-3.5 font-display text-sm tracking-[0.25em] text-[#cdbfa8] hover:border-[#ffb42e] hover:text-[#ffb42e]"
                >
                  OPTIONS
                </button>
                <div className="text-[11px] font-semibold leading-relaxed tracking-[0.2em] text-[#8a7f6c]">
                  MOUSE + KEYBOARD
                  <br />
                  CLICK LOCKS YOUR AIM
                </div>
              </div>
            </div>

            {/* right: intel */}
            <div className="mt-8 grid shrink-0 gap-4 md:mt-0 md:w-[400px]">
              <div className="hud-panel px-5 py-4">
                <div className="font-display mb-3 text-sm tracking-[0.2em] text-[#ff6b1a]">FIELD CONTROLS</div>
                <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[12px] text-[#cdbfa8]">
                  <div className="flex gap-1"><span className="keycap">W</span><span className="keycap">A</span><span className="keycap">S</span><span className="keycap">D</span></div>
                  <span>MOVE</span>
                  <div className="flex gap-1"><span className="keycap">MOUSE</span></div>
                  <span>AIM — LEFT CLICK FIRES</span>
                  <div className="flex gap-1"><span className="keycap">RMB</span></div>
                  <span>AIM DOWN SIGHTS — STEADIER, TIGHTER</span>
                  <div className="flex gap-1"><span className="keycap">SHIFT</span></div>
                  <span>SPRINT</span>
                  <div className="flex gap-1"><span className="keycap">SPACE</span></div>
                  <span>JUMP</span>
                  <div className="flex gap-1"><span className="keycap">R</span></div>
                  <span>RELOAD</span>
                  <div className="flex gap-1"><span className="keycap">1</span><span className="keycap">2</span><span className="keycap">3</span><span className="keycap">4</span><span className="keycap">WHEEL</span></div>
                  <span>SWAP WEAPON</span>
                  <div className="flex gap-1"><span className="keycap">B</span></div>
                  <span>GUN LOCKER — MOUNT LOOTED PARTS</span>
                  <div className="flex gap-1"><span className="keycap">ESC</span></div>
                  <span>PAUSE</span>
                </div>
              </div>

              <div className="hud-panel hud-panel-r px-5 py-4">
                <div className="font-display mb-3 text-sm tracking-[0.2em] text-[#ff6b1a]">ARMORY</div>
                <div className="space-y-2.5 text-[12px] leading-snug">
                  <div className="flex items-start gap-3">
                    <svg width="30" height="18" viewBox="0 0 30 18" className="mt-0.5 shrink-0">
                      <rect x="2" y="4" width="20" height="5" fill="#b8a88f" />
                      <rect x="8" y="9" width="6" height="8" fill="#8a7f6c" />
                    </svg>
                    <p className="text-[#cdbfa8]">
                      <span className="font-bold text-[#ffe8c8]">P-9 SCRAPLOCK</span> — the sidearm that never runs dry. Tightest aim and steady damage; your anchor when the crates go quiet.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg width="30" height="18" viewBox="0 0 30 18" className="mt-0.5 shrink-0">
                      <rect x="1" y="6" width="28" height="4" fill="#b8a88f" />
                      <rect x="18" y="10" width="11" height="5" fill="#8a5a3c" />
                    </svg>
                    <p className="text-[#cdbfa8]">
                      <span className="font-bold text-[#ffe8c8]">M870 BREAKER</span> — 8-pellet scattergun. Point-blank it erases a raider and breaks their swing mid-windup. Shells are scarce; make them count.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg width="30" height="18" viewBox="0 0 30 18" className="mt-0.5 shrink-0">
                      <rect x="3" y="4" width="22" height="6" fill="#8a8f96" />
                      <rect x="25" y="5" width="4" height="3" fill="#b8a88f" />
                      <rect x="12" y="10" width="5" height="8" fill="#4a4d52" />
                    </svg>
                    <p className="text-[#cdbfa8]">
                      <span className="font-bold text-[#ffe8c8]">VK-9 WESPE</span> — full-auto SMG, the hottest trigger in the rack. Bursts of 5–8 stay on target; hold the mouse down and it climbs, blooms, and eats the crate.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg width="30" height="18" viewBox="0 0 30 18" className="mt-0.5 shrink-0">
                      <rect x="2" y="5" width="13" height="6" fill="#8a8f96" />
                      <rect x="15" y="6.5" width="13" height="3" fill="#b8a88f" />
                      <rect x="4" y="1" width="9" height="4" fill="#4a5238" />
                      <rect x="6" y="11" width="5" height="6" fill="#4a4f3c" />
                      <rect x="15" y="4" width="2" height="2" fill="#b8a88f" />
                    </svg>
                    <p className="text-[#cdbfa8]">
                      <span className="font-bold text-[#ffe8c8]">MG-7 HOG</span> — a 60-round hose for crowd control, but no stronger per second than the SMG. Lugs at 85% speed, re-belts for 2.6s, belts are rare.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg width="30" height="18" viewBox="0 0 30 18" className="mt-0.5 shrink-0">
                      <rect x="9" y="2" width="12" height="15" rx="2" fill="#c43a22" />
                      <rect x="9" y="7" width="12" height="3" fill="#ffb42e" />
                    </svg>
                    <p className="text-[#cdbfa8]">
                      <span className="font-bold text-[#ffb42e]">RED BARRELS</span> — volatile. Shoot them into a crowd and collect the savings.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg width="30" height="18" viewBox="0 0 30 18" className="mt-0.5 shrink-0">
                      <path d="M15 1 L28 16 H2 Z" fill="none" stroke="#ff2e1f" strokeWidth="2" />
                      <rect x="14" y="6" width="2" height="5" fill="#ff2e1f" />
                      <rect x="14" y="12.5" width="2" height="2" fill="#ff2e1f" />
                    </svg>
                    <p className="text-[#cdbfa8]">
                      <span className="font-bold text-[#ff8a5e]">THREAT INTEL</span> — raiders flank, feint and encircle. A heavy blast breaks a wound-up swing. Sidestep the brute's stomp, then punish the stagger. Headshots pay double on every gun.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative flex shrink-0 items-center justify-between px-8 pb-4 text-[10px] font-semibold tracking-[0.3em] text-[#6e6353] md:px-16">
            <span>SECTOR-7 SMELTER // NIGHT SHIFT</span>
            <span className="pulse-glow text-[#ff6b1a]">SIGNAL: 480i INTERLACED</span>
          </div>
          <div className="hazard-tape h-[10px] w-full shrink-0 opacity-90" />
        </div>
      )}

      {/* ======= PAUSE ======= */}
      {phase === "paused" && !locker && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-[rgba(10,7,4,0.78)]" style={{ cursor: "crosshair" }}>
          <div className="hud-panel w-[420px] max-w-[92vw] px-8 py-8 text-center">
            <div className="hazard-tape mx-auto mb-5 h-[6px] w-40 opacity-80" />
            <div className="font-display text-4xl text-[#ffb42e] hud-shadow title-slant">LINE PAUSED</div>
            <p className="mt-2 text-[12px] tracking-[0.25em] text-[#8a7f6c]">THE RAIDERS ARE WAITING</p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={() => gameRef.current?.resume()}
                className="menu-btn font-display border-2 border-[#ff6b1a] bg-[rgba(255,107,26,0.12)] px-6 py-3 text-lg tracking-widest text-[#ffb42e] hover:bg-[#ff6b1a] hover:text-[#14100c]"
              >
                RESUME SHIFT
              </button>
              <button
                onClick={() => gameRef.current?.restart()}
                className="menu-btn font-display border border-[rgba(184,168,143,0.4)] px-6 py-2.5 text-sm tracking-widest text-[#cdbfa8] hover:border-[#ffb42e] hover:text-[#ffb42e]"
              >
                RESTART RUN
              </button>
              <button
                onClick={() => {
                  sfx.ensure();
                  sfx.uiMove();
                  setOptOpen(true);
                }}
                className="menu-btn font-display border border-[rgba(184,168,143,0.4)] px-6 py-2.5 text-sm tracking-widest text-[#cdbfa8] hover:border-[#ffb42e] hover:text-[#ffb42e]"
              >
                OPTIONS
              </button>
              <button
                onClick={() => {
                  sfx.ensure();
                  sfx.uiMove();
                  gameRef.current?.openLockerFromPause();
                }}
                className="menu-btn font-display border border-[rgba(255,180,46,0.5)] px-6 py-2.5 text-sm tracking-widest text-[#ffb42e] hover:border-[#ffb42e] hover:bg-[rgba(255,180,46,0.12)]"
              >
                GUN LOCKER [B]
              </button>
              <button
                onClick={() => gameRef.current?.toAttract()}
                className="menu-btn font-display border border-[rgba(184,168,143,0.4)] px-6 py-2.5 text-sm tracking-widest text-[#cdbfa8] hover:border-[#ffb42e] hover:text-[#ffb42e]"
              >
                ABANDON POST
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======= GUN LOCKER ======= */}
      {phase === "paused" && locker && (
        <div className="fixed inset-0 z-[57] flex items-center justify-center bg-[rgba(8,6,3,0.88)]" style={{ cursor: "crosshair" }}>
          <div className="pointer-events-none absolute inset-0 menu-grid opacity-40" />
          <div className="relative w-[min(900px,94vw)]">
            <div className="hud-panel px-8 py-6">
              <div className="mb-1 flex items-baseline justify-between">
                <div className="font-display text-2xl tracking-wide text-[#ff6b1a]">
                  GUN <span className="text-[#ffb42e]">LOCKER</span>
                </div>
                <span className="text-[10px] font-semibold tracking-[0.25em] text-[#6e6353]">RAIDERS DROP PARTS — MOUNT THEM HERE</span>
              </div>
              <div className="hazard-tape mb-5 mt-2 h-[5px] opacity-80" />

              <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px_1fr]">
                {/* weapon rack */}
                <div>
                  <div className="mb-2 font-display text-[11px] tracking-[0.3em] text-[#8a7f6c]">WEAPON RACK</div>
                  <div className="flex flex-col gap-2">
                    {["P-9 SCRAPLOCK", "M870 BREAKER", "VK-9 WESPE", "MG-7 HOG"].map((name, i) => {
                      const eq = locker.equipped[i];
                      const eqSpec = eq ? GUN_MODS.find((m) => m.id === eq) : null;
                      const active = lockerSel === i;
                      return (
                        <button
                          key={name}
                          onClick={() => {
                            sfx.uiMove();
                            setLockerSel(i);
                          }}
                          className="group border px-4 py-3 text-left transition-all"
                          style={{
                            borderColor: active ? "#ff6b1a" : "rgba(184,168,143,0.22)",
                            background: active ? "rgba(255,107,26,0.1)" : "rgba(0,0,0,0.3)",
                            clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)",
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-display text-[12px] tracking-[0.14em]" style={{ color: active ? "#ffb42e" : "#cdbfa8" }}>
                              {name}
                            </span>
                            <span className="keycap" style={{ minWidth: 22, height: 20, fontSize: 10 }}>{i + 1}</span>
                          </div>
                          <div className="mt-1 text-[10px] font-semibold tracking-[0.18em]">
                            {eqSpec ? (
                              <span style={{ color: eqSpec.rarity === "epic" ? "#ff2e1f" : "#ffb42e" }}>
                                {eqSpec.short} · {tierLabel(locker.tiers[eqSpec.id] ?? 1)}
                              </span>
                            ) : (
                              <span className="text-[#5a5142]">— EMPTY RAIL —</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 border border-[rgba(184,168,143,0.18)] bg-[rgba(0,0,0,0.3)] px-4 py-3 text-[10px] leading-relaxed tracking-[0.08em] text-[#8a7f6c]">
                    ONE PART PER RAIL. A PART CAN ONLY RIDE ONE WEAPON — MOUNTING IT ELSEWHERE PULLS IT OFF.
                  </div>
                </div>

                {/* stock + mount */}
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-display text-[11px] tracking-[0.3em] text-[#8a7f6c]">
                      PARTS STOCK <span className="text-[#ffb42e]">({locker.owned.length})</span>
                    </span>
                    {locker.equipped[lockerSel] && (
                      <button
                        onClick={() => {
                          sfx.uiMove();
                          gameRef.current?.unequipMod(lockerSel);
                        }}
                        className="menu-btn border border-[rgba(255,46,31,0.5)] px-3 py-1 font-display text-[10px] tracking-[0.2em] text-[#ff2e1f] hover:bg-[rgba(255,46,31,0.15)]"
                      >
                        STRIP {GUN_MODS.find((m) => m.id === locker.equipped[lockerSel])?.short}
                      </button>
                    )}
                  </div>

                  {locker.owned.length === 0 ? (
                    <div className="flex h-[220px] flex-col items-center justify-center border border-dashed border-[rgba(184,168,143,0.25)] text-center">
                      <div className="font-display text-sm tracking-[0.3em] text-[#5a5142]">STOCK IS EMPTY</div>
                      <div className="mt-2 max-w-[300px] text-[10px] leading-relaxed tracking-[0.12em] text-[#6e6353]">
                        KILL RAIDERS TO LOOT GUN PARTS. HEAVIES DROP THEM MORE OFTEN. BRING THEM BACK HERE TO MOUNT.
                      </div>
                    </div>
                  ) : (
                    <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto pr-1">
                      {locker.owned.map((id) => {
                        const spec = GUN_MODS.find((m) => m.id === id);
                        if (!spec) return null;
                        const tier = locker.tiers[id] ?? 1;
                        const mountedHere = locker.equipped[lockerSel] === id;
                        const mountedElsewhere = locker.equipped.some((e, i) => e === id && i !== lockerSel);
                        const col = spec.rarity === "epic" ? "#ff2e1f" : "#ffb42e";
                        return (
                          <div
                            key={id}
                            className="border bg-[rgba(0,0,0,0.35)] px-4 py-3"
                            style={{
                              borderColor: mountedHere ? col : "rgba(184,168,143,0.2)",
                              clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
                            }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5">
                                <span className="font-display text-[13px] tracking-[0.12em] text-[#ffe8c8]">{spec.name}</span>
                                <span
                                  className="px-1.5 py-0.5 font-display text-[9px] tracking-[0.14em]"
                                  style={{ background: tier >= 2 ? "#ff6b1a" : "rgba(184,168,143,0.2)", color: tier >= 2 ? "#14100c" : "#cdbfa8" }}
                                >
                                  {tierLabel(tier)}
                                </span>
                              </div>
                              {mountedHere ? (
                                <span className="font-display text-[10px] tracking-[0.2em]" style={{ color: col }}>MOUNTED</span>
                              ) : (
                                <button
                                  onClick={() => {
                                    sfx.uiMove();
                                    gameRef.current?.equipMod(lockerSel, id);
                                  }}
                                  className="menu-btn border px-3 py-1 font-display text-[10px] tracking-[0.2em] hover:text-[#14100c]"
                                  style={{ borderColor: col, color: col }}
                                  onMouseEnter={(ev) => ((ev.target as HTMLElement).style.background = col)}
                                  onMouseLeave={(ev) => ((ev.target as HTMLElement).style.background = "transparent")}
                                >
                                  {mountedElsewhere ? "MOVE HERE" : "MOUNT"}
                                </button>
                              )}
                            </div>
                            <p className="mt-1.5 text-[10px] italic leading-snug tracking-[0.06em] text-[#8a7f6c]">{spec.desc}</p>
                            <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                              {(spec.pros[tier - 1] ?? spec.pros[0]).map((p) => (
                                <div key={p} className="flex items-start gap-1.5 text-[10px] font-semibold leading-snug text-[#7dff5e]">
                                  <span>▲</span><span>{p}</span>
                                </div>
                              ))}
                              {(spec.cons[tier - 1] ?? spec.cons[0]).map((c) => (
                                <div key={c} className="flex items-start gap-1.5 text-[10px] font-semibold leading-snug text-[#ff5a4e]">
                                  <span>▼</span><span>{c}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => gameRef.current?.resume()}
                className="menu-btn font-display mt-6 w-full border-2 border-[#ff6b1a] bg-[rgba(255,107,26,0.12)] px-6 py-2.5 text-base tracking-widest text-[#ffb42e] hover:bg-[#ff6b1a] hover:text-[#14100c]"
              >
                BACK TO THE FLOOR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======= OPTIONS ======= */}
      {optOpen && (
        <div className="fixed inset-0 z-[58] flex items-center justify-center bg-[rgba(8,6,3,0.85)]" style={{ cursor: "crosshair" }}>
          <div className="pointer-events-none absolute inset-0 menu-grid opacity-50" />
          <div className="relative w-[min(560px,92vw)]">
            <div className="hud-panel px-8 py-7">
              <div className="mb-1 flex items-baseline justify-between">
                <div className="font-display text-2xl tracking-wide text-[#ff6b1a]">OPTIONS</div>
                <span className="text-[10px] font-semibold tracking-[0.25em] text-[#6e6353]">SAVES AUTOMATICALLY</span>
              </div>
              <div className="hazard-tape mb-6 mt-3 h-[5px] opacity-80" />

              <OptRow
                label="BRIGHTNESS"
                value={brightness}
                min={0.5}
                max={1.6}
                step={0.02}
                display={`${Math.round(brightness * 100)}%`}
                onChange={setBrightness}
              />
              <OptRow
                label="VOLUME"
                value={volume}
                min={0}
                max={1}
                step={0.02}
                display={`${Math.round(volume * 100)}%`}
                onChange={(v) => {
                  sfx.ensure();
                  setVolume(v);
                }}
              />
              <OptRow
                label="MOUSE SENSITIVITY"
                value={sens}
                min={0.5}
                max={2}
                step={0.02}
                display={`${Math.round(sens * 100)}%`}
                onChange={(v) => setSens(v)}
              />

              <div className="hazard-tape my-6 h-[3px] opacity-40" />

              <SegmentedRow
                label="RENDER RESOLUTION"
                hint="INTERNAL BUFFER — UPSAMPLED TO YOUR PANEL"
                value={resMode}
                onChange={setResMode}
                options={[
                  { value: "480", label: "480i" },
                  { value: "720", label: "720p" },
                  { value: "1080", label: "1080p" },
                  { value: "native", label: "NATIVE" },
                ]}
              />
              <SegmentedRow
                label="ANTIALIASING"
                hint="EDGE SMOOTHING FILTER"
                value={aaMode}
                onChange={setAaMode}
                options={[
                  { value: "off", label: "OFF" },
                  { value: "fxaa", label: "FXAA" },
                  { value: "msaa", label: "MSAA ×4" },
                ]}
              />

              <p className="mt-1 text-[10.5px] leading-relaxed text-[#6e6353]">
                BRIGHTNESS LIFTS THE SIGNAL BEFORE THE CRT FILTER. 480i KEEPS THE CHUNKY PS2 UPSCALE; HIGHER BUFFERS TRADE THAT
                LOOK FOR CLARITY. FXAA SOFTENS EDGES, MSAA ×4 IS THE SHARPEST BUT COSTS FRAMERATE.
              </p>

              <button
                onClick={() => {
                  sfx.uiMove();
                  setOptOpen(false);
                }}
                className="menu-btn mt-6 w-full border border-[rgba(255,107,26,0.5)] bg-[rgba(255,107,26,0.08)] px-6 py-2.5 font-display text-sm tracking-[0.3em] text-[#ffb42e] hover:bg-[rgba(255,107,26,0.18)]"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======= SKILL DRAFT ======= */}
      {phase === "draft" && draftCards && (
        <div className="fixed inset-0 z-[55] flex flex-col items-center justify-center bg-[rgba(8,6,3,0.82)]" style={{ cursor: "crosshair" }}>
          <div className="pointer-events-none absolute inset-0 menu-grid opacity-60" />
          <div className="relative flex flex-col items-center">
            <div className="hazard-tape mb-4 h-[6px] w-56 opacity-90" />
            <div className="font-display title-slant text-4xl text-[#ffb42e] hud-shadow md:text-5xl">SALVAGE REQUISITION</div>
            <p className="mt-2 text-[11px] font-semibold tracking-[0.35em] text-[#8a7f6c]">
              WAVE {String(curWave).padStart(2, "0")} SCRAPPED — INSTALL ONE MODIFICATION
            </p>

            <div className="mt-9 flex flex-col gap-5 md:flex-row md:gap-6">
              {draftCards.map((c, i) => {
                const rc = c.rarity === "epic" ? "#ff2e1f" : c.rarity === "rare" ? "#ff6b1a" : "#b8a88f";
                return (
                  <button
                    key={c.id}
                    onClick={() => pickCard(i)}
                    onMouseEnter={() => sfx.uiMove()}
                    className="draft-card group relative w-[300px] border bg-[rgba(18,13,8,0.94)] px-6 pb-6 pt-0 text-left"
                    style={{ borderColor: `${rc}66`, animationDelay: `${i * 0.09}s` }}
                  >
                    {/* rarity header tape */}
                    <div className="absolute inset-x-0 top-0 flex h-[26px] items-center justify-between px-4" style={{ background: rc }}>
                      <span className="font-display text-[11px] tracking-[0.22em] text-[#14100c]">{c.tag}</span>
                      <span className="font-display text-[10px] tracking-[0.2em] text-[#14100c]">{c.rarity.toUpperCase()}</span>
                    </div>
                    <div className="pt-9">
                      <div className="font-display text-[22px] leading-tight text-[#ffe8c8] group-hover:text-white" style={{ textShadow: `0 0 18px ${rc}55` }}>
                        {c.name}
                      </div>
                      <p className="mt-2.5 text-[12.5px] leading-snug text-[#cdbfa8]">{c.desc}</p>
                      {(c.pros || c.cons) && (
                        <div className="mt-3 space-y-1 border-l-2 border-[rgba(255,107,26,0.3)] pl-2.5">
                          {(c.pros ?? []).map((p, pi) => (
                            <div key={`p${pi}`} className="flex items-start gap-1.5 text-[11px] font-semibold leading-snug text-[#7dff5e]">
                              <span className="mt-[1px]">▲</span>
                              <span>{p}</span>
                            </div>
                          ))}
                          {(c.cons ?? []).map((co, ci) => (
                            <div key={`c${ci}`} className="flex items-start gap-1.5 text-[11px] font-semibold leading-snug text-[#ff5a4e]">
                              <span className="mt-[1px]">▼</span>
                              <span>{co}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-4 flex items-center justify-between border-t border-[rgba(184,168,143,0.18)] pt-3.5">
                        <div className="flex gap-1.5">
                          {Array.from({ length: c.maxLevel }).map((_, p) => (
                            <span
                              key={p}
                              className="inline-block h-[7px] w-[16px] skew-x-[-14deg]"
                              style={{ background: p < c.level + 1 ? rc : "rgba(184,168,143,0.16)" }}
                            />
                          ))}
                        </div>
                        <span className="text-[10px] font-bold tracking-[0.18em] text-[#8a7f6c]">
                          {c.level > 0 ? `LV ${c.level} → ${c.level + 1}` : "NEW INSTALL"}
                        </span>
                      </div>
                      <div className="mt-4 flex items-center gap-2">
                        <span className="keycap">{i + 1}</span>
                        <span className="text-[10px] font-semibold tracking-[0.25em] text-[#6e6353] transition-colors group-hover:text-[#ffb42e]">
                          INSTALL MOD
                        </span>
                      </div>
                    </div>
                    {/* corner brackets */}
                    <span className="pointer-events-none absolute left-1 top-[30px] h-3 w-3 border-l-2 border-t-2" style={{ borderColor: rc }} />
                    <span className="pointer-events-none absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2" style={{ borderColor: rc }} />
                  </button>
                );
              })}
            </div>

            <p className="mt-8 text-[10px] font-semibold tracking-[0.3em] text-[#6e6353]">
              REQUISITION OFFERED EVERY 3 WAVES — THE LINE RESUMES ON INSTALL
            </p>
          </div>
        </div>
      )}

      {/* ======= DEATH ======= */}
      {phase === "dead" && stats && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-[rgba(16,4,2,0.82)]" style={{ cursor: "crosshair" }}>
          <div className="hud-panel w-[480px] max-w-[94vw] px-9 py-8 text-center">
            <div className="hazard-tape mx-auto mb-5 h-[6px] w-48 opacity-90" />
            <div className="font-display title-slant text-5xl text-[#ff2e1f]" style={{ textShadow: "3px 3px 0 #200503, 0 0 30px rgba(255,46,31,0.5)" }}>
              SHIFT TERMINATED
            </div>
            <p className="mt-2 text-[12px] tracking-[0.3em] text-[#b8a88f]">THE FLOOR BELONGS TO THE RAIDERS</p>

            <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-left">
              {[
                ["WAVES SURVIVED", String(stats.wave), "#ff6b1a"],
                ["RAIDERS DOWN", String(stats.kills), "#ffb42e"],
                ["SALVAGE SCORE", String(stats.score), "#ffe8c8"],
                ["ACCURACY", `${stats.accuracy}%`, "#7dff5e"],
              ].map(([label, value, color]) => (
                <div key={label} className="border border-[rgba(255,107,26,0.25)] bg-[rgba(0,0,0,0.35)] px-4 py-3">
                  <div className="text-[10px] font-semibold tracking-[0.25em] text-[#8a7f6c]">{label}</div>
                  <div className="font-display text-3xl" style={{ color }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] tracking-[0.25em] text-[#6e6353]">
              TIME ON FLOOR — {Math.floor(stats.time / 60)}:{String(stats.time % 60).padStart(2, "0")}
            </div>

            <div className="mt-7 flex justify-center gap-3">
              <button
                onClick={() => gameRef.current?.restart()}
                className="menu-btn font-display border-2 border-[#ff6b1a] bg-[rgba(255,107,26,0.12)] px-7 py-3 text-lg tracking-widest text-[#ffb42e] hover:bg-[#ff6b1a] hover:text-[#14100c]"
              >
                RE-DEPLOY
              </button>
              <button
                onClick={() => gameRef.current?.toAttract()}
                className="menu-btn font-display border border-[rgba(184,168,143,0.4)] px-6 py-3 text-sm tracking-widest text-[#cdbfa8] hover:border-[#ffb42e] hover:text-[#ffb42e]"
              >
                MAIN MENU
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
