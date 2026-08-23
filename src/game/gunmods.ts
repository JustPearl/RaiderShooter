/* ============================================================
   Universal weapon attachments.
   These are no longer handed out at the requisition terminal —
   they are LOOT. Raiders occasionally drop a part (heavies more
   often, Mk.II only from deeper waves); you pocket it, then
   mount it on a gun of your choice in the Gun Locker. Each
   attachment is a single physical item, so it can only ride one
   weapon at a time — finding a duplicate is stripped for salvage.
   ============================================================ */

export type GunModId = "suppressor" | "brake" | "mag" | "laser" | "light";

export interface GunModSpec {
  id: GunModId;
  /** full name shown on the card */
  name: string;
  /** 3-letter tag shown in the HUD ammo panel */
  short: string;
  /** foundry-floor flavor line */
  desc: string;
  rarity: "rare" | "epic";
  /** drop weight among the five */
  weight: number;
  /** [Mk.I, Mk.II] — what each tier gains */
  pros: [string[], string[]];
  /** [Mk.I, Mk.II] — what each tier costs */
  cons: [string[], string[]];
}

export const GUN_MODS: GunModSpec[] = [
  {
    id: "suppressor",
    name: "SUPPRESSOR",
    short: "SUP",
    desc: "BAFFLED OIL-FILTER CANS, SCREWED ON CROOKED. THE FOUNDRY SWALLOWS THE CRACK.",
    rarity: "rare",
    weight: 3.0,
    pros: [
      ["HALF THE NOISE RADIUS — RAIDERS STARTLE LESS", "MUZZLE FLASH CUT 65% — YOU STAY UNLIT"],
      ["NOISE RADIUS DOWN 60%", "MUZZLE FLASH CUT 75% · TIGHTER PATTERN"],
    ],
    cons: [["−12% DAMAGE — SUBSONIC LOADS HIT SOFTER"], ["−6% DAMAGE — COLDER, QUIETER ROUNDS"]],
  },
  {
    id: "brake",
    name: "MUZZLE BRAKE",
    short: "BRK",
    desc: "MACHINED STEEL THAT VENTS THE BLAST SIDEWAYS AND HAULS THE MUZZLE DOWN.",
    rarity: "rare",
    weight: 3.0,
    pros: [["−30% RECOIL CLIMB", "−20% SCREEN SHAKE"], ["−40% RECOIL CLIMB", "−30% SCREEN SHAKE · LESS SCATTER"]],
    cons: [
      ["+20% SPREAD — SIDE-VENTED GAS SCATTERS THE PATTERN", "LOUDER, BRIGHTER BLAST — RAIDERS REACT WIDER"],
      ["+10% SPREAD", "LOUDER, BRIGHTER BLAST — RAIDERS REACT WIDER"],
    ],
  },
  {
    id: "mag",
    name: "EXTENDED MAG",
    short: "MAG",
    desc: "A WELDED-ON EXTENSION. MORE ROUNDS BETWEEN YOU AND THE DARK.",
    rarity: "rare",
    weight: 3.0,
    pros: [["+50% ROUNDS IN THE GUN", "+30% RESERVE CAPACITY"], ["+75% ROUNDS IN THE GUN", "+50% RESERVE CAPACITY · SWIFTER SWAP"]],
    cons: [
      ["+20% RELOAD TIME — HEAVY FEED, LONGER SWAP", "−5% MOVE SPEED · GUN HANGS HEAVIER"],
      ["+15% RELOAD TIME", "−3% MOVE SPEED · GUN HANGS HEAVIER"],
    ],
  },
  {
    id: "laser",
    name: "LASER SIGHT",
    short: "LSR",
    desc: "A RAIL-MOUNTED DIODE THAT PAINTS A LINE WHERE THE ROUNDS WILL LAND.",
    rarity: "epic",
    weight: 1.8,
    pros: [["−35% BASE SPREAD", "−20% HEAT BLOOM · VISIBLE AIM BEAM"], ["−45% BASE SPREAD", "−30% HEAT BLOOM · VISIBLE AIM BEAM"]],
    cons: [
      ["NOSE-HEAVY — +10% GUN SWAY", "THE DOT GIVES YOU AWAY — RAIDERS DODGE MORE"],
      ["NOSE-HEAVY — +5% GUN SWAY", "THE DOT GIVES YOU AWAY — RAIDERS DODGE MORE"],
    ],
  },
  {
    id: "light",
    name: "FLASHLIGHT",
    short: "FLH",
    desc: "A HALOGEN TORCH TAPED UNDER THE BARREL. THE NIGHT SHIFT ENDS WHEN YOU SAY.",
    rarity: "epic",
    weight: 1.8,
    pros: [["ILLUMINATES THE FLOOR AHEAD", "DAZZLED RAIDERS IN THE BEAM TAKE +5% DAMAGE"], ["BRIGHTER BEAM", "DAZZLED RAIDERS TAKE +8% DAMAGE"]],
    cons: [["−3% MOVE SPEED", "YOUR SILHOUETTE IS LIT — RAIDERS DODGE MORE"], ["−2% MOVE SPEED", "YOUR SILHOUETTE IS LIT — RAIDERS DODGE MORE"]],
  },
];

export const tierLabel = (tier: number) => (tier >= 2 ? "MK.II" : "MK.I");
