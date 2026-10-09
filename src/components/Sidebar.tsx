"use client";

import { useState, type FormEvent } from "react";
import { HOME_COLOR, RAMP, ZONE_COLOR, type Scale } from "@/lib/display";
import { fuelLabel, type FUELS, type FuelCode } from "@/lib/fuel";
import type { LatLng } from "@/lib/geo";
import {
  mapsLinks,
  storeLabel,
  type Choice,
  type CellInfo,
  type PriceView,
  type Reach,
  type StoreRow,
  type StoreZone,
} from "@/lib/lock";
import { DISCOUNT_CAP_CENTS, MAX_LITRES, estimateSaving, type Saving } from "@/lib/savings";
import type { Place } from "@/lib/storage";
import type { Store } from "@/lib/types";

export interface SidebarProps {
  fuel: FuelCode;
  fuels: readonly (typeof FUELS)[number][];
  onFuel: (f: FuelCode) => void;
  radius: number;
  onRadius: (km: number) => void;
  onRadiusCommit: () => void;
  /** When off, the circle is ignored and the whole map is considered. */
  limit: boolean;
  onLimit: (on: boolean) => void;
  center: LatLng;
  place: Place;
  /** The current location is stored on this device for next time. */
  saved: boolean;
  onCenter: (p: LatLng, label: string, source: "gps" | "search" | "map") => void;
  onForget: () => void;
  stores: Store[];
  priceView: PriceView;
  scale: Scale | null;
  choice: Choice | null;
  here: CellInfo | null;
  rows: StoreRow[];
  selected: number | null;
  zone: StoreZone | null;
  zoneNearest: Reach | null;
  onSelect: (i: number | null) => void;
  /** The user's usual station, whose pump price a lock is redeemed against. */
  home: { index: number; price: number | undefined } | null;
  onHome: (i: number | null) => void;
  litres: number;
  onLitres: (n: number) => void;
  demo: boolean;
  updatedAt: string;
  zonesBuiltAt: string;
}

const cents = (n: number) => `${n.toFixed(1)}¢`;
const km = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toString());
const area = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toString());

const secondaryButton =
  "rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent";

