import { FUELS, type FuelCode } from "./fuel";
import type { FuelCheckPrice } from "./fuelcheck";
import type { PriceTable, Store } from "./types";

/**
 * Turns a FuelCheck price list into our per-store table. Every FuelCheck-matched store is "known":
 * a fuel missing from its entry means it doesn't sell it, while stores we have no feed for (e.g.
 * interstate) are left out entirely so the app can flag them as unknown.
 */
export function liveTable(stores: Store[], prices: FuelCheckPrice[]): PriceTable {
  const byCode = new Map(stores.filter((s) => s.fc).map((s) => [s.fc!, s.id]));
  const table: PriceTable = Object.fromEntries(stores.filter((s) => s.fc).map((s) => [s.id, {}]));
  for (const p of prices) {
    const id = byCode.get(p.stationcode);
    if (id) table[id][p.fueltype] = p.price;
  }
  return table;
}

// --- Demo data -----------------------------------------------------------------------------------
// Deterministic fake prices so the app is usable before an API key is configured. Not real.

const BASE: Record<FuelCode, number> = {
  U91: 189.9,
  E10: 185.9,
  P95: 204.9,
  P98: 212.9,
  DL: 198.9,
  PDL: 211.9,
  LPG: 99.9,
};

function unit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export function demoTable(stores: Store[]): PriceTable {
  const table: PriceTable = {};
  for (const s of stores) {
    const regional = 7 * Math.sin(s.lat * 41 + s.lng * 17); // smooth-ish geographic variation
    const site = (unit(s.id) * 2 - 1) * 9;
    const row: Record<string, number> = {};
    for (const f of FUELS) {
      if (f.code === "LPG" && unit(`${s.id}:lpg`) > 0.4) continue; // most sites don't sell LPG
      const noise = (unit(`${s.id}:${f.code}`) * 2 - 1) * 1.5;
      row[f.code] = Math.round((BASE[f.code] + (f.code === "LPG" ? 0 : regional + site) + noise) * 10) / 10;
    }
    table[s.id] = row;
  }
  return table;
}
