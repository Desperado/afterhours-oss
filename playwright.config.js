// @ts-check
const {defineConfig} = require('@playwright/test');

// Run with `npm test` (or `9l run tests/e2e` for receipts). A separate app instance on
// port 8790 keeps the everyday server on 8765 untouched; Ardour is mocked in the browser
// specs. One worker avoids two app instances competing for that port. Tests use installed
// Google Chrome; set AFTERHOURS_CHROMIUM to a Chromium executable to use that instead.
const chromium = process.env.AFTERHOURS_CHROMIUM;
module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8790',
    channel: chromium ? undefined : 'chrome',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
      ...(chromium ? {executablePath: chromium} : {}),
    },
  },
  webServer: {
    command: 'bash start.sh --public --port 8790',
    url: 'http://127.0.0.1:8790/',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
