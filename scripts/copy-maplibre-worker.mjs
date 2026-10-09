// maplibre-gl derives its worker URL from import.meta.url, which Turbopack rewrites to a chunk path
// that doesn't exist. Serve the worker (and the shared module it imports) from /public instead and
// point maplibre at it with setWorkerUrl().
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/maplibre", { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(`node_modules/maplibre-gl/dist/${f}`, `public/maplibre/${f}`);
}
