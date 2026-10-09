# Lock Spot

Finds where to stand so the cheapest 7-Eleven fuel price is one of your five closest stores, so you can lock it in with the 7-Eleven Fuel Lock. Unofficial; not affiliated with 7-Eleven.

## How the lock works

From [7-Eleven's terms](https://www.7eleven.com.au/fuel-price-lock-terms): the locked price is the cheapest price among the **five 7-Eleven stores closest to your phone**. It lasts 7 days, covers up to 150 L, takes at most 25¢/L off the pump price, and is redeemable at any 7-Eleven. So the trick is to be somewhere that puts a cheap store in your closest five at the moment you lock.

## How it works

- **Zones are precomputed.** The area where a given set of five stores are your closest five is an exact convex polygon (an order-5 Voronoi cell). `npm run build:data` computes all of them from the store locations (`src/lib/orderk.ts`) and writes `public/data/cells.json`. Zones depend only on where stores are, not on prices, so this only reruns when the store list changes (a weekly workflow checks).
- **Prices are applied at runtime.** `/api/prices` serves the latest prices (cached 30 minutes). For any cell, the lock price is the cheapest of its five stores. A store's "price zone" is the set of cells where it is that cheapest store; selecting a store highlights that zone and leaves the rest of the map coloured by the cheapest lock at each point.
- **Distances are straight-line** (great-circle). That is an assumption about how the app measures "closest"; check it against the app before relying on edge cases.

## Remembered on each device

The app stores these in the browser's `localStorage` (key `lockspot:v1`), never on a server, so a return visit starts where you left off:

- your location (searched, GPS or pinned on the map). If you last used GPS and the browser has already granted permission, it quietly refreshes your position on load; it never prompts on its own;
- fuel type, search radius, and whether the circle is switched on;
- your usual station and fill size, which drive the estimated savings: pump price there minus the lock price, capped at 25¢/L and 150 L.

A link with `lat`/`lng`/`r`/`fuel`/`c` in the URL takes priority over saved settings and doesn't overwrite them. "Forget what's saved" clears everything.

## Setup

```bash
npm install
npm run dev
```

Without an API key the app serves **demo prices** (the zones are real, the prices are not).

For live NSW prices, register for the [NSW FuelCheck API](https://api.nsw.gov.au/Product/Index/22) (free tier: 2,500 calls/month; the 30-minute cache uses about 1,500) and put the key and secret in `.env.local` (see `.env.example`). The FuelCheck client is in `src/lib/fuelcheck.ts`. Fuel chips only appear for fuels that at least 10 stores report; 7-Eleven sites report diesel almost entirely as premium diesel (`PDL`).

With the keys set, run `npm run build:data -- --force` once so NSW stores are matched to FuelCheck station codes.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build:data` | Rebuild `public/data/*` if the store list changed (`-- --force` to always, `-- --cached` to reuse the last OpenStreetMap download) |
| `npm run verify:data` | Check 6,000 random points against brute-force nearest-five |
| `npm test` | Unit tests |

## Limits

- Store locations come from OpenStreetMap, which may miss or mislabel some sites. With FuelCheck keys, NSW stores are taken from FuelCheck instead.
- Zones cover NSW and ACT plus a margin (`src/lib/zones-config.ts`). Interstate stores count as neighbours near the border, but have no price data, so those cells are flagged "may be lower".
