import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The extractors reach for Node built-ins and lazy requires the bundler
  // cannot follow, so they stay on native require.
  serverExternalPackages: ["unpdf", "mammoth", "read-excel-file"],
};

export default nextConfig;
