// @ts-check
const {test, expect} = require('@playwright/test');

// English is the source language; Ukrainian is applied to the DOM by web/i18n.js.
test('the language picker switches the whole interface live and remembers the choice', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#groove-load-preset')).toHaveText('Load track');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');

  await page.locator('#lang-select').selectOption('uk');
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  // Static markup, script-rendered text, attributes and the 10 Hz engine strip all follow.
  await expect(page.locator('#groove-load-preset')).toHaveText('Завантажити трек');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Зупинено');
  await expect(page.locator('#help-open')).toHaveAttribute('aria-label', 'Відкрити довідку');
  await expect(page.locator('#status-text')).toHaveText('Готово');
  // Area names, machines and song titles stay as they are.
  await expect(page.locator('#ws-groove')).toContainText('Groove');
  await expect(page.locator('#groove-preset option').first()).toContainText('Neon Afterimage');

  // Text written after the switch is translated as it arrives, including interpolated messages.
  await page.locator('#perform-pad-0').dispatchEvent('dblclick');
  await page.locator('#ws-synth').click();
  await expect(page.locator('#synth-workspace .ws-title')).not.toHaveText('After dark synthesizer');
  await page.locator('#performance-toggle').click();
  await expect(page.locator('#performance-panel .ws-title')).toHaveText('Студія виступу');
  await expect(page.locator('#jam-listen')).toHaveText('1 · Слухати мою фразу');
  await expect(page.locator('[data-scene-recall="0"]')).toHaveAttribute('aria-label', 'Викликати сцену 1');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  await expect(page.locator('#lang-select')).toHaveValue('uk');
  await expect(page.locator('#groove-load-preset')).toHaveText('Завантажити трек');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Зупинено');

  // Back to English: every node returns to its source text.
  await page.locator('#lang-select').selectOption('en');
  await expect(page.locator('#groove-load-preset')).toHaveText('Load track');
  await expect(page.locator('#engine-groove .engine-state')).toHaveText('Stopped');
  await expect(page.locator('#help-open')).toHaveAttribute('aria-label', 'Open help sheet');
  await expect(page.locator('#status-text')).toHaveText('Ready');
  const cyrillic = await page.evaluate(() => {
    const found = [];
    const walker = document.createTreeWalker(document.querySelector('.studio'), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (/[Ѐ-ӿ]/.test(node.data) && !node.parentElement.closest('[data-i18n-skip], #groove-preset'))
        found.push(node.data.trim());
    return found;
  });
  expect(cyrillic).toEqual([]);
});

test('a first visit follows the browser language', async ({browser}) => {
  const context = await browser.newContext({locale: 'uk-UA'});
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  await expect(page.locator('#groove-load-preset')).toHaveText('Завантажити трек');
  await context.close();
});

test('Ukrainian keeps the interface inside the viewport and every static string translated', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('afterhours-lang', 'uk'));
  await page.goto('/');
  await page.locator('#performance-toggle').click();
  await page.locator('#controller-toggle').click();
  for (const width of [390, 900, 1280, 1440]) {
    await page.setViewportSize({width, height: 900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(page.locator('#help-open')).toBeInViewport();
    await expect(page.locator('#lang-select')).toBeInViewport();
  }
  // Headings, buttons, labels and hints that still read as English prose are missing keys.
  const untranslated = await page.evaluate(() => {
    const keep =
      /^(after|hours|Groove|Synth|Perform|Control|Listen|AI|Ardour|MIDI|BPM|FILL|TRIG LOCK|LFO|USB MIDI|MPK mini|Surge XT|Mute|BANK [−+]|Night Bass|Chord|librosa \+ NumPy|api\.openai\.com|[A-G][♯♭]?|English)$/;
    const found = [];
    for (const node of document.querySelectorAll(
      '.studio :is(h2, h3, summary, button, label, .hint, .micro-label, dt, dd, strong)',
    )) {
      if (
        node.closest(
          '[data-i18n-skip], #groove-grid, #synth-patches, #groove-patterns, #perform-pads, #perform-patterns',
        )
      )
        continue;
      for (const child of node.childNodes) {
        const text = child.nodeType === Node.TEXT_NODE ? child.data.trim() : '';
        if (/[A-Za-z]{3,}/.test(text) && !/[Ѐ-ӿ]/.test(text) && !keep.test(text)) found.push(text);
      }
    }
    return [...new Set(found)];
  });
  expect(untranslated).toEqual([]);
});
