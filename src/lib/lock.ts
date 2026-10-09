import type { FuelCode } from "./fuel";
import { haversineKm, nearestOnRing, nudge, ringAreaKm2, ringCentroid, type LatLng } from "./geo";
import type { CellsFile, PriceTable, Store } from "./types";

type Cell = CellsFile["cells"][number];

/** Per-store price for one fuel type, aligned with the stores array. */
export interface PriceView {
  /** Cents per litre; undefined when the store doesn't sell this fuel or has no price data. */
  price: (number | undefined)[];
  /** True when the price feed knows this store, so an undefined price means "doesn't sell it". */
  known: boolean[];
}

export function viewPrices(stores: Store[], table: PriceTable, fuel: FuelCode): PriceView {
  return {
    price: stores.map((s) => table[s.id]?.[fuel]),
    known: stores.map((s) => s.id in table),
  };
}

export interface CellInfo {
  /** The lock price anywhere in this cell: the cheapest of its five stores. */
  price: number | null;
  /** Members that set that price (more than one on a tie). */
  setters: number[];
  /** Some member has no price data, so the real lock price could be lower than `price`. */
  uncertain: boolean;
}

export function analyseCells(cells: Cell[], view: PriceView): CellInfo[] {
  return cells.map((c) => {
    let price: number | null = null;
    let setters: number[] = [];
    let uncertain = false;
    for (const m of c.m) {
      if (!view.known[m]) uncertain = true;
      const p = view.price[m];
      if (p === undefined) continue;
      if (price === null || p < price) {
        price = p;
        setters = [m];
      } else if (p === price) {
        setters.push(m);
      }
    }
    return { price, setters, uncertain };
  });
}

export interface Reach {
  /** Straight-line km from the user to the nearest point of the cell (0 if inside it). */
  km: number;
  /** A spot just inside the cell, near that nearest point. */
  spot: LatLng;
}

const INSIDE_NUDGE_KM = 0.15;

export function cellReach(center: LatLng, cells: Cell[]): Reach[] {
  return cells.map((c) => {
    const near = nearestOnRing(center, c.r);
    if (near.km === 0) return { km: 0, spot: center };
    // The nearest point sits exactly on the boundary; step inside so it lands in the right cell.
    return { km: near.km, spot: nudge(near, ringCentroid(c.r), INSIDE_NUDGE_KM) };
  });
}

export interface Choice {
  cell: number;
  price: number;
  km: number;
  spot: LatLng;
  setters: number[];
  uncertain: boolean;
}

/** Cheapest lock price reachable within the radius; the nearest cell wins ties. */
export function bestInRange(infos: CellInfo[], reach: Reach[], radiusKm: number): Choice | null {
  let best: Choice | null = null;
  infos.forEach((info, cell) => {
    const r = reach[cell];
    if (info.price === null || r.km > radiusKm) return;
    if (!best || info.price < best.price || (info.price === best.price && r.km < best.km)) {
      best = { cell, price: info.price, km: r.km, spot: r.spot, setters: info.setters, uncertain: info.uncertain };
    }
  });
  return best;
}

/** The cell that contains the user's own location, if the zones cover it. */
export function cellHere(reach: Reach[]): number {
  return reach.findIndex((r) => r.km === 0);
}

export interface StoreRow {
  store: number;
  price: number;
  /** Nearest in-range cell where this store sets the lock price. */
  km: number;
  spot: LatLng;
  cell: number;
  uncertain: boolean;
}

/** Stores that can actually set a lock price somewhere in range, cheapest first. */
export function rankStores(infos: CellInfo[], reach: Reach[], radiusKm: number): StoreRow[] {
  const rows = new Map<number, StoreRow>();
  infos.forEach((info, cell) => {
    const r = reach[cell];
    if (info.price === null || r.km > radiusKm) return;
    for (const s of info.setters) {
      const prev = rows.get(s);
      if (!prev || r.km < prev.km) {
        rows.set(s, { store: s, price: info.price, km: r.km, spot: r.spot, cell, uncertain: info.uncertain });
      }
    }
  });
  return [...rows.values()].sort((a, b) => a.price - b.price || a.km - b.km);
}

export interface StoreZone {
  /** Cells where this store's price is the lock price: it is one of your five closest and the cheapest of them. */
  locks: number[];
  areaKm2: number;
}

export function storeZone(store: number, cells: Cell[], infos: CellInfo[]): StoreZone {
  const locks: number[] = [];
  let areaKm2 = 0;
  infos.forEach((info, i) => {
    if (!info.setters.includes(store)) return;
    locks.push(i);
    areaKm2 += ringAreaKm2(cells[i].r);
  });
  return { locks, areaKm2 };
}

/** The nearest reach among a set of cells. */
export function nearestOf(cellIdx: number[], reach: Reach[]): { cell: number; reach: Reach } | null {
  let best: { cell: number; reach: Reach } | null = null;
  for (const c of cellIdx) {
    if (!best || reach[c].km < best.reach.km) best = { cell: c, reach: reach[c] };
  }
  return best;
}

/** The five stores nearest a point, exactly as the lock would see them. */
export function nearestFive(point: LatLng, stores: Store[], k = 5): { store: number; km: number }[] {
  return stores
    .map((s, i) => ({ store: i, km: haversineKm(point, s) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, k);
}

/** Display label for a store, e.g. "Brunswick West". */
export function storeLabel(s: Store): string {
  return s.loc ?? s.addr ?? `${s.lat.toFixed(3)}, ${s.lng.toFixed(3)}`;
}

export function mapsLinks(p: LatLng) {
  const q = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    apple: `https://maps.apple.com/?daddr=${q}`,
  };
}
