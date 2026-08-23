/* ============================================================
   Universal weapon modifications.
   Each mod can be installed on any of the four guns (drafted
   from the Salvage Requisition terminal). Every one carries a
   genuine trade-off so a build is a choice, not a free buff.
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
  /** what you gain */
  pros: string[];
  /** what it costs you */
  cons: string[];
  rarity: "rare" | "epic";
  /** draft weight — rarer mods appear less often */
  weight: number;
}

export const GUN_MODS: GunModSpec[] = [
  {
    id: "suppressor",
    name: "SUPPRESSOR",
    short: "SUP",
    desc: "BAFFLED OIL-FILTER CANS, SCREWED ON CROOKED. THE FOUNDRY SWALLOWS THE CRACK.",
    pros: [
      "RAIDERS STARTLE FAR LESS — HALF THE NOISE RADIUS",
      "MUZZLE FLASH CUT 65% — YOU STAY UNLIT",
    ],
    cons: ["−12% DAMAGE — SUBSONIC LOADS HIT SOFTER"],
    rarity: "rare",
    weight: 3.0,
  },
  {
    id: "brake",
    name: "MUZZLE BRAKE",
    short: "BRK",
    desc: "MACHINED STEEL THAT VENTS THE BLAST SIDEWAYS AND HAULS THE MUZZLE DOWN.",
    pros: ["−30% RECOIL CLIMB", "−20% SCREEN SHAKE"],
    cons: [
      "+20% SPREAD — SIDE-VENTED GAS SCATTERS THE PATTERN",
      "LOUDER, BRIGHTER BLAST — RAIDERS REACT WIDER",
    ],
    rarity: "rare",
    weight: 3.0,
  },
  {
    id: "mag",
    name: "EXTENDED MAG",
    short: "MAG",
    desc: "A WELDED-ON EXTENSION. MORE ROUNDS BETWEEN YOU AND THE DARK.",
    pros: ["+50% ROUNDS IN THE GUN", "+30% RESERVE CAPACITY"],
    cons: [
      "+20% RELOAD TIME — HEAVY FEED, LONGER SWAP",
      "−5% MOVE SPEED · GUN HANGS HEAVIER (+15% SWAY)",
    ],
    rarity: "rare",
    weight: 3.0,
  },
  {
    id: "laser",
    name: "LASER SIGHT",
    short: "LSR",
    desc: "A RAIL-MOUNTED DIODE THAT PAINTS A RED LINE WHERE THE ROUNDS WILL LAND.",
    pros: ["−35% BASE SPREAD", "−20% HEAT BLOOM · VISIBLE AIM BEAM"],
    cons: [
      "NOSE-HEAVY — +10% GUN SWAY",
      "THE DOT GIVES YOU AWAY — RAIDERS DODGE MORE OFTEN",
    ],
    rarity: "epic",
    weight: 1.8,
  },
  {
    id: "light",
    name: "FLASHLIGHT",
    short: "FLH",
    desc: "A HALOGEN TORCH TAPED UNDER THE BARREL. THE NIGHT SHIFT ENDS WHEN YOU SAY.",
    pros: [
      "ILLUMINATES THE FLOOR AHEAD",
      "DAZZLED RAIDERS IN THE BEAM TAKE +5% DAMAGE",
    ],
    cons: [
      "−3% MOVE SPEED",
      "YOUR SILHOUETTE IS LIT — RAIDERS DODGE MORE OFTEN",
    ],
    rarity: "epic",
    weight: 1.8,
  },
];

export const GUN_MOD_INDEX: Record<GunModId, number> = {
  suppressor: 0,
  brake: 1,
  mag: 2,
  laser: 3,
  light: 4,
};
