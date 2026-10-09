export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6371.0088;
const D2R = Math.PI / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLng = (b.lng - a.lng) * D2R;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function destination(from: LatLng, bearingDeg: number, km: number): LatLng {
  const d = km / R;
  const br = bearingDeg * D2R;
  const lat1 = from.lat * D2R;
  const lng1 = from.lng * D2R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 / D2R, lng: lng2 / D2R };
}

export function circleRing(center: LatLng, km: number, steps = 96): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destination(center, (360 * i) / steps, km);
    ring.push([p.lng, p.lat]);
  }
  return ring;
}

/** Local flat projection (km) around `origin`, accurate enough for distances within a few hundred km. */
export function localKm(origin: LatLng) {
  const kx = Math.cos(origin.lat * D2R) * R * D2R;
  const ky = R * D2R;
  return {
    toXY: (lng: number, lat: number): [number, number] => [(lng - origin.lng) * kx, (lat - origin.lat) * ky],
    toLngLat: (x: number, y: number): [number, number] => [origin.lng + x / kx, origin.lat + y / ky],
  };
}

/**
 * Nearest point to `origin` on or inside a ring ([lng, lat] flat, closed).
 * Distance is 0 when the origin is inside.
 */
export function nearestOnRing(origin: LatLng, ring: number[]): { km: number; lng: number; lat: number } {
  const { toXY, toLngLat } = localKm(origin);
  const n = ring.length / 2 - 1;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push(toXY(ring[2 * i], ring[2 * i + 1]));

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  if (inside) return { km: 0, lng: origin.lng, lat: origin.lat };

  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-x1 * dx - y1 * dy) / len2));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const d = Math.hypot(px, py);
    if (d < best) {
      best = d;
      bx = px;
      by = py;
    }
  }
  const [lng, lat] = toLngLat(bx, by);
  return { km: best, lng, lat };
}

export function ringCentroid(ring: number[]): LatLng {
  const n = ring.length / 2 - 1;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += ring[2 * i];
    sy += ring[2 * i + 1];
  }
  return { lng: sx / n, lat: sy / n };
}

/** Pulls `p` towards `toward` by up to `km`, never more than half the way. */
export function nudge(p: LatLng, toward: LatLng, km: number): LatLng {
  const d = haversineKm(p, toward);
  if (d === 0) return p;
  const f = Math.min(km, d / 2) / d;
  return { lat: p.lat + (toward.lat - p.lat) * f, lng: p.lng + (toward.lng - p.lng) * f };
}

export function ringAreaKm2(ring: number[]): number {
  const c = ringCentroid(ring);
  const { toXY } = localKm(c);
  const n = ring.length / 2 - 1;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = toXY(ring[2 * i], ring[2 * i + 1]);
    const [x2, y2] = toXY(ring[2 * ((i + 1) % n)], ring[2 * ((i + 1) % n) + 1]);
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
