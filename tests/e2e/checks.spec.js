// @ts-check
const {test, expect} = require('@playwright/test');
const {execFileSync} = require('node:child_process');
const {readdirSync} = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const python = path.join(root, '.context/music-analysis-venv/bin/python');
const run = (command, args) => execFileSync(command, args, {cwd: root, encoding: 'utf8', stdio: 'pipe'});

test.describe('existing suites', () => {
  test('app and Ardour bridge Python tests', () => {
    run(python, ['-m', 'unittest', 'discover', '-s', 'tests']);
  });
  test('Rust DSP tests', () => {
    let cargo = true;
    try {
      run('cargo', ['--version']);
    } catch {
      cargo = false;
    }
    test.skip(!cargo, 'Rust is not installed; web/ladder-wasm.js is prebuilt');
    execFileSync('cargo', ['test', '--quiet'], {cwd: path.join(root, 'dsp'), encoding: 'utf8', stdio: 'pipe'});
  });
  test('music-analysis Python tests', () => {
    run(python, ['-m', 'unittest', 'discover', '-s', '.agents/skills/music-analysis/tests']);
  });
  test('all Node unit tests', () => {
    const files = readdirSync(path.join(root, 'tests'))
      .filter(file => file.endsWith('.test.js'))
      .sort()
      .map(file => path.join('tests', file));
    run(process.execPath, ['--test', ...files]);
  });
});

// The offline audio checks render the production graphs; serve their harness pages next to the app.
async function serveHarness(page) {
  await page.route('**/qa/**', route => {
    const file = new URL(route.request().url()).pathname.replace(/^\/qa\//, '');
    return route.fulfill({path: path.join(root, file)});
  });
  await page.route('**/effects-browser.js', route =>
    route.fulfill({path: path.join(root, 'tests/effects-browser.js')}),
  );
}

test('FM machines render correctly offline', async ({page}) => {
  await serveHarness(page);
  await page.goto('/qa/tests/groove.html');
  await page.getByRole('button', {name: 'Run audio checks'}).click();
  await expect(page.locator('#result')).toContainText(/checks passed|FAIL/, {timeout: 45000});
  await expect(page.locator('#result')).toContainText('7 checks passed');
});

test('live effects render correctly offline', async ({page}) => {
  await serveHarness(page);
  await page.goto('/qa/tests/effects.html');
  await expect(page.locator('#result')).toContainText(/checks passed|FAIL/, {timeout: 45000});
  await expect(page.locator('#result')).toContainText('7 checks passed');
});
