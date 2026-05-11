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
  /**
   * Larger payloads for Server Actions (if you use them for uploads later).
   * App Router **Route Handlers** do not use the old Pages `api.bodyParser` option; PDF bytes go
   * to Supabase Storage from the browser, and `/api/process-pdf` only receives small JSON.
   */
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
