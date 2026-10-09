import { searchPlaces } from "@/server/geocode";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 100) return Response.json({ results: [] });
  try {
    return Response.json({ results: await searchPlaces(q) });
  } catch (e) {
    console.error("geocode failed", e);
    return Response.json({ error: "Search unavailable" }, { status: 502 });
  }
}
