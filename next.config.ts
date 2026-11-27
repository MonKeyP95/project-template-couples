import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phones must re-check the service worker on every online open, so a
  // deploy replaces the stored on-the-road copy.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
