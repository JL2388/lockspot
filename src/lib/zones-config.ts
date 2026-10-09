import type { BBox } from "./orderk";

/** Stores that count towards a lock: the nearest K 7-Eleven stores to the phone. */
export const LOCK_K = 5;

/** Region the precomputed zones cover: NSW and ACT with a margin for neighbouring states. */
export const ZONE_BBOX: BBox = { south: -39.2, west: 140.0, north: -27.0, east: 154.5 };
