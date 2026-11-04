const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({testDir: 'tests', testMatch: 'desktop.spec.js', timeout: 120000, workers: 1});
