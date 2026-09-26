import path from "node:path";
import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // Standalone output for the Docker image (docker/frontend.Dockerfile) - a
  // self-contained server bundle instead of requiring node_modules at runtime.
  output: "standalone",
  // This is an npm workspace, not a standalone app - pin the trace root to the
  // monorepo root (one level up) so the standalone bundle traces and includes
  // @mywfm/shared correctly instead of Next guessing the wrong lockfile root.
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  async rewrites() {
    return [
      // The browser only ever talks to this Next.js origin. Proxying /api/*
      // server-side to the Express backend avoids CORS and keeps the auth
      // refresh cookie same-site, in dev and in production alike.
      { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
    ];
  },
};

export default nextConfig;
