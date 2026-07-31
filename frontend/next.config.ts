import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Stray lockfiles above this dir confuse Next's root inference.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
