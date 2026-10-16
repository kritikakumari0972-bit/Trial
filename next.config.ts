import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/extract": ["./bin/**/*"],
    "/api/media/[id]": ["./bin/**/*"],
  },
  serverExternalPackages: [],
};

export default nextConfig;
