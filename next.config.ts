import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

/** Pin project root so Turbopack doesn’t pick a parent folder when multiple lockfiles exist. */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  /** pdf-parse@1.x bundles its own PDF.js build; keep external so the server bundle matches Node resolution. */
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
