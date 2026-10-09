import { getPrices } from "@/server/prices";

export async function GET() {
  try {
    return Response.json(await getPrices());
  } catch (e) {
    console.error("price feed failed", e);
    return Response.json({ error: "Price feed unavailable" }, { status: 502 });
  }
}
