// @ts-check
const base = require('./playwright.config');

/* Watch the MPK emulator play Afterhours in a real browser window.
   npm run demo:mpk  — runs the MPK scenarios and sessions slowly, with the controller drawn on the page.
   npm run play:mpk  — opens Afterhours with the emulated MPK connected, to play it with the mouse.
   MPK_PACE sets the pause after each physical action (ms, default 350). */
process.env.MPK_VIEW = '1';
process.env.MPK_PACE ??= '350';
module.exports = {
  ...base,
  timeout: process.env.MPK_PLAYGROUND === '1' ? 0 : base.timeout,
  testMatch:
    process.env.MPK_PLAYGROUND === '1' ? ['mpk-playground.spec.js'] : ['mpk-scenarios.spec.js', 'mpk-sessions.spec.js'],
  // Tests that measure tap timing or deliberately press twice within milliseconds can't run at a watching pace.
  grepInvert: /tap tempo|Tap Tempo|double-pressing/i,
  reporter: 'list',
  outputDir: '.context/mpk-demo-results',
  use: {...base.use, baseURL: 'http://127.0.0.1:8791', headless: false, viewport: {width: 1440, height: 900}},
  webServer: {...base.webServer, command: 'bash start.sh --public --port 8791', url: 'http://127.0.0.1:8791/'},
};
