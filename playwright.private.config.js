const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({testDir: 'tests', testMatch: 'private-desktop.spec.js', timeout: 180000, workers: 1});
