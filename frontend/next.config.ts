import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/db, packages/common, packages/game-engine are workspace
  // packages consumed as raw TypeScript (see their package.json "main"
  // fields) — same convention the legacy frontend used for `common`/`db`.
  transpilePackages: ["common", "db", "game-engine"],
};

export default nextConfig;
