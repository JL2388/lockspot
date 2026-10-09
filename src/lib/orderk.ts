// Exact order-k Voronoi cells on the sphere.
//
// A cell is the set of locations whose k nearest points are one particular k-set. Each cell is
// convex, and crossing one of its edges swaps exactly one member for another. So we find all
// cells by walking from a seed cell across edges, instead of sampling a grid.
//
// Bisectors between two points on a sphere are great circles, which a gnomonic projection maps to
// straight lines. Working in that projection makes every cell an exact polygon and keeps the
// maths to half-plane clipping.

export type Vec3 = [number, number, number];

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface OrderKCell {
  /** Indexes into the input points, sorted ascending. */
  members: number[];
  /** Exact polygon in gnomonic space, flat [u, v, u, v, ...], counter-clockwise, unclosed. */
  uv: number[];
  /** Polygon as flat [lng, lat, ...], edges densified, closed (first point repeated). */
  ring: number[];
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const VERTEX_EPS = 1e-10;
const EDGE_EPS = 1e-9;
const AREA_EPS = 1e-13;

export function toVec(lat: number, lng: number): Vec3 {
  const p = lat * D2R;
  const l = lng * D2R;
  const cp = Math.cos(p);
  return [cp * Math.cos(l), cp * Math.sin(l), Math.sin(p)];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class Gnomonic {
  readonly c: Vec3;
  readonly e1: Vec3; // east
  readonly e2: Vec3; // north

  constructor(lat: number, lng: number) {
    const p = lat * D2R;
    const l = lng * D2R;
    this.c = toVec(lat, lng);
    this.e1 = [-Math.sin(l), Math.cos(l), 0];
    this.e2 = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
  }

  project(lat: number, lng: number): [number, number] {
    const x = toVec(lat, lng);
    const d = dot(x, this.c);
    return [dot(x, this.e1) / d, dot(x, this.e2) / d];
  }

  unproject(u: number, v: number): [number, number] {
    const { c, e1, e2 } = this;
    const x = c[0] + u * e1[0] + v * e2[0];
    const y = c[1] + u * e1[1] + v * e2[1];
    const z = c[2] + u * e1[2] + v * e2[2];
    const r = Math.hypot(x, y, z);
    return [Math.asin(z / r) * R2D, Math.atan2(y, x) * R2D];
  }
}

interface Poly {
  u: number[];
  v: number[];
  /** tag[i] labels the edge from vertex i to vertex i+1: a * n + b for a bisector, -1 for the bbox. */
  tag: number[];
}

function clip(poly: Poly, c0: number, c1: number, c2: number, tag: number): Poly {
  const m = poly.u.length;
  const f = new Array<number>(m);
  let allIn = true;
  for (let i = 0; i < m; i++) {
    f[i] = c0 + c1 * poly.u[i] + c2 * poly.v[i];
    if (f[i] < 0) allIn = false;
  }
  if (allIn) return poly;

  const out: Poly = { u: [], v: [], tag: [] };
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const inI = f[i] >= 0;
    const inJ = f[j] >= 0;
    if (inI) {
      out.u.push(poly.u[i]);
      out.v.push(poly.v[i]);
      out.tag.push(poly.tag[i]);
      if (!inJ) {
        const t = f[i] / (f[i] - f[j]);
        out.u.push(poly.u[i] + t * (poly.u[j] - poly.u[i]));
        out.v.push(poly.v[i] + t * (poly.v[j] - poly.v[i]));
        out.tag.push(tag);
      }
    } else if (inJ) {
      const t = f[i] / (f[i] - f[j]);
      out.u.push(poly.u[i] + t * (poly.u[j] - poly.u[i]));
      out.v.push(poly.v[i] + t * (poly.v[j] - poly.v[i]));
      out.tag.push(poly.tag[i]);
    }
  }
  return out.u.length < 3 ? { u: [], v: [], tag: [] } : out;
}

/** Drops vertices that coincide with their successor. */
function tidy(poly: Poly): Poly {
  const out: Poly = { u: [], v: [], tag: [] };
  const m = poly.u.length;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    if (Math.hypot(poly.u[j] - poly.u[i], poly.v[j] - poly.v[i]) < VERTEX_EPS) continue;
    out.u.push(poly.u[i]);
    out.v.push(poly.v[i]);
    out.tag.push(poly.tag[i]);
  }
  return out;
}

function area(poly: Poly): number {
  let s = 0;
  const m = poly.u.length;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    s += poly.u[i] * poly.v[j] - poly.u[j] * poly.v[i];
  }
  return s / 2;
}

