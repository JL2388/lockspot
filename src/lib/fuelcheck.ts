// Minimal NSW FuelCheck client (https://api.nsw.gov.au/Product/Index/22).
// Written against the public docs and community clients; not yet exercised against the live API.

const BASE = "https://api.onegov.nsw.gov.au";

export interface FuelCheckStation {
  code: string;
  brand: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface FuelCheckPrice {
  stationcode: string;
  fueltype: string;
  /** Cents per litre. */
  price: number;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(key: string, secret: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(`${BASE}/oauth/client_credential/accesstoken?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FuelCheck auth failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in?: string | number };
  const ttl = Number(body.expires_in ?? 43_000);
  cachedToken = { value: body.access_token, expiresAt: Date.now() + ttl * 1000 };
  return body.access_token;
}

/** FuelCheck wants dd/MM/yyyy hh:mm:ss AM/PM in Sydney time. */
function requestTimestamp(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second} ${String(p.dayPeriod).toUpperCase()}`;
}

export async function fetchFuelCheck(
  key: string,
  secret: string,
): Promise<{ stations: FuelCheckStation[]; prices: FuelCheckPrice[] }> {
  const token = await getToken(key, secret);
  const res = await fetch(`${BASE}/FuelPriceCheck/v1/fuel/prices`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: key,
      transactionid: crypto.randomUUID(),
      requesttimestamp: requestTimestamp(),
      "Content-Type": "application/json; charset=utf-8",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FuelCheck prices failed: ${res.status}`);

  const body = (await res.json()) as {
    stations?: {
      code?: string | number;
      stationid?: string | number;
      brand?: string;
      name?: string;
      address?: string;
      location?: { latitude?: number; longitude?: number };
    }[];
    prices?: { stationcode?: string | number; fueltype?: string; price?: number }[];
  };

  const stations: FuelCheckStation[] = (body.stations ?? []).flatMap((s) => {
    const code = s.code ?? s.stationid;
    const lat = s.location?.latitude;
    const lng = s.location?.longitude;
    if (code == null || lat == null || lng == null) return [];
    return [{ code: String(code), brand: s.brand ?? "", name: s.name ?? "", address: s.address ?? "", lat, lng }];
  });
  const prices: FuelCheckPrice[] = (body.prices ?? []).flatMap((p) =>
    p.stationcode == null || !p.fueltype || typeof p.price !== "number"
      ? []
      : [{ stationcode: String(p.stationcode), fueltype: p.fueltype, price: p.price }],
  );

  const known = new Set(stations.map((s) => s.code));
  if (!stations.length || !prices.some((p) => known.has(p.stationcode))) {
    throw new Error("FuelCheck response had an unexpected shape (no prices matched any station code)");
  }
  return { stations, prices };
}
