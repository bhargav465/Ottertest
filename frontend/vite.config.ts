import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["pwa-180.png", "pwa-192.png", "pwa-512.png"],
      manifest: {
        name: "Ottertest",
        short_name: "Ottertest",
        description:
          "Record, transcribe and summarize your meetings — in your own AWS account.",
        theme_color: "#0f1115",
        background_color: "#0f1115",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
        // Never cache API or auth calls — always hit the network.
        navigateFallbackDenylist: [/^\/meetings/, /^\/uploads/],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
