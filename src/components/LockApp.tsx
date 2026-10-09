"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { cellProps as buildCellProps, priceScale, storeProps as buildStoreProps } from "@/lib/display";
import { DEFAULT_FUEL, FUELS, fuelLabel, isFuelCode, type FuelCode } from "@/lib/fuel";
import { haversineKm, type LatLng } from "@/lib/geo";
import {
  analyseCells,
  bestInRange,
  cellHere,
  cellReach,
  nearestFive,
  nearestOf,
  rankStores,
  storeLabel,
  storeZone,
  viewPrices,
} from "@/lib/lock";
import { DEFAULT_LITRES, clampLitres } from "@/lib/savings";
import { clearSaved, loadSaved, saveSaved, type Place, type Saved } from "@/lib/storage";
import type { CellsFile, PricesPayload, Store, StoresFile } from "@/lib/types";
import MapView, { type InspectInfo } from "./MapView";
import Sidebar from "./Sidebar";

const SYDNEY: LatLng = { lat: -33.8688, lng: 151.2093 };
const PRICE_REFRESH_MS = 10 * 60 * 1000;
const MIN_STORES_PER_FUEL = 10;

interface Data {
  stores: StoresFile;
  cells: CellsFile;
  prices: PricesPayload;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as T;
}

export default function LockApp() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [center, setCenter] = useState<LatLng>(SYDNEY);
  const [place, setPlace] = useState<Place>({ label: "Sydney (default)", source: "default" });
  const [radius, setRadius] = useState(10);
  const [limit, setLimit] = useState(true);
  const [fuel, setFuel] = useState<FuelCode>(DEFAULT_FUEL);
  const [selected, setSelected] = useState<number | null>(null);
  const [homeIdx, setHomeIdx] = useState<number | null>(null);
  const [litres, setLitres] = useState(DEFAULT_LITRES);
  const [inspectPoint, setInspectPoint] = useState<LatLng | null>(null);
  const [view, setView] = useState<{ nonce: number; points: LatLng[] }>({ nonce: 0, points: [] });
  const [urlReady, setUrlReady] = useState(false);
  const [saveOk, setSaveOk] = useState(true);

  const persist = useCallback((patch: Saved) => setSaveOk(saveSaved(patch)), []);

  // Load the static zone data and the live prices, then restore state: the URL wins (so shared
  // links behave), then whatever this device saved last time, then defaults.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [stores, cells, prices] = await Promise.all([
          getJson<StoresFile>("/data/stores.json"),
          getJson<CellsFile>("/data/cells.json"),
          getJson<PricesPayload>("/api/prices"),
        ]);
        if (cancelled) return;
        if (cells.storesHash !== stores.hash) throw new Error("Zone data and store list are out of sync");
        setData({ stores, cells, prices });
        setError(null);

        const saved = loadSaved();
        const q = new URLSearchParams(window.location.search);

        const lat = Number(q.get("lat"));
        const lng = Number(q.get("lng"));
        let refreshFromGps = false;
        if (q.has("lat") && q.has("lng") && Number.isFinite(lat) && Number.isFinite(lng)) {
          setCenter({ lat, lng });
          setPlace({ label: "Shared location", source: "link" });
        } else if (saved.center) {
          setCenter({ lat: saved.center.lat, lng: saved.center.lng });
          setPlace({ label: saved.center.label, source: saved.center.source });
          refreshFromGps = saved.center.source === "gps";
        }

        const r = Number(q.get("r"));
        if (r >= 1 && r <= 100) setRadius(Math.round(r));
        else if (saved.radius) setRadius(saved.radius);

        if (q.has("c")) setLimit(q.get("c") !== "0");
        else if (saved.limit !== undefined) setLimit(saved.limit);

        const f = q.get("fuel") ?? saved.fuel;
        if (isFuelCode(f)) setFuel(f);

        if (saved.homeId) {
          const idx = stores.stores.findIndex((x) => x.id === saved.homeId);
          if (idx >= 0) setHomeIdx(idx);
        }
        if (saved.litres) setLitres(saved.litres);

        const s = q.get("s");
        if (s) {
          const idx = stores.stores.findIndex((x) => x.id === s);
          if (idx >= 0) setSelected(idx);
        }
        setView((v) => ({ nonce: v.nonce + 1, points: [] }));
        setUrlReady(true);

        // A returning GPS user: quietly update their position, but only if the browser has already
        // been granted permission, so we never pop a prompt on page load.
        if (refreshFromGps && "geolocation" in navigator && navigator.permissions) {
          navigator.permissions
            .query({ name: "geolocation" })
            .then((st) => {
              if (cancelled || st.state !== "granted") return;
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  if (cancelled) return;
                  const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                  setCenter(p);
                  setPlace({ label: "Your location", source: "gps" });
                  setSaveOk(saveSaved({ center: { ...p, label: "Your location", source: "gps" } }));
                  setView((v) => ({ nonce: v.nonce + 1, points: [] }));
                },
                () => {
                  /* keep the saved position */
                },
                { timeout: 8000, maximumAge: 5 * 60 * 1000 },
              );
            })
            .catch(() => {});
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong loading the data");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Prices change through the day; the server caches them, so polling is cheap.
  useEffect(() => {
    if (!data) return;
    const id = setInterval(async () => {
      try {
        const prices = await getJson<PricesPayload>("/api/prices");
        setData((d) => (d ? { ...d, prices } : d));
      } catch {
        /* keep showing the last prices */
      }
    }, PRICE_REFRESH_MS);
    return () => clearInterval(id);
  }, [data !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const stores: Store[] = useMemo(() => data?.stores.stores ?? [], [data?.stores]);
  const cells = useMemo(() => data?.cells.cells ?? [], [data?.cells]);

  useEffect(() => {
    if (!urlReady) return;
    const q = new URLSearchParams({
      lat: center.lat.toFixed(5),
      lng: center.lng.toFixed(5),
      r: String(radius),
      fuel,
    });
    // Always explicit, so a shared link behaves the same for someone with different saved settings.
    q.set("c", limit ? "1" : "0");
    if (selected !== null && stores[selected]) q.set("s", stores[selected].id);
    // Debounced: dragging the radius slider changes state on every tick, and browsers cap
    // history.replaceState() at about 100 calls per 10 seconds (Safari throws past that).
    const id = setTimeout(() => {
      const next = `?${q}`;
      if (next === window.location.search) return;
      try {
        window.history.replaceState(null, "", next);
      } catch {
        /* the shareable URL is a convenience; never break the app over it */
      }
    }, 400);
    return () => clearTimeout(id);
  }, [urlReady, center, radius, limit, fuel, selected, stores]);

  // Radius drags are deferred so heavy map updates never block the slider.
  const radiusD = useDeferredValue(radius);
  const reachKm = limit ? radiusD : Infinity;

  // Only offer fuels that enough 7-Eleven sites actually report (e.g. nearly all report premium
  // diesel as PDL, so a plain "Diesel" chip would be empty). The selected fuel always stays.
  const fuels = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of Object.values(data?.prices.prices ?? {})) {
      for (const code of Object.keys(row)) counts[code] = (counts[code] ?? 0) + 1;
    }
    return FUELS.filter((f) => (counts[f.code] ?? 0) >= MIN_STORES_PER_FUEL || f.code === fuel);
  }, [data?.prices, fuel]);

  const priceView = useMemo(() => viewPrices(stores, data?.prices.prices ?? {}, fuel), [stores, data?.prices, fuel]);
  const infos = useMemo(() => analyseCells(cells, priceView), [cells, priceView]);
  const reach = useMemo(() => cellReach(center, cells), [center, cells]);

  const choice = useMemo(() => bestInRange(infos, reach, reachKm), [infos, reach, reachKm]);
  const rows = useMemo(() => rankStores(infos, reach, reachKm), [infos, reach, reachKm]);
  const scale = useMemo(() => priceScale(infos, reach, reachKm), [infos, reach, reachKm]);
  const hereIdx = useMemo(() => cellHere(reach), [reach]);
  const here = hereIdx >= 0 ? infos[hereIdx] : null;

  const zone = useMemo(() => (selected === null ? null : storeZone(selected, cells, infos)), [selected, cells, infos]);
  const zoneNearest = useMemo(() => (zone ? (nearestOf(zone.locks, reach)?.reach ?? null) : null), [zone, reach]);

  const home = useMemo(
    () => (homeIdx !== null && stores[homeIdx] ? { index: homeIdx, price: priceView.price[homeIdx] } : null),
    [homeIdx, stores, priceView],
  );

  const cellProps = useMemo(() => buildCellProps(infos, scale, zone), [infos, scale, zone]);
  const storeProps = useMemo(
    () =>
      buildStoreProps(
        stores,
        priceView,
        reachKm,
        (s) => haversineKm(center, s),
        choice?.setters ?? [],
        selected,
        homeIdx,
      ),
    [stores, priceView, reachKm, center, choice, selected, homeIdx],
  );

  const target: LatLng | null = useMemo(() => {
    if (selected !== null) return zoneNearest && zoneNearest.km > 0 ? zoneNearest.spot : null;
    return choice && choice.km > 0 ? choice.spot : null;
  }, [selected, zoneNearest, choice]);

  const inspect: InspectInfo | null = useMemo(() => {
    if (!inspectPoint) return null;
    const five = nearestFive(inspectPoint, stores);
    const prices = five.map((f) => priceView.price[f.store]);
    const known = prices.filter((p): p is number => p !== undefined);
    const lock = known.length ? Math.min(...known) : null;
    return {
      point: inspectPoint,
      fuel: fuelLabel(fuel),
      rows: five.map((f, i) => ({
        label: storeLabel(stores[f.store]),
        km: f.km,
        price: prices[i],
        cheapest: lock !== null && prices[i] === lock,
      })),
      lockPrice: lock,
      uncertain: five.some((f) => !priceView.known[f.store]),
    };
  }, [inspectPoint, stores, priceView, fuel]);

  const moveTo = useCallback(
    (p: LatLng, label: string, source: "gps" | "search" | "map") => {
      setCenter(p);
      setPlace({ label, source });
      setInspectPoint(null);
      setView((v) => ({ nonce: v.nonce + 1, points: [] }));
      persist({ center: { lat: p.lat, lng: p.lng, label, source } });
    },
    [persist],
  );

  const select = useCallback(
    (i: number | null) => {
      setSelected(i);
      setInspectPoint(null);
      if (i === null) {
        // Back to the overview: frame the search circle again.
        setView((v) => ({ nonce: v.nonce + 1, points: [] }));
        return;
      }
      const z = storeZone(i, cells, infos);
      const near = nearestOf(z.locks, reach);
      // Frame you, the spot to stand at, and the store itself so the zone around it is in view.
      const store = stores[i];
      setView((v) => ({
        nonce: v.nonce + 1,
        points: near && near.reach.km > 0 ? [center, near.reach.spot, store] : [store],
      }));
    },
    [cells, infos, reach, center, stores],
  );

  const toggle = useCallback((i: number) => select(i === selected ? null : i), [select, selected]);

  const chooseFuel = useCallback(
    (f: FuelCode) => {
      setFuel(f);
      persist({ fuel: f });
    },
    [persist],
  );

  const chooseRadius = useCallback(
    (km: number) => {
      setRadius(km);
      persist({ radius: km });
    },
    [persist],
  );

  const chooseLimit = useCallback(
    (on: boolean) => {
      setLimit(on);
      persist({ limit: on });
      if (on) setView((v) => ({ nonce: v.nonce + 1, points: [] }));
    },
    [persist],
  );

  const chooseHome = useCallback(
    (i: number | null) => {
      setHomeIdx(i);
      persist({ homeId: i === null ? null : stores[i]?.id });
    },
    [persist, stores],
  );

  const chooseLitres = useCallback(
    (n: number) => {
      const v = clampLitres(n);
      setLitres(v);
      persist({ litres: v });
    },
    [persist],
  );

  const forget = useCallback(() => {
    clearSaved();
    setHomeIdx(null);
    setLitres(DEFAULT_LITRES);
    setPlace((p) => ({ ...p, source: "default" }));
    setSaveOk(true);
  }, []);

  // Escape leaves the selected-station view.
  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, select]);

  if (error) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-medium">Couldn&apos;t load the map data.</p>
        <p className="max-w-md text-sm text-muted">{error}</p>
        <button
          type="button"
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted" role="status">
        Loading zones…
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <main className="relative h-[46dvh] shrink-0 md:order-2 md:h-auto md:flex-1">
        <MapView
          stores={stores}
          cells={cells}
          cellProps={cellProps}
          storeProps={storeProps}
          center={center}
          radiusKm={radius}
          showRing={limit}
          target={target}
          view={view}
          inspect={inspect}
          onSelectStore={toggle}
          onInspect={setInspectPoint}
          onCloseInspect={() => setInspectPoint(null)}
          onUseInspected={() => inspectPoint && moveTo(inspectPoint, "Pinned on map", "map")}
        />
        {selected !== null && stores[selected] && (
          <button
            type="button"
            onClick={() => select(null)}
            className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-line bg-white py-2 pl-4 pr-3 text-sm font-medium shadow-md hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span>
              Showing zone for <strong>{storeLabel(stores[selected])}</strong>
            </span>
            <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs text-white">Show all ✕</span>
          </button>
        )}
      </main>
      <aside className="flex min-h-0 flex-1 flex-col bg-panel md:order-1 md:w-[400px] md:flex-none md:border-r md:border-line">
        <Sidebar
          fuel={fuel}
          fuels={fuels}
          onFuel={chooseFuel}
          radius={radius}
          onRadius={chooseRadius}
          onRadiusCommit={() => setView((v) => ({ nonce: v.nonce + 1, points: [] }))}
          limit={limit}
          onLimit={chooseLimit}
          center={center}
          place={place}
          saved={saveOk && (place.source === "gps" || place.source === "search" || place.source === "map")}
          onCenter={moveTo}
          onForget={forget}
          stores={stores}
          priceView={priceView}
          scale={scale}
          choice={choice}
          here={here}
          rows={rows}
          selected={selected}
          zone={zone}
          zoneNearest={zoneNearest}
          onSelect={select}
          home={home}
          onHome={chooseHome}
          litres={litres}
          onLitres={chooseLitres}
          demo={data.prices.demo}
          updatedAt={data.prices.updatedAt}
          zonesBuiltAt={data.cells.generatedAt}
        />
      </aside>
    </div>
  );
}
