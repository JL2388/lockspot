// Cloudflare Pages Function: GET /api/prices
//
// Serves 7-Eleven fuel prices to the app. FuelCheck's free tier allows 2,500 calls a month, so the
// result is cached in KV (shared by every edge location, unlike the per-location Cache API) and
// refreshed at most every 30 minutes. Without API keys it serves demo prices.

import storesFile from "../../public/data/stores.json";
import { fetchFuelCheck, type TokenStore } from "../../src/lib/fuelcheck";
import { demoTable, liveTable } from "../../src/lib/prices";
import type { PricesPayload, StoresFile } from "../../src/lib/types";

interface Env {
  NSW_FUEL_API_KEY?: string;
  NSW_FUEL_API_SECRET?: string;
  /** KV namespace for the shared cache. Optional: without it each instance caches in memory. */
  PRICES?: KVNamespace;
}

interface Stored {
  fetchedAt: number;
  payload: PricesPayload;
}

const stores = (storesFile as StoresFile).stores;
const FRESH_MS = 30 * 60_000;
const STALE_MS = 24 * 60 * 60_000;
const CACHE_KEY = "prices:v1";
const LOCK_KEY = "prices:refreshing";
const TOKEN_KEY = "fuelcheck:token";

let memory: Stored | null = null;

const json = (body: unknown, status = 200, maxAge = 300) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });

const kvTokenStore = (kv: KVNamespace): TokenStore => ({
  get: () => kv.get(TOKEN_KEY),
  // KV needs a TTL of at least 60 seconds.
  set: (token, ttlSeconds) => kv.put(TOKEN_KEY, token, { expirationTtl: Math.max(60, ttlSeconds) }),
});

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { NSW_FUEL_API_KEY: key, NSW_FUEL_API_SECRET: secret, PRICES: kv } = env;
  if (!key || !secret) {
    return json({ demo: true, updatedAt: new Date().toISOString(), prices: demoTable(stores) }, 200, 300);
  }

  const now = Date.now();
  if (memory && now - memory.fetchedAt < FRESH_MS) return json(memory.payload);

  const cached = memory ?? (kv ? await kv.get<Stored>(CACHE_KEY, "json") : null);
  const age = cached ? now - cached.fetchedAt : Infinity;
  if (cached && age < FRESH_MS) {
    memory = cached;
    return json(cached.payload);
  }

  // Someone else is already refreshing: serve what we have instead of calling FuelCheck again.
  if (kv && cached && (await kv.get(LOCK_KEY))) return json(cached.payload);

  try {
    await kv?.put(LOCK_KEY, "1", { expirationTtl: 60 });
    const { prices } = await fetchFuelCheck(key, secret, kv ? kvTokenStore(kv) : undefined);
    const payload: PricesPayload = {
      demo: false,
      updatedAt: new Date().toISOString(),
      prices: liveTable(stores, prices),
    };
    memory = { fetchedAt: Date.now(), payload };
    await kv?.put(CACHE_KEY, JSON.stringify(memory), { expirationTtl: 24 * 60 * 60 });
    return json(payload);
  } catch (e) {
    console.error("FuelCheck refresh failed", e);
    if (cached && age < STALE_MS) return json({ ...cached.payload, stale: true }, 200, 60);
    return json({ error: "Price feed unavailable" }, 502, 0);
  }
};
