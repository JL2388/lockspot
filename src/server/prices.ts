import { cacheLife } from "next/cache";
import storesFile from "../../public/data/stores.json";
import { FUELS } from "@/lib/fuel";
import { fetchFuelCheck } from "@/lib/fuelcheck";
import type { PriceTable, PricesPayload, StoresFile } from "@/lib/types";

const stores = (storesFile as StoresFile).stores;

/**
 * One upstream call serves every visitor: the result is cached for 30 minutes, which keeps us well
 * inside FuelCheck's 2,500 calls/month free tier (about 1,500 calls a month).
 */
export async function getPrices(): Promise<PricesPayload> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 1800, expire: 7200 });

  const key = process.env.NSW_FUEL_API_KEY;
  const secret = process.env.NSW_FUEL_API_SECRET;
  if (key && secret) return { demo: false, updatedAt: new Date().toISOString(), prices: await livePrices(key, secret) };
  return { demo: true, updatedAt: new Date().toISOString(), prices: demoPrices() };
}

async function livePrices(key: string, secret: string): Promise<PriceTable> {
  const { prices } = await fetchFuelCheck(key, secret);
  const byCode = new Map(stores.filter((s) => s.fc).map((s) => [s.fc!, s.id]));
  // Every FuelCheck-matched store is "known": a fuel missing from its entry means it doesn't sell it.
  const table: PriceTable = Object.fromEntries(stores.filter((s) => s.fc).map((s) => [s.id, {}]));
  for (const p of prices) {
    const id = byCode.get(p.stationcode);
    if (id) table[id][p.fueltype] = p.price;
  }
  return table;
}

// --- Demo data -----------------------------------------------------------------------------------
// Deterministic fake prices so the app is usable before an API key is configured. Not real.

const BASE: Record<(typeof FUELS)[number]["code"], number> = {
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

function demoPrices(): PriceTable {
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
