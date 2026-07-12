// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    viewport: { width: 420, height: 780 },
    hasTouch: true,
    isMobile: true,
    // this sandbox/CI image preinstalls Chromium at a fixed path rather than the
    // revision Playwright would normally auto-download - point at it explicitly
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {},
    },
  ],
});
