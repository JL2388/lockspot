import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // The site is static; /api/* lives in Cloudflare Pages Functions (see functions/).
  output: "export",
  // In dev, hand /api/* to the local Pages Functions server (`npm run dev` starts it on :8788).
  ...(isDev && {
    async rewrites() {
      return [{ source: "/api/:path*", destination: "http://127.0.0.1:8788/api/:path*" }];
    },
  }),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
