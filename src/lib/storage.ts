// Per-device preferences, so a returning visitor doesn't have to set everything up again.
// Stored in localStorage only; nothing here is sent to a server.

import { clampLitres } from "./savings";

export type PlaceSource = "default" | "link" | "gps" | "search" | "map";

/** Where the user is, and how we know. Only gps/search/map places are saved. */
export interface Place {
  label: string;
  source: PlaceSource;
}

export interface SavedCenter {
  lat: number;
  lng: number;
  label: string;
  source: "gps" | "search" | "map";
}

export interface Saved {
  center?: SavedCenter;
  radius?: number;
  /** Whether the search circle limits results. */
  limit?: boolean;
  fuel?: string;
  /** Id of the user's usual 7-Eleven, for savings estimates. */
  homeId?: string | null;
  litres?: number;
}

const KEY = "lockspot:v1";
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Reads and validates saved preferences; anything missing or malformed is dropped. */
export function loadSaved(): Saved {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const j = JSON.parse(raw) as Record<string, unknown>;
    const out: Saved = {};
    const c = j.center as Record<string, unknown> | null | undefined;
    if (
      c &&
      finite(c.lat) &&
      finite(c.lng) &&
      Math.abs(c.lat) <= 90 &&
      Math.abs(c.lng) <= 180 &&
      typeof c.label === "string" &&
      (c.source === "gps" || c.source === "search" || c.source === "map")
    ) {
      out.center = { lat: c.lat, lng: c.lng, label: c.label.slice(0, 120), source: c.source };
    }
    if (finite(j.radius) && j.radius >= 1 && j.radius <= 100) out.radius = Math.round(j.radius);
    if (typeof j.limit === "boolean") out.limit = j.limit;
    if (typeof j.fuel === "string") out.fuel = j.fuel;
    if (typeof j.homeId === "string") out.homeId = j.homeId;
    if (finite(j.litres)) out.litres = clampLitres(j.litres);
    return out;
  } catch {
    return {};
  }
}

/** Merges `patch` into the stored preferences. Returns false if the browser won't let us store. */
export function saveSaved(patch: Saved): boolean {
  try {
    const next: Saved = { ...loadSaved(), ...patch };
    if (next.homeId == null) delete next.homeId;
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function clearSaved(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
