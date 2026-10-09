import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";
const cert = ".cert/localhost.pem";
const key = ".cert/localhost-key.pem";
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "180",
        short_name: "180",
        description: "A truthful record of each day.",
        theme_color: "#f6f4ec",
        background_color: "#f6f4ec",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 6000000,
        navigateFallback: "/index.html",
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    https:
      process.env.HTTPS === "1" && fs.existsSync(cert) && fs.existsSync(key)
        ? { cert: fs.readFileSync(cert), key: fs.readFileSync(key) }
        : undefined,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    https:
      process.env.HTTPS === "1" && fs.existsSync(cert) && fs.existsSync(key)
        ? { cert: fs.readFileSync(cert), key: fs.readFileSync(key) }
        : undefined,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
