import type { MetadataRoute } from "next"

/** Installs the app with the on-the-road screen as its start page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Together",
    short_name: "Together",
    start_url: "/on-the-road",
    display: "standalone",
    background_color: "#f5efe7",
    theme_color: "#00576a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  }
}
