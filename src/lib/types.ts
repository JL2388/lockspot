import type { BBox } from "./orderk";

export interface Store {
  /** Stable id: `fc-<FuelCheck code>` when matched to NSW FuelCheck, else `osm-<type><osm id>`. */
  id: string;
  lat: number;
  lng: number;
  /** Suburb or town, when known. */
  loc?: string;
  addr?: string;
  /** NSW FuelCheck station code, used to attach live prices. */
  fc?: string;
}

export interface StoresFile {
  hash: string;
  generatedAt: string;
  stores: Store[];
}

export interface CellsFile {
  k: number;
  bbox: BBox;
  /** Must equal StoresFile.hash: cell member indexes point into that exact store list. */
  storesHash: string;
  generatedAt: string;
  /** m: indexes into stores; r: flat [lng, lat, ...] ring. */
  cells: { m: number[]; r: number[] }[];
}

/** Prices in cents per litre. A store missing from the table has no price data at all. */
export type PriceTable = Record<string, Partial<Record<string, number>>>;

export interface PricesPayload {
  demo: boolean;
  /** The upstream feed failed, so these are older than usual. */
  stale?: boolean;
  updatedAt: string;
  prices: PriceTable;
}
