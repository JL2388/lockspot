// Builds public/data/stores.json and public/data/cells.json.
//
// Zones depend only on where the stores are, not on prices, so they are computed here, ahead of
// time, and only when the store list actually changes. Run weekly (see .github/workflows).
//
//   npm run build:data            rebuild only if the store list changed
//   npm run build:data -- --force rebuild regardless
//
// Store locations come from OpenStreetMap. If NSW_FUEL_API_KEY / NSW_FUEL_API_SECRET are set,
// NSW stores are matched to FuelCheck stations so live prices can be attached.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchFuelCheck, type FuelCheckStation } from "../src/lib/fuelcheck";
import { haversineKm } from "../src/lib/geo";
import { computeOrderKCells } from "../src/lib/orderk";
import type { CellsFile, Store, StoresFile } from "../src/lib/types";
import { LOCK_K, ZONE_BBOX } from "../src/lib/zones-config";

const OUT_DIR = path.resolve(process.cwd(), "public/data");
const STORES_PATH = path.join(OUT_DIR, "stores.json");
const CELLS_PATH = path.join(OUT_DIR, "cells.json");
const UA = "lock-spot/0.1 (7-Eleven fuel lock zone builder)";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

const force = process.argv.includes("--force");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round5 = (x: number) => Math.round(x * 1e5) / 1e5;
const SEVEN = /7[\s-]?eleven/i;

async function overpass<T>(query: string): Promise<T> {
  let lastErr: unknown;
  for (const url of OVERPASS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }),
        });
        if (!res.ok) throw new Error(`${url} -> ${res.status}`);
        const body = (await res.json()) as T & { remark?: string; elements?: unknown[] };
        // Overpass reports server-side timeouts as a 200 with a remark and no elements.
        if (body.remark || !body.elements?.length) throw new Error(`${url} -> ${body.remark ?? "empty result"}`);
        return body;
      } catch (e) {
        lastErr = e;
        await sleep(3000);
      }
    }
  }
  throw lastErr;
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (_, a: string, b: string) => a.toUpperCase() + b);

function localityFromName(name: string | undefined): string | undefined {
  const rest = (name ?? "").replace(/^(mobil\s+)?7[\s-]?eleven\s*[-–,]?\s*/i, "").trim();
  return rest && !/^fuel|petrol|service/i.test(rest) ? rest : undefined;
}

function localityFromAddress(address: string): string | undefined {
  const last = address.split(",").pop()?.trim() ?? "";
  const m = last.match(/^(.*?)\s+(NSW|ACT|TAS|VIC|QLD|SA|WA|NT)\s+\d{4}$/i);
  return m ? titleCase(m[1]) : undefined;
}

async function fetchOsmStores(): Promise<Store[]> {
  const q = `[out:json][timeout:180];area["ISO3166-1"="AU"]->.a;
(nwr["amenity"="fuel"]["brand"~"7-Eleven",i](area.a);nwr["amenity"="fuel"]["name"~"7.?Eleven",i](area.a););out center tags;`;
  // --cached reuses the last OpenStreetMap response; the live query takes 1-2 minutes.
  const cachePath = path.resolve(process.cwd(), ".cache/osm-stores.json");
  let elements: OsmElement[];
  if (process.argv.includes("--cached") && existsSync(cachePath)) {
    elements = JSON.parse(readFileSync(cachePath, "utf8"));
  } else {
    ({ elements } = await overpass<{ elements: OsmElement[] }>(q));
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(elements));
  }
  const out: Store[] = [];
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    const t = e.tags ?? {};
    if (lat == null || lng == null) continue;
    if (!SEVEN.test(t.brand ?? "") && !SEVEN.test(t.name ?? "") && !SEVEN.test(t.operator ?? "")) continue;
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    const loc = t["addr:suburb"] ?? t["addr:city"] ?? localityFromName(t.name);
    const addr = [street, loc].filter(Boolean).join(", ");
    out.push({
      id: `osm-${e.type[0]}${e.id}`,
      lat: round5(lat),
      lng: round5(lng),
      ...(loc ? { loc } : {}),
      ...(addr ? { addr } : {}),
    });
  }
  return out;
}

// Rough NSW + ACT outline (lat, lng). Only used to drop OSM stores that FuelCheck doesn't know about.
const NSW_ACT: [number, number][] = [
  [-28.15, 141.0],
  [-28.15, 153.6],
  [-37.55, 150.05],
  [-36.4, 148.3],
  [-36.1, 146.9],
  [-36.1, 144.75],
  [-35.3, 143.5],
  [-34.2, 142.0],
  [-34.0, 141.0],
];

