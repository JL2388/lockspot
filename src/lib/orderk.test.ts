import { describe, expect, it } from "vitest";
import { Gnomonic, computeOrderKCells, nearestK, toVec, uvContains, type BBox } from "./orderk";

// Small deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function scatter(count: number, bbox: BBox, seed: number) {
  const r = rng(seed);
  return Array.from({ length: count }, () => ({
    lat: bbox.south + r() * (bbox.north - bbox.south),
    lng: bbox.west + r() * (bbox.east - bbox.west),
  }));
}

const BBOX: BBox = { south: -37, west: 146, north: -33, east: 151 };

describe.each([
  { n: 12, k: 3 },
  { n: 40, k: 5 },
  { n: 120, k: 5 },
])("order-$k cells for $n points", ({ n, k }) => {
  const points = scatter(n, BBOX, 7 + n);
  const cells = computeOrderKCells(points, k, BBOX);
  const vecs = points.map((p) => toVec(p.lat, p.lng));
  const g = new Gnomonic((BBOX.south + BBOX.north) / 2, (BBOX.west + BBOX.east) / 2);

  it("has exactly one cell per sampled location, with the true k nearest as members", () => {
    const samples = scatter(3000, { south: -36.8, west: 146.2, north: -33.2, east: 150.8 }, 99);
    for (const s of samples) {
      const expected = nearestK(vecs, toVec(s.lat, s.lng), k).join(",");
      const [u, v] = g.project(s.lat, s.lng);
      const hits = cells.filter((c) => uvContains(c.uv, u, v));
      expect(hits.length, `point ${s.lat},${s.lng}`).toBe(1);
      expect(hits[0].members.join(",")).toBe(expected);
    }
  });

  it("emits each member set once", () => {
    const keys = cells.map((c) => c.members.join(","));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("produces closed lng/lat rings", () => {
    for (const c of cells) {
      expect(c.ring.length).toBeGreaterThanOrEqual(8);
      expect(c.ring[0]).toBe(c.ring[c.ring.length - 2]);
      expect(c.ring[1]).toBe(c.ring[c.ring.length - 1]);
    }
  });
});
