import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },

  env: {
    NEXT_PUBLIC_LANDING_BASE_PATH: "",
  },

  // Mantener esto por el monorepo padre
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;