function Section({
  title,
  action,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line px-5 py-4">
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 rounded-full text-xs font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span>{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-accent" : "bg-[#b9c2c9]"}`}>
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

function Directions({ to }: { to: LatLng }) {
  const links = mapsLinks(to);
  return (
    <>
      <a className={secondaryButton} href={links.google} target="_blank" rel="noreferrer">
        Google Maps
      </a>
      <a className={secondaryButton} href={links.apple} target="_blank" rel="noreferrer">
        Apple Maps
      </a>
    </>
  );
}

function LocationSearch({ onCenter }: { onCenter: SidebarProps["onCenter"] }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [results, setResults] = useState<{ label: string; lat: number; lng: number }[]>([]);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { results: typeof results };
      setResults(body.results);
      if (!body.results.length) setMsg("No matches in Australia. Try a suburb or postcode.");
    } catch {
      setMsg("Search is unavailable right now. You can also click the map.");
    } finally {
      setBusy(false);
    }
  }

  function locate() {
    if (!navigator.geolocation) return setMsg("Your browser can't share its location.");
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => onCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }, "Your location", "gps"),
      () => setMsg("Couldn't get your location. Search for a suburb or click the map."),
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  return (
    <div>
      <form onSubmit={search} className="flex gap-2" role="search">
        <label className="sr-only" htmlFor="place">
          Suburb, postcode or address
        </label>
        <input
          id="place"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suburb, postcode or address"
          className="min-w-0 flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {busy ? "…" : "Search"}
        </button>
      </form>
      <button
        type="button"
        onClick={locate}
        className="mt-2 text-sm font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        Use my current location
      </button>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      {results.length > 0 && (
        <ul className="mt-2 overflow-hidden rounded-md border border-line">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`} className="border-b border-line last:border-b-0">
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => {
                  const label = r.label.split(",").slice(0, 2).join(",").trim();
                  onCenter({ lat: r.lat, lng: r.lng }, label, "search");
                  setResults([]);
                  setQ(label);
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Legend({ scale }: { scale: Scale | null }) {
  if (!scale) return null;
  const gradient = `linear-gradient(90deg, ${RAMP.map((r) => `${r.color} ${r.at * 100}%`).join(", ")})`;
  return (
    <div className="mt-3">
      <div className="h-2.5 rounded-full" style={{ background: gradient }} aria-hidden />
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>{cents(scale.min)} cheapest lock</span>
        <span>{cents(scale.max)}</span>
      </div>
      <p className="mt-1 text-xs text-muted">Each colour is the cheapest price you&apos;d lock standing there.</p>
    </div>
  );
}

function LitresInput({ litres, onLitres }: { litres: number; onLitres: (n: number) => void }) {
  // While typing, show exactly what was typed (so the field can be emptied and retyped).
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="mt-3 flex items-center justify-between gap-3 text-sm">
      <span>
        Fill size
        <span className="block text-xs text-muted">A lock covers up to {MAX_LITRES} L</span>
      </span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_LITRES}
          value={draft ?? String(litres)}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 1) onLitres(n);
          }}
          onBlur={() => setDraft(null)}
          className="w-20 rounded-md border border-line bg-white px-2 py-1.5 text-right tabular-nums focus-visible:outline-2 focus-visible:outline-accent"
        />
        <span className="text-muted">L</span>
      </span>
    </label>
  );
}

function HomeStation(p: SidebarProps) {
  const { home, stores, fuel } = p;
  const store = home ? stores[home.index] : null;
  return (
    <Section title="Your usual station">
      {home && store ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold">
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-full border-[3px] bg-white"
                style={{ borderColor: HOME_COLOR }}
                aria-hidden
              />
              <span className="truncate">7-Eleven {storeLabel(store)}</span>
            </div>
            <div className="text-sm text-muted">
              {home.price !== undefined ? `Pump ${cents(home.price)} for ${fuelLabel(fuel)}` : `No ${fuelLabel(fuel)} price`}
            </div>
          </div>
          <button type="button" onClick={() => p.onHome(null)} className={`${secondaryButton} shrink-0 py-1 text-xs`}>
            Remove
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Pick the 7-Eleven you usually fill up at and we&apos;ll estimate what each lock saves you there. Click a station
          on the map or in the list, then choose <strong className="text-ink">Set as my station</strong>.
        </p>
      )}
      <LitresInput litres={p.litres} onLitres={p.onLitres} />
    </Section>
  );
}

function savingLine(s: Saving, litres: number) {
  if (s.perLitre === 0) return <>nothing: the pump there is already at or below this price.</>;
  return (
    <>
      <strong className="text-ink">{s.perLitre.toFixed(1)}¢/L</strong>, about{" "}
      <strong className="text-ink">${s.total.toFixed(2)}</strong> on {litres} L
      {s.capped && <span className="text-muted"> (capped at {DISCOUNT_CAP_CENTS}¢/L)</span>}.
    </>
  );
}

function Summary(p: SidebarProps) {
  const { choice, here, limit, radius, stores, fuel, home } = p;
  if (!choice) {
    return (
      <p className="text-sm text-muted">
        No {fuelLabel(fuel)} lock prices {limit ? `within ${radius} km. Widen the circle or move it.` : "available."}
      </p>
    );
  }
  const setter = stores[choice.setters[0]];
  const relative = here?.price != null ? here.price - choice.price : 0;
  const homeStore = home ? stores[home.index] : null;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-semibold tabular-nums tracking-tight">{choice.price.toFixed(1)}</span>
        <span className="text-lg text-muted">¢/L</span>
        <span className="text-sm text-muted">best {fuelLabel(fuel)} lock</span>
      </div>
      <p className="mt-2 text-sm">
        {choice.km === 0 ? (
          <>You&apos;re already standing in the cheapest zone.</>
        ) : (
          <>
            Be at the <strong>amber marker</strong>, {km(choice.km)} km away, when you lock.
          </>
        )}{" "}
        Set by 7-Eleven <strong>{storeLabel(setter)}</strong>
        {choice.setters.length > 1 && ` and ${choice.setters.length - 1} tied`}.
      </p>

      {home && homeStore ? (
        <p className="mt-2 text-sm text-muted">
          {home.price === undefined ? (
            <>7-Eleven {storeLabel(homeStore)} has no {fuelLabel(fuel)} price, so we can&apos;t estimate your saving.</>
          ) : (
            <>
              Redeemed at {storeLabel(homeStore)} (pump {cents(home.price)}), this saves{" "}
              {savingLine(estimateSaving(home.price, choice.price, p.litres), p.litres)}
            </>
          )}
        </p>
      ) : (
        <>
          {relative > 0.05 && here?.price != null && (
            <p className="mt-2 text-sm text-muted">
              Locking where you are gives {cents(here.price)}, so this is{" "}
              <strong className="text-ink">{relative.toFixed(1)}¢/L</strong> cheaper.
            </p>
          )}
          <p className="mt-2 text-xs text-muted">Set your usual station below to see what a lock would actually save you.</p>
        </>
      )}

      {choice.uncertain && (
        <p className="mt-2 rounded-md bg-[#fff6e0] px-3 py-2 text-sm text-[#6b4a00]">
          Some of the five stores here have no price data (likely interstate), so the real lock could be lower.
        </p>
      )}
      {choice.km > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Directions to={choice.spot} />
          {p.selected !== choice.setters[0] && (
            <button type="button" onClick={() => p.onSelect(choice.setters[0])} className={secondaryButton}>
              Show its zone
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SelectedStore(p: SidebarProps) {
  const { selected, zone, zoneNearest, stores, priceView, radius, limit, fuel, home } = p;
  if (selected === null || !zone) return null;
  const store = stores[selected];
  const price = priceView.price[selected];
  const canLock = zone.locks.length > 0;
  const isHome = home?.index === selected;

  return (
    <Section
      title="Where to stand"
      action={
        <button
          type="button"
          onClick={() => p.onSelect(null)}
          className="rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent"
        >
          Show all zones ✕
        </button>
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">7-Eleven {storeLabel(store)}</div>
          {store.addr && <div className="text-sm text-muted">{store.addr}</div>}
        </div>
        <div className="text-right">
          {price !== undefined ? (
            <div className="text-xl font-semibold tabular-nums">{price.toFixed(1)}¢</div>
          ) : (
            <div className="text-sm text-muted">No {fuelLabel(fuel)} price</div>
          )}
        </div>
      </div>

      <p className="mt-3 flex gap-2 text-sm">
        {canLock ? (
          <>
            <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: ZONE_COLOR }} />
            <span>
              <strong>Purple zone</strong> ({area(zone.areaKm2)} km²): stand here and its price is your lock price.
              Everywhere else, the colours show the cheapest lock at that point.
            </span>
          </>
        ) : (
          <span>
            <strong>It never sets the lock price.</strong> Wherever it&apos;s one of your five closest, a cheaper
            7-Eleven is too, so you can&apos;t lock this price.
          </span>
        )}
      </p>

      {canLock && zoneNearest && (
        <p className="mt-3 text-sm">
          {zoneNearest.km === 0 ? (
            <>You&apos;re inside it now.</>
          ) : (
            <>
              Nearest point: <strong>{km(zoneNearest.km)} km</strong> away
              {limit && zoneNearest.km > radius && <span className="text-muted"> (outside your circle)</span>}.
            </>
          )}
        </p>
      )}
      {canLock && price !== undefined && home?.price !== undefined && !isHome && (
        <p className="mt-2 text-sm text-muted">
          Locked at this price and redeemed at your station, you&apos;d save{" "}
          {savingLine(estimateSaving(home.price, price, p.litres), p.litres)}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canLock && zoneNearest && zoneNearest.km > 0 && <Directions to={zoneNearest.spot} />}
        <button
          type="button"
          onClick={() => p.onHome(isHome ? null : selected)}
          aria-pressed={isHome}
          className={secondaryButton}
        >
          {isHome ? "✓ My station · remove" : "Set as my station"}
        </button>
      </div>
    </Section>
  );
}

function StoreList(p: SidebarProps) {
  const [all, setAll] = useState(false);
  const rows = all ? p.rows : p.rows.slice(0, 10);
  if (!p.rows.length) return null;
  const homePrice = p.home?.price;
  return (
    <Section title={`Prices you can lock · ${p.rows.length}`}>
      <ol className="-mx-2">
        {rows.map((r) => {
          const s = p.stores[r.store];
          const active = p.selected === r.store;
          const est = homePrice !== undefined ? estimateSaving(homePrice, r.price, p.litres) : null;
          return (
            <li key={r.store}>
              <button
                type="button"
                onClick={() => p.onSelect(active ? null : r.store)}
                aria-pressed={active}
                className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent ${active ? "bg-wash" : ""}`}
              >
                <span className="w-16 shrink-0 text-lg font-semibold tabular-nums">{r.price.toFixed(1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{storeLabel(s)}</span>
                  <span className="block text-xs text-muted">
                    {r.km === 0 ? "You're in its zone" : `Zone ${km(r.km)} km away`}
                    {r.uncertain && " · may be lower"}
                  </span>
                </span>
                {est && (
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted">
                    {est.perLitre > 0 ? (
                      <>
                        <span className="block font-medium text-ink">saves ${est.total.toFixed(2)}</span>
                        <span className="block">{est.perLitre.toFixed(1)}¢/L</span>
                      </>
                    ) : (
                      "no saving"
                    )}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {p.rows.length > 10 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="mt-1 text-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {all ? "Show fewer" : `Show all ${p.rows.length}`}
        </button>
      )}
    </Section>
  );
}

/** Phones show the map above the panel, so keep the answer pinned where it can't scroll away. */
function ResultBar({ choice, fuel, saving }: Pick<SidebarProps, "choice" | "fuel"> & { saving: Saving | null }) {
  if (!choice) return null;
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-white px-5 py-2.5 md:hidden">
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tabular-nums">{choice.price.toFixed(1)}</span>
          <span className="text-sm text-muted">¢/L {fuelLabel(fuel)} lock</span>
        </div>
        <div className="text-xs text-muted">
          {choice.km === 0 ? "You're in the cheapest zone" : `Amber marker, ${km(choice.km)} km away`}
          {saving && saving.perLitre > 0 && <> · saves ${saving.total.toFixed(2)}</>}
        </div>
      </div>
      {choice.km > 0 && (
        <a
          className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white"
          href={mapsLinks(choice.spot).google}
          target="_blank"
          rel="noreferrer"
        >
          Directions
        </a>
      )}
    </div>
  );
}

export default function Sidebar(p: SidebarProps) {
  const saving =
    p.choice && p.home?.price !== undefined ? estimateSaving(p.home.price, p.choice.price, p.litres) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <ResultBar choice={p.choice} fuel={p.fuel} saving={saving} />
      <header className="border-b border-line px-5 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Lock Spot</h1>
        <p className="text-sm text-muted">Where to stand to lock the cheapest 7-Eleven fuel price.</p>
      </header>

      {p.demo && (
        <div className="border-b border-[#f0d9a0] bg-[#fff6e0] px-5 py-2.5 text-sm text-[#6b4a00]">
          <strong>Demo prices.</strong> The zones are real; the prices are made up until a FuelCheck API key is added.
        </div>
      )}

      <Section title="Where are you?">
        <LocationSearch onCenter={p.onCenter} />
        <p className="mt-3 text-sm">
          Using <strong>{p.place.label}</strong>
          {p.saved && <span className="text-muted"> · saved on this device</span>}
        </p>
        <p className="mt-1 text-xs text-muted">
          {p.saved || p.home
            ? "Your location and settings stay in this browser; we don't send them anywhere."
            : "We'll remember where you are on this device for next time."}{" "}
          Or click the map to see which five stores you&apos;d get there.
        </p>
        {(p.saved || p.home) && (
          <button
            type="button"
            onClick={p.onForget}
            className="mt-1 text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Forget what&apos;s saved
          </button>
        )}
      </Section>

      <Section title="Fuel">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Fuel type">
          {p.fuels.map((f) => (
            <button
              key={f.code}
              type="button"
              role="radio"
              aria-checked={p.fuel === f.code}
              onClick={() => p.onFuel(f.code)}
              className={`rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                p.fuel === f.code ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-wash"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="How far will you drive?"
        action={<Switch checked={p.limit} onChange={p.onLimit} label="Limit to circle" />}
      >
        <div className={`flex items-center gap-3 ${p.limit ? "" : "opacity-45"}`}>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={p.radius}
            disabled={!p.limit}
            aria-label="Search radius in kilometres"
            onChange={(e) => p.onRadius(Number(e.target.value))}
            onPointerUp={p.onRadiusCommit}
            onKeyUp={p.onRadiusCommit}
            className="h-2 flex-1 accent-accent"
          />
          <output className="w-14 text-right text-sm font-medium tabular-nums">{p.radius} km</output>
        </div>
        {!p.limit && (
          <p className="mt-2 text-xs text-muted">No circle: showing the cheapest lock anywhere on the map.</p>
        )}
      </Section>

      <HomeStation {...p} />

      <SelectedStore {...p} />

      <Section title={p.limit ? "Best lock in range" : "Best lock anywhere"}>
        <Summary {...p} />
        <Legend scale={p.scale} />
      </Section>

      <StoreList {...p} />

      <footer className="mt-auto px-5 py-4 text-xs leading-relaxed text-muted">
        <p>
          A lock uses the cheapest price among the five 7-Eleven stores nearest your phone, lasts 7 days, covers up to{" "}
          {MAX_LITRES} L, and takes at most {DISCOUNT_CAP_CENTS}¢/L off the pump price. Always confirm the price in the
          7-Eleven app before locking. Distances here are straight-line; that&apos;s our assumption about how the app
          measures them.
        </p>
        <p className="mt-2">
          {p.demo
            ? "Demo prices."
            : `Prices from NSW FuelCheck, updated ${new Date(p.updatedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}.`}{" "}
          Zones built{" "}
          {new Date(p.zonesBuiltAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}.
          Unofficial: not affiliated with 7-Eleven.
        </p>
      </footer>
    </div>
  );
}
