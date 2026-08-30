import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";

const stripLegacyFontsourceWoff = {
  name: "strip-legacy-fontsource-woff",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.includes("/node_modules/@fontsource") || !id.endsWith(".css")) {
      return null;
    }
    const modernCss = code.replace(
      /,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g,
      "",
    );
    return modernCss === code ? null : { code: modernCss, map: null };
  },
};

export default defineConfig({
  plugins: [
    stripLegacyFontsourceWoff,
    preact(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "icons/*.png"],
      manifest: {
        name: "文字手舉牌",
        short_name: "手舉牌",
        description: "輕量、離線可用的網頁版文字手舉牌",
        theme_color: "#111111",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: null,
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        globIgnores: ["experiments/**", "**/font-*.css"],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/font-[^/]+\.css$/,
            handler: "CacheFirst",
            options: {
              cacheName: "optional-web-fonts-v1",
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 365,
                maxEntries: 2_048,
              },
            },
          },
          {
            urlPattern: /\/assets\/[^/]+\.woff2$/,
            handler: "CacheFirst",
            options: {
              cacheName: "optional-web-fonts-v1",
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 365,
                maxEntries: 2_048,
              },
            },
          },
        ],
      }
    })
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.{ts,tsx}"],
    css: true
  },
  preview: {
    allowedHosts: [".trycloudflare.com"]
  },
  build: {
    target: "es2022",
    sourcemap: true
  }
});
