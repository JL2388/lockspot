import { describe, expect, it } from "vitest";
import { analyseCells, bestInRange, cellReach, rankStores, storeZone, viewPrices } from "./lock";
import type { CellsFile, PriceTable, Store } from "./types";

// Two adjacent square cells along a line at lat -33.
const sq = (w: number, e: number) => [w, -33.1, e, -33.1, e, -32.9, w, -32.9, w, -33.1];
const cells: CellsFile["cells"] = [
  { m: [0, 1, 2, 3, 4], r: sq(150.0, 150.1) },
  { m: [1, 2, 3, 4, 5], r: sq(150.1, 150.2) },
];
const stores: Store[] = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, lat: -33, lng: 150 + i * 0.03 }));
const table: PriceTable = {
  s0: { U91: 190 },
  s1: { U91: 195 },
  s2: { U91: 199 },
  s3: { U91: 201 },
  s4: { U91: 210 },
  s5: { U91: 170 },
};
const view = viewPrices(stores, table, "U91");

describe("lock analysis", () => {
  const infos = analyseCells(cells, view);

  it("prices a cell at its cheapest member", () => {
    expect(infos[0]).toEqual({ price: 190, setters: [0], uncertain: false });
    expect(infos[1]).toEqual({ price: 170, setters: [5], uncertain: false });
  });

  it("flags cells with stores the feed doesn't know", () => {
    const withoutS5 = Object.fromEntries(Object.entries(table).filter(([id]) => id !== "s5"));
    const info = analyseCells(cells, viewPrices(stores, withoutS5, "U91"))[1];
    expect(info.uncertain).toBe(true);
    expect(info.price).toBe(195); // best known price, which may overstate the real lock
  });

  it("treats a store that doesn't sell the fuel as skipped, not unknown", () => {
    const v = viewPrices(stores, { ...table, s5: {} }, "U91");
    const info = analyseCells(cells, v)[1];
    expect(info.price).toBe(195);
    expect(info.uncertain).toBe(false);
  });

  it("finds the cheapest reachable zone and its distance", () => {
    const center = { lat: -33, lng: 150.05 }; // inside cell 0
    const reach = cellReach(center, cells);
    expect(reach[0].km).toBe(0);
    expect(reach[1].km).toBeGreaterThan(4);
    expect(bestInRange(infos, reach, 2)?.cell).toBe(0);
    const far = bestInRange(infos, reach, 20);
    expect(far?.cell).toBe(1);
    expect(far?.price).toBe(170);
    // The suggested spot is inside the target cell, not on its edge.
    expect(far!.spot.lng).toBeGreaterThan(150.1);
  });

  it("ranks only stores that can set a price in range", () => {
    const reach = cellReach({ lat: -33, lng: 150.05 }, cells);
    expect(rankStores(infos, reach, 20).map((r) => r.store)).toEqual([5, 0]);
    expect(rankStores(infos, reach, 2).map((r) => r.store)).toEqual([0]);
  });

  it("zones a store only where its price is the lock price", () => {
    const beaten = storeZone(1, cells, infos); // in both cells' five, but always beaten by a cheaper neighbour
    expect(beaten.locks).toEqual([]);
    const cheapest = storeZone(5, cells, infos);
    expect(cheapest.locks).toEqual([1]);
    expect(cheapest.areaKm2).toBeGreaterThan(0);
  });
});
