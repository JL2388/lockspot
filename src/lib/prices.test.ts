import { describe, expect, it } from "vitest";
import { demoTable, liveTable } from "./prices";
import type { Store } from "./types";

const stores: Store[] = [
  { id: "fc-1", fc: "1", lat: -33.8, lng: 151.0 },
  { id: "fc-2", fc: "2", lat: -33.9, lng: 151.1 },
  { id: "osm-n9", lat: -28.0, lng: 153.4 }, // interstate: no feed
];

describe("liveTable", () => {
  const table = liveTable(stores, [
    { stationcode: "1", fueltype: "U91", price: 230.9 },
    { stationcode: "1", fueltype: "E10", price: 226.9 },
    { stationcode: "99", fueltype: "U91", price: 1 }, // not one of our stores
  ]);

  it("maps FuelCheck codes onto store ids", () => {
    expect(table["fc-1"]).toEqual({ U91: 230.9, E10: 226.9 });
  });

  it("keeps matched stores with no prices as known-but-empty", () => {
    expect(table["fc-2"]).toEqual({});
  });

  it("leaves stores without a feed out, so they read as unknown", () => {
    expect("osm-n9" in table).toBe(false);
  });
});

describe("demoTable", () => {
  it("is deterministic and covers every store", () => {
    expect(demoTable(stores)).toEqual(demoTable(stores));
    expect(Object.keys(demoTable(stores))).toHaveLength(3);
  });
});
