import type { NextConfig } from "next";
import path from "path";

/** Debe coincidir con `pub()` en `src/lib/paths.ts` y con el deploy en adray.ai */
const landingBasePath = "/landing";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },

  // Export en `public/landing/`. En adray.ai: `express.static(public)` resuelve `/landing/_next/*`
  // y la home pública sigue en `/` (ver backend/index.js → LANDING_PUBLIC).
  basePath: landingBasePath,
  assetPrefix: `${landingBasePath}/`,

  env: {
    // Cliente: rutas absolutas a /public (p. ej. vídeo del hero) deben incluir el basePath
    NEXT_PUBLIC_LANDING_BASE_PATH: landingBasePath,
  },

  // Mantener esto por el monorepo padre
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;