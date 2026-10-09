import type { CellInfo, PriceView, Reach, StoreZone } from "./lock";
import type { Store } from "./types";

// Cheap -> dear. Cheap is a deep green, dear a burnt orange, with amber between, so the ends stay
// distinguishable without relying on red/green alone. The legend and map share these stops.
export const RAMP = [
  { at: 0, color: "#0a8f62" },
  { at: 0.5, color: "#f0b429" },
  { at: 1, color: "#d9480f" },
] as const;

export const ZONE_COLOR = "#3b3fd1";

/** Ring around the user's usual station. */
export const HOME_COLOR = "#c2185b";

export interface Scale {
  min: number;
  max: number;
}

/** Colour domain: the lock prices reachable inside the circle. */
export function priceScale(infos: CellInfo[], reach: Reach[], radiusKm: number): Scale | null {
  let min = Infinity;
  let max = -Infinity;
  infos.forEach((info, i) => {
    if (info.price === null || reach[i].km > radiusKm) return;
    min = Math.min(min, info.price);
    max = Math.max(max, info.price);
  });
  return min <= max ? { min, max } : null;
}

export const levelOf = (price: number, scale: Scale) =>
  scale.max === scale.min ? 0.5 : Math.min(1, Math.max(0, (price - scale.min) / (scale.max - scale.min)));

export interface CellProps {
  /** 0 (cheapest) to 1 (dearest), or -1 when the cell has no price. */
  lv: number;
  /** 1 when the selected store's price is the lock price here. */
  sel: 0 | 1;
}

export function cellProps(infos: CellInfo[], scale: Scale | null, zone: StoreZone | null): CellProps[] {
  const locks = new Set(zone?.locks);
  return infos.map((info, i) => ({
    lv: info.price === null || !scale ? -1 : levelOf(info.price, scale),
    sel: locks.has(i) ? 1 : 0,
  }));
}

export interface StoreProps {
  /** Price label, only for priced stores inside the circle. */
  t?: string;
  /** Cents, used to let cheaper labels win collisions. */
  p?: number;
  /** 0 normal, 1 sets the best lock price in range, 2 selected. */
  sel: 0 | 1 | 2;
  /** 1 when priced (the feed knows the store and it sells this fuel). */
  ok: 0 | 1;
  /** 1 for the user's usual station. */
  home: 0 | 1;
}

export function storeProps(
  stores: Store[],
  view: PriceView,
  radiusKm: number,
  distKm: (s: Store) => number,
  bestSetters: number[],
  selected: number | null,
  home: number | null,
): StoreProps[] {
  const best = new Set(bestSetters);
  return stores.map((s, i) => {
    const p = view.price[i];
    const inRange = p !== undefined && distKm(s) <= radiusKm;
    return {
      ...(inRange ? { t: p!.toFixed(1), p: p! } : {}),
      sel: selected === i ? 2 : best.has(i) ? 1 : 0,
      ok: p === undefined ? 0 : 1,
      home: home === i ? 1 : 0,
    };
  });
}
