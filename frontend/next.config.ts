import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/db, packages/common, packages/game-engine are workspace
  // packages consumed as raw TypeScript (see their package.json "main"
  // fields) — same convention the legacy frontend used for `common`/`db`.
  transpilePackages: ["common", "db", "game-engine"],

  // Produces .next/standalone: a minimal, self-contained server bundle
  // (its own copy of only the node_modules actually used, traced from
  // this monorepo's root) — what frontend/Dockerfile copies into the
  // runtime image instead of shipping the whole node_modules tree.
  // Doesn't change the existing `next start` deployment (deploy/) at
  // all - the regular .next build output is produced right alongside
  // this either way; standalone is purely an additional output.
  output: "standalone",

  // Production-hardening headers flagged by the pre-deployment security
  // review — none of these were set before. frame-ancestors 'none' (plus
  // the older X-Frame-Options for browsers that don't read CSP) stops
  // this portal from being framed on another site for a clickjacking
  // attack against moderator actions; nosniff and a conservative
  // Referrer-Policy are cheap, standard defense-in-depth for any app
  // handling session cookies.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
