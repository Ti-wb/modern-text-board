import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: "chromium-390x844", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
    { name: "chromium-430x932", use: { ...devices["Desktop Chrome"], viewport: { width: 430, height: 932 } } },
    { name: "chromium-500x768", use: { ...devices["Desktop Chrome"], viewport: { width: 500, height: 768 } } },
    { name: "chromium-768x1024", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "chromium-1024x768", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
    { name: "chromium-1280x800", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "chromium-1440x900", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "chromium-dpr3",
      use: {
        ...devices["Desktop Chrome"],
        deviceScaleFactor: 3,
        viewport: { width: 1024, height: 768 },
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    {
      name: "iphone",
      use: { ...devices["iPhone 13"] }
    },
    {
      name: "ipad-landscape",
      use: {
        ...devices["iPad Pro 11 landscape"],
        viewport: { width: 1024, height: 768 }
      }
    }
  ]
});
