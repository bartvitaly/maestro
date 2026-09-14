import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.SAMPLE_PORT) || 4173;
const baseURL = `http://127.0.0.1:${PORT}`;

// devices['iPhone 14'] defaults to WebKit. A corporate MITM (Avast, etc.) often
// blocks the WebKit download (SELF_SIGNED_CERT_IN_CHAIN). Local default is the
// same iPhone viewport in Chromium so `npm test` works. CI sets
// PLAYWRIGHT_IOS_WEBKIT=1 after `npx playwright install --with-deps webkit`.
const iosDevice = devices["iPhone 14"];
const iosUse =
  process.env.PLAYWRIGHT_IOS_WEBKIT === "1"
    ? { ...iosDevice }
    : {
        ...iosDevice,
        // Override both: Playwright launches from browserName, devices set defaultBrowserType.
        browserName: "chromium" as const,
        defaultBrowserType: "chromium" as const,
      };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "android-pixel7",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "ios-iphone14",
      use: iosUse,
    },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
