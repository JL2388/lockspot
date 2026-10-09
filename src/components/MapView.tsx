"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap, Popup } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { HOME_COLOR, RAMP, ZONE_COLOR, type CellProps, type StoreProps } from "@/lib/display";
import { circleRing, destination, type LatLng } from "@/lib/geo";
import type { CellsFile, Store } from "@/lib/types";

export interface InspectInfo {
  point: LatLng;
  fuel: string;
  rows: { label: string; km: number; price?: number; cheapest: boolean }[];
  lockPrice: number | null;
  uncertain: boolean;
}

export interface MapViewProps {
  stores: Store[];
  cells: CellsFile["cells"];
  cellProps: CellProps[];
  storeProps: StoreProps[];
  center: LatLng;
  radiusKm: number;
  /** Draw the search circle and fade everything outside it. */
  showRing: boolean;
  /** Where to stand, shown as an amber marker. */
  target: LatLng | null;
  /** Fit the map to these points whenever `nonce` changes. */
  view: { nonce: number; points: LatLng[] };
  inspect: InspectInfo | null;
  onSelectStore: (index: number) => void;
  onInspect: (p: LatLng) => void;
  onCloseInspect: () => void;
  onUseInspected: () => void;
}

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const empty = { type: "FeatureCollection", features: [] } as const;

const rampExpr = (key: string) => [
  "interpolate",
  ["linear"],
  ["get", key],
  ...RAMP.flatMap((r) => [r.at, r.color]),
];