const keyOf = (members: number[]) => [...members].sort((a, b) => a - b).join(",");

export function nearestK(vecs: Vec3[], at: Vec3, k: number): number[] {
  return vecs
    .map((p, i) => [i, dot(p, at)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([i]) => i)
    .sort((a, b) => a - b);
}

export function computeOrderKCells(
  points: { lat: number; lng: number }[],
  k: number,
  bbox: BBox,
  opts: { maxEdgeRad?: number } = {},
): OrderKCell[] {
  const n = points.length;
  if (n <= k) throw new Error(`need more than ${k} points, got ${n}`);
  const maxEdge = opts.maxEdgeRad ?? 0.004; // ~25 km

  const vecs = points.map((p) => toVec(p.lat, p.lng));
  const g = new Gnomonic((bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2);

  const corners: [number, number][] = [
    [bbox.south, bbox.west],
    [bbox.south, bbox.east],
    [bbox.north, bbox.east],
    [bbox.north, bbox.west],
  ].map(([la, lo]) => g.project(la, lo));
  const bboxPoly: Poly = {
    u: corners.map((c) => c[0]),
    v: corners.map((c) => c[1]),
    tag: [-1, -1, -1, -1],
  };

  // Half-plane "a is closer than b": (c + u*e1 + v*e2) . (A - B) >= 0, normalised.
  const constraint = (a: number, b: number): [number, number, number] => {
    const A = vecs[a];
    const B = vecs[b];
    const nv: Vec3 = [A[0] - B[0], A[1] - B[1], A[2] - B[2]];
    const len = Math.hypot(nv[0], nv[1], nv[2]);
    return [dot(g.c, nv) / len, dot(g.e1, nv) / len, dot(g.e2, nv) / len];
  };

  const buildCell = (members: number[]): Poly => {
    const mean: Vec3 = [0, 0, 0];
    for (const m of members) for (let d = 0; d < 3; d++) mean[d] += vecs[m][d];
    const inSet = new Set(members);
    const others: number[] = [];
    for (let i = 0; i < n; i++) if (!inSet.has(i)) others.push(i);
    others.sort((x, y) => dot(vecs[y], mean) - dot(vecs[x], mean));

    let poly = bboxPoly;
    for (const b of others) {
      for (const a of members) {
        const [c0, c1, c2] = constraint(a, b);
        poly = clip(poly, c0, c1, c2, a * n + b);
        if (poly.u.length === 0) return poly;
      }
    }
    return tidy(poly);
  };

  const seedMembers = nearestK(vecs, g.c, k);
  const seen = new Set<string>([keyOf(seedMembers)]);
  const queue: number[][] = [seedMembers];
  const cells: OrderKCell[] = [];

  while (queue.length) {
    const members = queue.shift()!;
    const poly = buildCell(members);
    if (poly.u.length < 3 || Math.abs(area(poly)) < AREA_EPS) continue;

    const m = poly.u.length;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const t = poly.tag[i];
      if (t < 0) continue;
      if (Math.hypot(poly.u[j] - poly.u[i], poly.v[j] - poly.v[i]) < EDGE_EPS) continue;
      const a = Math.floor(t / n);
      const b = t % n;
      const next = members.filter((x) => x !== a).concat(b);
      const key = keyOf(next);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }

    const uv: number[] = [];
    const ring: number[] = [];
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      uv.push(poly.u[i], poly.v[i]);
      const len = Math.hypot(poly.u[j] - poly.u[i], poly.v[j] - poly.v[i]);
      const steps = Math.max(1, Math.ceil(len / maxEdge));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const [lat, lng] = g.unproject(
          poly.u[i] + t * (poly.u[j] - poly.u[i]),
          poly.v[i] + t * (poly.v[j] - poly.v[i]),
        );
        ring.push(lng, lat);
      }
    }
    ring.push(ring[0], ring[1]);
    cells.push({ members: [...members].sort((x, y) => x - y), uv, ring });
  }

  return cells;
}

/** True when (u, v) lies inside a polygon given as flat [u, v, ...]. */
export function uvContains(uv: number[], u: number, v: number): boolean {
  let inside = false;
  const m = uv.length / 2;
  for (let i = 0, j = m - 1; i < m; j = i++) {
    const ui = uv[2 * i];
    const vi = uv[2 * i + 1];
    const uj = uv[2 * j];
    const vj = uv[2 * j + 1];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}

export { Gnomonic as GnomonicProjection };
