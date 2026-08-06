import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployment-ready minimal output for the OCI container (07_06 §4).
  output: "standalone",
  logging: {
    incomingRequests: {
      // Health probes fire frequently; keep signal-to-noise sane in logs.
      ignore: [/\/health\/(live|ready)/],
    },
  },
};

export default nextConfig;
