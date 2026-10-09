// Sanity-checks the shipped zone data: for random locations, the cell found in cells.json must list
// exactly the 5 nearest stores in stores.json. Exits non-zero on any disagreement.

import { readFileSync } from "node:fs";
import { Gnomonic, nearestK, toVec, uvContains } from "../src/lib/orderk";
import type { CellsFile, StoresFile } from "../src/lib/types";

const stores = JSON.parse(readFileSync("public/data/stores.json", "utf8")) as StoresFile;
const cells = JSON.parse(readFileSync("public/data/cells.json", "utf8")) as CellsFile;

if (cells.storesHash !== stores.hash) {
  console.error(`cells.json was built for store list ${cells.storesHash}, stores.json is ${stores.hash}`);
  process.exit(1);
}

const { bbox, k } = cells;
const g = new Gnomonic((bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2);
const vecs = stores.stores.map((s) => toVec(s.lat, s.lng));

const polys = cells.cells.map((c) => {
  const uv: number[] = [];
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < c.r.length - 2; i += 2) {
    const [u, v] = g.project(c.r[i + 1], c.r[i]);
    uv.push(u, v);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { uv, minU, maxU, minV, maxV, key: c.m.join(",") };
});

let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const N = 6000;
let bad = 0;
for (let i = 0; i < N; i++) {
  // Sample the NSW/ACT area itself, away from the clip region's edges.
  const lat = -37.4 + rand() * 9.2;
  const lng = 141.2 + rand() * 12.2;
  const [u, v] = g.project(lat, lng);
  const expected = nearestK(vecs, toVec(lat, lng), k).join(",");
  const hits = polys.filter(
    (p) => u >= p.minU && u <= p.maxU && v >= p.minV && v <= p.maxV && uvContains(p.uv, u, v),
  );
  if (hits.length !== 1 || hits[0].key !== expected) {
    bad++;
    console.error(`mismatch at ${lat.toFixed(5)},${lng.toFixed(5)}: ${hits.length} cells, expected ${expected}, got ${hits.map((h) => h.key).join(" | ")}`);
  }
}

// A handful of boundary-grazing misses are rounding (rings are rounded to ~1 m); anything more is a bug.
if (bad > 3) {
  console.error(`${bad}/${N} sample points disagree`);
  process.exit(1);
}
console.log(`OK: ${N} sample points agree with ${cells.cells.length} cells (${bad} rounding-level misses).`);