function inPolygon(lat: number, lng: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearest(stores: Store[], lat: number, lng: number, maxKm: number, skip: Set<string>) {
  let best: Store | undefined;
  let bestKm = maxKm;
  for (const s of stores) {
    if (skip.has(s.id)) continue;
    const d = haversineKm({ lat, lng }, s);
    if (d <= bestKm) {
      bestKm = d;
      best = s;
    }
  }
  return best;
}

async function mergeFuelCheck(osm: Store[]): Promise<Store[]> {
  const key = process.env.NSW_FUEL_API_KEY;
  const secret = process.env.NSW_FUEL_API_SECRET;
  if (!key || !secret) {
    // CI passes --require-fuelcheck: an OpenStreetMap-only list has no FuelCheck ids, so committing
    // it would break live price matching on the deployed site.
    if (process.argv.includes("--require-fuelcheck")) {
      throw new Error("NSW_FUEL_API_KEY and NSW_FUEL_API_SECRET are required (--require-fuelcheck)");
    }
    console.log("No NSW_FUEL_API_KEY/SECRET: using OpenStreetMap stores only (prices will be demo data).");
    return osm;
  }
  console.log("Fetching FuelCheck stations...");
  const { stations } = await fetchFuelCheck(key, secret);
  const sevens = stations.filter((s) => SEVEN.test(s.brand));
  const others = stations.filter((s) => !SEVEN.test(s.brand));

  const matched = new Set<string>();
  const merged: Store[] = [];
  const take = (fc: FuelCheckStation, radiusKm: number, createIfMissing: boolean) => {
    const o = nearest(osm, fc.lat, fc.lng, radiusKm, matched);
    if (!o && !createIfMissing) return;
    if (o) matched.add(o.id);
    const loc = localityFromAddress(fc.address) ?? o?.loc;
    merged.push({
      id: `fc-${fc.code}`,
      fc: fc.code,
      lat: round5(fc.lat),
      lng: round5(fc.lng),
      ...(loc ? { loc } : {}),
      ...(fc.address ? { addr: fc.address } : {}),
    });
  };
  for (const fc of sevens) take(fc, 0.15, true);
  // Sites still flying another brand (e.g. Mobil) but listed as 7-Eleven in OSM.
  for (const fc of others) take(fc, 0.075, false);

  let dropped = 0;
  const rest = osm.filter((s) => {
    if (matched.has(s.id)) return false;
    if (inPolygon(s.lat, s.lng, NSW_ACT)) {
      dropped++;
      return false;
    }
    return true;
  });
  console.log(
    `FuelCheck: ${merged.length} stations merged, ${rest.length} OSM stores kept outside NSW/ACT, ${dropped} unmatched OSM stores inside NSW/ACT dropped.`,
  );
  return [...merged, ...rest];
}

function dedupe(stores: Store[]): Store[] {
  const sorted = [...stores].sort((a, b) => Number(!!b.fc) - Number(!!a.fc) || a.id.localeCompare(b.id));
  const kept: Store[] = [];
  for (const s of sorted) {
    if (kept.some((k) => haversineKm(k, s) < 0.04)) continue;
    kept.push(s);
  }
  if (kept.length !== stores.length) console.log(`Deduped ${stores.length - kept.length} near-identical stores.`);
  return kept;
}

async function fillLocalities(stores: Store[]) {
  const missing = stores.filter((s) => !s.loc);
  if (!missing.length) return;
  const { south, west, north, east } = ZONE_BBOX;
  const q = `[out:json][timeout:180];node["place"~"^(suburb|town|village|city|hamlet|neighbourhood)$"](${south},${west},${north},${east});out;`;
  const { elements } = await overpass<{ elements: OsmElement[] }>(q);
  const places = elements.filter((e) => e.tags?.name && e.lat != null && e.lon != null);
  let filled = 0;
  for (const s of missing) {
    let best: string | undefined;
    let bestKm = 10;
    for (const p of places) {
      const d = haversineKm(s, { lat: p.lat!, lng: p.lon! });
      if (d < bestKm) {
        bestKm = d;
        best = p.tags!.name;
      }
    }
    if (best) {
      s.loc = best;
      filled++;
    }
  }
  console.log(`Named ${filled} of ${missing.length} stores from nearby places.`);
}

const hashStores = (stores: Store[]) =>
  createHash("sha1")
    .update(JSON.stringify(stores.map((s) => [s.id, round5(s.lat), round5(s.lng)])))
    .digest("hex")
    .slice(0, 16);

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const osm = await fetchOsmStores();
  console.log(`OpenStreetMap: ${osm.length} 7-Eleven fuel sites in Australia.`);
  const stores = dedupe(await mergeFuelCheck(osm)).sort((a, b) => b.lat - a.lat || a.lng - b.lng || a.id.localeCompare(b.id));
  const hash = hashStores(stores);

  const previous: StoresFile | undefined = existsSync(STORES_PATH)
    ? JSON.parse(readFileSync(STORES_PATH, "utf8"))
    : undefined;
  if (!force && previous?.hash === hash && existsSync(CELLS_PATH)) {
    console.log(`Store list unchanged (${hash}); zones are up to date.`);
    return;
  }
  // A partial download (an Overpass hiccup, a FuelCheck outage) shouldn't silently shrink the map.
  if (!force && previous && stores.length < previous.stores.length * 0.8) {
    throw new Error(
      `Store list shrank from ${previous.stores.length} to ${stores.length}; refusing to overwrite (use --force if that's right).`,
    );
  }

  // Keep names we already resolved so a rebuild doesn't need to re-query places.
  const prevLoc = new Map(previous?.stores.map((s) => [s.id, s.loc]));
  for (const s of stores) if (!s.loc && prevLoc.get(s.id)) s.loc = prevLoc.get(s.id);
  await fillLocalities(stores);

  console.log(`Computing order-${LOCK_K} zones for ${stores.length} stores...`);
  const t0 = Date.now();
  const cells = computeOrderKCells(stores, LOCK_K, ZONE_BBOX);
  console.log(`${cells.length} cells in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);

  const now = new Date().toISOString();
  const storesFile: StoresFile = { hash: hashStores(stores), generatedAt: now, stores };
  const cellsFile: CellsFile = {
    k: LOCK_K,
    bbox: ZONE_BBOX,
    storesHash: storesFile.hash,
    generatedAt: now,
    cells: cells.map((c) => ({ m: c.members, r: c.ring.map(round5) })),
  };
  writeFileSync(STORES_PATH, JSON.stringify(storesFile));
  writeFileSync(CELLS_PATH, JSON.stringify(cellsFile));
  console.log(`Wrote ${path.relative(process.cwd(), STORES_PATH)} and ${path.relative(process.cwd(), CELLS_PATH)}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
