import { cacheLife } from "next/cache";

export interface Place {
  label: string;
  lat: number;
  lng: number;
}

/** Nominatim policy: identify the app, at most 1 request/second. Results are cached for a week. */
export async function searchPlaces(q: string): Promise<Place[]> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: 604800, expire: 2592000 });

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    format: "jsonv2",
    countrycodes: "au",
    limit: "5",
    viewbox: "140,-27,154.5,-39.2",
    q,
  }).toString();
  const res = await fetch(url, { headers: { "User-Agent": "lock-spot/0.1 (7-Eleven fuel lock finder)" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}
