import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // AGENTS.md is kept by hand in this repo.
  agentRules: false,
};

export default nextConfig;
