// Cloudflare Pages Function: GET /api/geocode?q=...
//
// Looks up a suburb, postcode or address on OpenStreetMap's Nominatim. Nominatim's usage policy asks
// for an identifying User-Agent and at most 1 request per second, so results are cached per edge
// location for a week.

interface Place {
  label: string;
  lat: number;
  lng: number;
}

const json = (body: unknown, status = 200, maxAge = 86_400) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });

export const onRequestGet: PagesFunction = async ({ request, waitUntil }) => {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 100) return json({ results: [] }, 200, 0);

  const cache = caches.default;
  const cacheKey = new Request(new URL(`/api/geocode?q=${encodeURIComponent(q.toLowerCase())}`, request.url));
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    format: "jsonv2",
    countrycodes: "au",
    limit: "5",
    viewbox: "140,-27,154.5,-39.2",
    q,
  }).toString();

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "lockspot/0.1 (+https://github.com/JL2388/lockspot)" },
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    const results: Place[] = rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
    const response = json({ results });
    waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (e) {
    console.error("geocode failed", e);
    return json({ error: "Search unavailable" }, 502, 0);
  }
};
