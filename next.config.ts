import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

/** Pin project root so Turbopack doesn’t pick a parent folder when multiple lockfiles exist. */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /**
   * Edge middleware cannot reliably read non-NEXT_PUBLIC env on Vercel. Mirror
   * allowlist vars so `isAppAdminEnvUser` works there when only `APP_ADMIN_*` is set.
   */
  env: {
    NEXT_PUBLIC_APP_ADMIN_USER_IDS:
      process.env.NEXT_PUBLIC_APP_ADMIN_USER_IDS ||
      process.env.APP_ADMIN_USER_IDS ||
      "",
    NEXT_PUBLIC_APP_ADMIN_EMAILS:
      process.env.NEXT_PUBLIC_APP_ADMIN_EMAILS ||
      process.env.APP_ADMIN_EMAILS ||
      "",
  },
  turbopack: {
    root: projectRoot,
  },
  /** Native / bundled deps that must stay external in the server bundle. */
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
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
