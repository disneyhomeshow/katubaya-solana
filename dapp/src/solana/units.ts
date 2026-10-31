// README section 10: quantities are integers on-chain. kg and liter are stored in g and ml,
// every count unit as a count. `price_minor` is per base unit, so the program's
// `subtotal = qty * price_minor` holds; the screens show prices per unit the farmer sells in.
import type { UnitCode } from "../design-system";

export type Unit = {
  code: UnitCode;
  /** As the farmer picks it in "Sold by". */
  option: string;
  /** Shown after a price ("USDC / kg") and in field affixes. */
  short: string;
  /** Base units per shown unit. */
  factor: bigint;
  /** Name of the base unit when it differs ("g"), for "Stored as 48,500 g". */
  base?: string;
};

export const UNITS: Unit[] = [
  { code: 2, option: "kg", short: "kg", factor: 1000n, base: "g" },
  { code: 1, option: "g", short: "g", factor: 1n },
  { code: 4, option: "liter", short: "L", factor: 1000n, base: "ml" },
  { code: 3, option: "ml", short: "ml", factor: 1n },
  { code: 10, option: "unit", short: "unit", factor: 1n },
  { code: 11, option: "bunch", short: "bunch", factor: 1n },
  { code: 12, option: "bag", short: "bag", factor: 1n },
  { code: 13, option: "tray", short: "tray", factor: 1n },
  { code: 14, option: "box", short: "box", factor: 1n },
];

const BY_CODE = new Map(UNITS.map((u) => [u.code as number, u]));

/** Unknown codes read as a plain count, like the design system's `formatQty`. */
export function unitOf(code: number): Unit {
  return BY_CODE.get(code) ?? BY_CODE.get(10)!;
}

export function asUnitCode(code: number): UnitCode {
  return unitOf(code).code;
}

/** Digits a decimal may carry so that `value * 10^digits` is an integer. */
function fractionDigits(factor: bigint): number {
  return factor === 1n ? 0 : factor.toString().length - 1;
}

/**
 * Parses a decimal typed by a person ("48.5", "1,250.00") into an integer scaled by `10^decimals`.
 * Returns null when it is not a number or carries more fraction digits than `decimals`.
 */
export function parseDecimal(text: string, decimals: number): bigint | null {
  const clean = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  if (frac.length > decimals) return null;
  return BigInt((whole || "0") + frac.padEnd(decimals, "0"));
}

/** Shown quantity ("48.5" kg) to base units (48500 g); null when it does not land on a whole base unit. */
export function toBaseQty(text: string, unitCode: number): bigint | null {
  return parseDecimal(text, fractionDigits(unitOf(unitCode).factor));
}

/** Base units back to the number the person typed, without the unit name. */
export function fromBaseQty(base: bigint, unitCode: number): string {
  const { factor } = unitOf(unitCode);
  const digits = fractionDigits(factor);
  if (digits === 0) return base.toString();
  const whole = base / factor;
  const frac = (base % factor).toString().padStart(digits, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** `price_minor` (per base unit) to the price per shown unit, in minor units. */
export function pricePerShownUnit(priceMinor: bigint, unitCode: number): bigint {
  return priceMinor * unitOf(unitCode).factor;
}

/**
 * Price per shown unit in minor units to `price_minor` per base unit.
 * Null when it does not divide evenly (7.0005 USDC per kg is 7000.5 minor per gram).
 */
export function pricePerBaseUnit(perShownMinor: bigint, unitCode: number): bigint | null {
  const { factor } = unitOf(unitCode);
  return perShownMinor % factor === 0n ? perShownMinor / factor : null;
}

/** Fraction digits a price per shown unit may have for this mint and unit. */
export function priceDigits(decimals: number, unitCode: number): number {
  return Math.max(0, decimals - fractionDigits(unitOf(unitCode).factor));
}

/** Byte length as the program measures `String::len()`. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
