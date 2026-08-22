import { useEffect, useRef, useState } from "react";
import { FoundryGame, type GameEvent, type HudData, type FinalStats, type GamePhase } from "./game/engine";

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
  const [weapon, setWeapon] = useState(0);

  /* fast-path refs (updated every frame without re-render) */
  const hpFill = useRef<HTMLDivElement>(null);
  const hpText = useRef<HTMLSpanElement>(null);
  const hpWrap = useRef<HTMLDivElement>(null);
  const ammoText = useRef<HTMLSpanElement>(null);
  const reserveText = useRef<HTMLSpanElement>(null);
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
  const slotRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const lastWeapon = useRef(-1);

  useEffect(() => {
    if (!canvasRef.current) return;
    const onEvent = (e: GameEvent) => {
      switch (e.type) {
        case "playing":
          setPhase("playing");
          setKillFeed([]);
          break;
        case "paused":
          setPhase("paused");
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
          setBanner({ key: uid++, title: `WAVE ${String(e.wave).padStart(2, "0")} CLEARED`, sub: `+${e.bonus} SALVAGE // +10 SHELLS // +12 HP`, tone: "green" });
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
        for (let i = 0; i < 2; i++) {
          if (slotRefs[i].current) {
            slotRefs[i].current!.style.borderColor = i === h.weapon ? "#ff6b1a" : "rgba(184,168,143,0.25)";
            slotRefs[i].current!.style.color = i === h.weapon ? "#ffb42e" : "rgba(184,168,143,0.45)";
          }
        }
      }
    };

    const game = new FoundryGame(canvasRef.current, onEvent, onHud);
    gameRef.current = game;
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
              {["1 P-9", "2 M870"].map((label, i) => (
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
                  <div className="flex gap-1"><span className="keycap">SHIFT</span></div>
                  <span>SPRINT</span>
                  <div className="flex gap-1"><span className="keycap">SPACE</span></div>
                  <span>JUMP</span>
                  <div className="flex gap-1"><span className="keycap">R</span></div>
                  <span>RELOAD</span>
                  <div className="flex gap-1"><span className="keycap">1</span><span className="keycap">2</span><span className="keycap">WHEEL</span></div>
                  <span>SWAP WEAPON</span>
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
                      <span className="font-bold text-[#ffe8c8]">P-9 SCRAPLOCK</span> — rapid sidearm. Bottomless reserve. Headshots pay double.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg width="30" height="18" viewBox="0 0 30 18" className="mt-0.5 shrink-0">
                      <rect x="1" y="6" width="28" height="4" fill="#b8a88f" />
                      <rect x="18" y="10" width="11" height="5" fill="#8a5a3c" />
                    </svg>
                    <p className="text-[#cdbfa8]">
                      <span className="font-bold text-[#ffe8c8]">M870 BREAKER</span> — 8-pellet scattergun. Shells are scarce. Point-blank deletes.
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
                      <span className="font-bold text-[#ff8a5e]">THREAT INTEL</span> — raiders flank, feint and encircle. A point-blank blast breaks a wound-up swing. Sidestep the brute's stomp, then punish the stagger.
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
      {phase === "paused" && (
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
                onClick={() => gameRef.current?.toAttract()}
                className="menu-btn font-display border border-[rgba(184,168,143,0.4)] px-6 py-2.5 text-sm tracking-widest text-[#cdbfa8] hover:border-[#ffb42e] hover:text-[#ffb42e]"
              >
                ABANDON POST
              </button>
            </div>
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