function popupElement(info: InspectInfo, onUse: () => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "spot-popup";

  const h = document.createElement("div");
  h.className = "spot-popup-title";
  h.textContent = "Your closest five here";
  root.appendChild(h);

  const ol = document.createElement("ol");
  info.rows.forEach((r) => {
    const li = document.createElement("li");
    if (r.cheapest) li.className = "cheapest";
    const name = document.createElement("span");
    name.textContent = r.label;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${r.km.toFixed(1)} km${r.price !== undefined ? ` · ${r.price.toFixed(1)}¢` : ""}`;
    li.append(name, meta);
    ol.appendChild(li);
  });
  root.appendChild(ol);

  const lock = document.createElement("div");
  lock.className = "spot-popup-lock";
  lock.textContent =
    info.lockPrice === null
      ? `No ${info.fuel} price here`
      : `${info.uncertain ? "Lock up to " : "Lock "}${info.lockPrice.toFixed(1)}¢/L`;
  root.appendChild(lock);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Use as my location";
  btn.addEventListener("click", onUse);
  root.appendChild(btn);
  return root;
}

export default function MapView(props: MapViewProps) {
  const { stores, cells, cellProps, storeProps, center, radiusKm, showRing, target, view, inspect } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const handlers = useRef(props);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    handlers.current = props;
  });

  // Static geometry, built once per data load.
  const cellGeometry = useMemo(
    () =>
      cells.map((c) => {
        const ring: [number, number][] = [];
        for (let i = 0; i < c.r.length; i += 2) ring.push([c.r[i], c.r[i + 1]]);
        return { type: "Polygon" as const, coordinates: [ring] };
      }),
    [cells],
  );

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    (async () => {
      const lib = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      libRef.current = lib;
      lib.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      map = new lib.Map({
        container: container.current,
        style: STYLE_URL,
        center: [151.2093, -33.8688],
        zoom: 9,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        const m = map!;
        for (const id of ["cells", "mask", "ring", "stores", "me", "target"]) {
          m.addSource(id, { type: "geojson", data: empty as never });
        }
        m.addLayer({
          id: "cells-fill",
          type: "fill",
          source: "cells",
          paint: {
            "fill-antialias": false,
            "fill-color": [
              "case",
              ["==", ["get", "sel"], 1],
              ZONE_COLOR,
              ["<", ["get", "lv"], 0],
              "#b8c0c7",
              rampExpr("lv"),
            ] as never,
            "fill-opacity": ["case", ["==", ["get", "sel"], 1], 0.62, 0.55] as never,
          },
        });
        m.addLayer({
          id: "mask",
          type: "fill",
          source: "mask",
          paint: { "fill-color": "#f2f3f0", "fill-opacity": 0.78 },
        });
        m.addLayer({
          id: "ring-line",
          type: "line",
          source: "ring",
          paint: { "line-color": "#14202b", "line-width": 1.6, "line-dasharray": [3, 2] },
        });
        m.addLayer({
          id: "stores-circle",
          type: "circle",
          source: "stores",
          paint: {
            "circle-radius": [
              "case",
              ["==", ["get", "sel"], 2],
              8,
              ["==", ["get", "sel"], 1],
              7,
              ["==", ["get", "home"], 1],
              6.5,
              4.5,
            ] as never,
            "circle-color": [
              "case",
              ["==", ["get", "sel"], 2],
              ZONE_COLOR,
              ["==", ["get", "ok"], 0],
              "#aab3ba",
              "#14202b",
            ] as never,
            "circle-stroke-color": [
              "case",
              ["==", ["get", "home"], 1],
              HOME_COLOR,
              ["==", ["get", "sel"], 1],
              "#f0b429",
              "#ffffff",
            ] as never,
            "circle-stroke-width": [
              "case",
              ["==", ["get", "home"], 1],
              3.5,
              ["==", ["get", "sel"], 1],
              2.5,
              1.5,
            ] as never,
          },
        });
        m.addLayer({
          id: "stores-label",
          type: "symbol",
          source: "stores",
          filter: ["has", "t"],
          minzoom: 8,
          layout: {
            "text-field": ["get", "t"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 11,
            "text-anchor": "top",
            "text-offset": [0, 0.8],
            "symbol-sort-key": ["get", "p"],
          },
          paint: { "text-color": "#14202b", "text-halo-color": "#ffffff", "text-halo-width": 1.8 },
        });
        m.addLayer({
          id: "me-halo",
          type: "circle",
          source: "me",
          paint: { "circle-radius": 14, "circle-color": "#2563eb", "circle-opacity": 0.2 },
        });
        m.addLayer({
          id: "me-dot",
          type: "circle",
          source: "me",
          paint: {
            "circle-radius": 6,
            "circle-color": "#2563eb",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5,
          },
        });

        m.addLayer({
          id: "target-dot",
          type: "circle",
          source: "target",
          paint: {
            "circle-radius": 9,
            "circle-color": "#f0b429",
            "circle-stroke-color": "#14202b",
            "circle-stroke-width": 2.5,
          },
        });
        m.addLayer({
          id: "target-label",
          type: "symbol",
          source: "target",
          layout: {
            "text-field": "Lock here",
            "text-font": ["Noto Sans Bold"],
            "text-size": 12,
            "text-anchor": "top",
            "text-offset": [0, 1.1],
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#14202b", "text-halo-color": "#ffffff", "text-halo-width": 2 },
        });

        m.on("mouseenter", "stores-circle", () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", "stores-circle", () => (m.getCanvas().style.cursor = ""));
        m.on("click", (e) => {
          const r = 10;
          const hit = m.queryRenderedFeatures(
            [
              [e.point.x - r, e.point.y - r],
              [e.point.x + r, e.point.y + r],
            ],
            { layers: ["stores-circle"] },
          )[0];
          if (hit) handlers.current.onSelectStore(Number(hit.properties.i));
          else handlers.current.onInspect({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        });
        setReady(true);
      });
    })();

    return () => {
      cancelled = true;
      popupRef.current?.remove();
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  const source = (id: string) => mapRef.current?.getSource(id) as GeoJSONSource | undefined;

  useEffect(() => {
    if (!ready) return;
    source("cells")?.setData({
      type: "FeatureCollection",
      features: cellGeometry.map((geometry, i) => ({
        type: "Feature",
        geometry,
        properties: cellProps[i] ?? { lv: -1, sel: 0 },
      })),
    });
  }, [ready, cellGeometry, cellProps]);

  useEffect(() => {
    if (!ready) return;
    source("stores")?.setData({
      type: "FeatureCollection",
      features: stores.map((s, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: { i, ...(storeProps[i] ?? { sel: 0, ok: 0, home: 0 }) },
      })),
    });
  }, [ready, stores, storeProps]);

  useEffect(() => {
    if (!ready) return;
    if (showRing) {
      const ring = circleRing(center, radiusKm);
      source("ring")?.setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: ring },
        properties: {},
      });
      source("mask")?.setData({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-180, -85],
              [180, -85],
              [180, 85],
              [-180, 85],
              [-180, -85],
            ],
            [...ring].reverse(),
          ],
        },
        properties: {},
      });
    } else {
      source("ring")?.setData(empty as never);
      source("mask")?.setData(empty as never);
    }
    source("me")?.setData({
      type: "Feature",
      geometry: { type: "Point", coordinates: [center.lng, center.lat] },
      properties: {},
    });
  }, [ready, center, radiusKm, showRing]);

  useEffect(() => {
    if (!ready) return;
    source("target")?.setData(
      target
        ? { type: "Feature", geometry: { type: "Point", coordinates: [target.lng, target.lat] }, properties: {} }
        : (empty as never),
    );
  }, [ready, target]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const pts = view.points.length ? view.points : [destination(center, 0, radiusKm), destination(center, 180, radiusKm), destination(center, 90, radiusKm), destination(center, 270, radiusKm)];
    const lngs = pts.map((p) => p.lng);
    const lats = pts.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 48, duration: 700, maxZoom: 15 },
    );
    // Only re-fit when asked to, not whenever the centre or radius change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, view.nonce]);

  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    popupRef.current?.remove();
    popupRef.current = null;
    if (!inspect) return;
    const popup = new lib.Popup({ maxWidth: "290px", offset: 8 })
      .setLngLat([inspect.point.lng, inspect.point.lat])
      .setDOMContent(popupElement(inspect, () => handlers.current.onUseInspected()))
      .addTo(map);
    popup.on("close", () => {
      if (popupRef.current === popup) {
        popupRef.current = null;
        handlers.current.onCloseInspect();
      }
    });
    popupRef.current = popup;
  }, [ready, inspect]);

  return <div
      ref={container}
      style={{ position: "absolute", inset: 0 }}
      role="application" aria-label="Map of 7-Eleven lock zones"
    />;
}
