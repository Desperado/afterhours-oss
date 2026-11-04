// @ts-check
const {test, expect} = require('@playwright/test');

const session = {sessionName: 'Night Session', tempoBpm: 93, sampleRate: 48000, transport: {rolling: false, sample: 0}};
const surge = {index: 0, name: 'Surge XT'};
const tracks = [
  {id: '11', name: 'Night Bass', type: 'midi', db: -6, plugins: [surge]},
  {id: '12', name: 'Shadow Pad', type: 'midi', db: -200, plugins: [surge]},
  {id: '13', name: 'Broken Beat', type: 'midi', db: 0, plugins: [{index: 0, name: 'General MIDI Synth'}]},
];
const description = {
  plugin: {uniqueId: 'surge-xt', name: 'Surge XT'},
  parameters: [
    {index: 232, label: 'A FM Routing', isInput: true, isControl: true, isHidden: false, currentInterface: 0.005},
    {index: 233, label: 'A FM Depth', isInput: true, isControl: true, isHidden: false, currentInterface: 0.5},
    {index: 319, label: 'A Filter 1 Cutoff', isInput: true, isControl: true, isHidden: false, currentInterface: 0.65},
  ],
};

// A fake AFTERHOURS backend: records commands and lets a test fail the next fader write.
async function mockArdour(page) {
  const sent = [],
    state = {
      failFader: false,
      failParameter: false,
      failCommand: null,
      holdWrite: null,
      rolling: false,
      sample: 0,
      polls: 0,
    };
  // Transport state follows the commands, so status polling agrees with what the test pressed.
  await page.route('**/api/daw/state', route => {
    state.polls++;
    return route.fulfill({json: {...session, transport: {rolling: state.rolling, sample: state.sample}}});
  });
  await page.route('**/api/daw', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({json: {connected: true, session, tracks, omitted_tracks: 0}});
    const body = request.postDataJSON();
    sent.push(body);
    if (state.failCommand === body.action) {
      state.failCommand = null;
      return route.fulfill({status: 503, json: {error: 'Ardour did not confirm this command.'}});
    }
    if (body.action === 'fader' || body.action === 'parameter') await state.holdWrite;
    if (body.action === 'inspect_plugin') return route.fulfill({json: description});
    if (body.action === 'parameter') {
      if (state.failParameter) {
        state.failParameter = false;
        return route.fulfill({status: 503, json: {error: 'Ardour is unavailable.'}});
      }
      return route.fulfill({json: {interface: body.interface}});
    }
    if (body.action === 'fader') {
      if (state.failFader) {
        state.failFader = false;
        return route.fulfill({status: 503, json: {error: 'Ardour is unavailable.'}});
      }
      return route.fulfill({json: {db: body.db}});
    }
    if (body.action === 'play' || body.action === 'stop') state.rolling = body.action === 'play';
    return route.fulfill({json: {rolling: state.rolling, sample: 0, saved: true}});
  });
  return {sent, state};
}
const setRange = (locator, value) =>
  locator.evaluate((input, v) => {
    input.value = String(v);
    input.dispatchEvent(new Event('input'));
  }, value);
const connect = page => page.getByRole('button', {name: 'Connect', exact: true}).click();

test('faders spend their travel on audible gain and bottom out at −∞', async ({page}) => {
  const {sent} = await mockArdour(page);
  await page.goto('/');
  await page.locator('#ws-ardour').click();
  await connect(page);
  const bass = page.getByLabel('Night Bass gain in Ardour'),
    pad = page.getByLabel('Shadow Pad gain in Ardour');
  await expect(bass).toHaveAttribute('min', '-61');
  await expect(bass).toHaveAttribute('max', '6');
  await expect(pad).toHaveValue('-61');
  await setRange(bass, -61);
  await expect.poll(() => sent.filter(c => c.action === 'fader').at(-1)?.db).toBe(-193);
  await setRange(bass, -12.5);
  await expect.poll(() => sent.filter(c => c.action === 'fader').at(-1)?.db).toBe(-12.5);
});

test('a failed fader write keeps the session connected and restores the gain', async ({page}) => {
  const {state} = await mockArdour(page);
  await page.goto('/');
  await page.locator('#ws-ardour').click();
  await connect(page);
  const bass = page.getByLabel('Night Bass gain in Ardour');
  state.failFader = true;
  await setRange(bass, 3);
  await expect(page.locator('#daw-status')).toContainText('Night Bass: Ardour is unavailable.');
  await expect(page.locator('#daw-badge')).toContainText('Connected');
  await expect(page.locator('#daw-session')).toBeVisible();
  await expect(bass).toHaveValue('-6');
});

test('the sound editor can target any Surge XT track', async ({page}) => {
  const {sent} = await mockArdour(page);
  await page.goto('/');
  await page.locator('#ws-ardour').click();
  await connect(page);
  await expect(page.locator('#bass-title')).toHaveText('Night Bass');
  const picker = page.locator('#bass-track');
  await expect(picker).toBeVisible();
  await expect(picker.locator('option')).toHaveText(['Night Bass', 'Shadow Pad']);
  await picker.selectOption({label: 'Shadow Pad'});
  await expect(page.locator('#bass-title')).toHaveText('Shadow Pad');
  await expect(page.locator('#bass-status')).toContainText('Live on Shadow Pad');
  // The shared knob widget is a role=slider div: Home goes to minimum, PageUp is a tenth of range.
  const brightness = page.getByRole('slider', {name: 'Shadow Pad Brightness'});
  await brightness.focus();
  await brightness.press('Home');
  for (let i = 0; i < 3; i++) await brightness.press('PageUp');
  await expect
    .poll(() => sent.filter(c => c.action === 'parameter').at(-1))
    .toMatchObject({id: '12', parameterIndex: 319, interface: 0.3});
  expect(sent.filter(c => c.action === 'inspect_plugin').map(c => c.id)).toEqual(['11', '12']);
});

test('a connected Ardour becomes a strip engine with its own clock', async ({page}) => {
  const {sent} = await mockArdour(page);
  await page.goto('/');
  await page.locator('#ws-ardour').click();
  await connect(page);
  await expect(page.locator('#engine-ardour .engine-state')).toHaveText('Ready');
  await page.locator('#engine-ardour').click();
  await expect(page.locator('#transport-position-label')).toHaveText('Ardour · time');
  await expect(page.locator('#transport-tempo')).toHaveValue('93');
  await page.locator('#transport-play').click();
  await expect.poll(() => sent.map(c => c.action)).toContain('play');
  await expect(page.locator('#engine-ardour .engine-state')).toHaveText('Playing');
  await expect(page.locator('#engine-groove')).toHaveAttribute('aria-checked', 'false');
});

test('the offline screen explains itself and a failed connect shows the error inline', async ({page}) => {
  await page.route('**/api/daw', route => route.fulfill({status: 503, json: {error: 'Ardour is not running.'}}));
  await page.goto('/');
  await page.locator('#ws-ardour').click();
  await expect(page.locator('#daw-offline')).toBeVisible();
  await expect(page.locator('#daw-session')).toBeHidden();
  await expect(page.locator('#daw-offline-title')).toHaveText('Ardour isn’t connected');
  await page.getByRole('button', {name: 'Setup details ?'}).click();
  await expect(page.locator('#daw-setup')).toBeVisible();
  await connect(page);
  await expect(page.locator('#daw-offline-title')).toHaveText('Ardour isn’t answering');
  await expect(page.locator('#daw-error')).toContainText('Ardour is not running.');
  await expect(page.locator('#daw-session')).toBeHidden();
});

test('regression: a disabled sound knob keeps its confirmed value on keyboard input', async ({page}) => {
  const {sent, state} = await mockArdour(page);
  await page.goto('/');
  await page.locator('#ws-ardour').click();
  await connect(page);
  const knob = page.getByRole('slider', {name: 'Night Bass Brightness'});
  state.failParameter = true;
  await knob.focus();
  await knob.press('End');
  await expect(knob).toHaveAttribute('aria-disabled', 'true');
  await expect(knob).toHaveAttribute('aria-valuenow', '0.65');
  const writes = sent.filter(c => c.action === 'parameter').length;
  for (const key of ['End', 'Home', 'ArrowUp', 'Delete']) await knob.press(key);
  await expect(knob).toHaveAttribute('aria-valuenow', '0.65');
  expect(sent.filter(c => c.action === 'parameter').length).toBe(writes);
});

test('regression: Ardour polling recovers its clock after a command fails', async ({page}) => {
  const {state} = await mockArdour(page);
  await page.goto('/');
  await page.locator('#ws-ardour').click();
  await connect(page);
  await page.locator('#engine-ardour').click();
  await page.locator('#transport-play').click();
  await expect(page.locator('#engine-ardour .engine-state')).toHaveText('Playing');
  state.failCommand = 'stop';
  await page.locator('#transport-stop').click();
  await expect(page.locator('#daw-status')).toHaveText('Ardour did not confirm this command.');
  const polls = state.polls;
  state.rolling = false;
  state.sample = 1440000; // Native Ardour stops at 30 seconds.
  await expect.poll(() => state.polls, {timeout: 5000}).toBeGreaterThan(polls);
  await expect(page.locator('#engine-ardour .engine-state')).toHaveText('Ready');
  await expect(page.locator('#transport-position')).toHaveText('00:30.0');
  await expect(page.locator('#status-text')).toHaveText('Ardour did not confirm this command.');
});

for (const [write, stop] of [
  ['fader', 'button'],
  ['parameter', 'space'],
  ['fader', 'toggle'],
]) {
  test(`regression: Ardour Stop via ${stop} remains available during a pending ${write} write`, async ({page}) => {
    const {sent, state} = await mockArdour(page);
    await page.goto('/');
    await page.locator('#ws-ardour').click();
    await connect(page);
    await page.locator('#engine-ardour').click();
    await page.locator('#transport-play').click();
    await expect(page.locator('#engine-ardour .engine-state')).toHaveText('Playing');
    let release;
    state.holdWrite = new Promise(resolve => {
      release = resolve;
    });
    try {
      if (write === 'fader') await setRange(page.getByLabel('Night Bass gain in Ardour'), -12);
      else await page.getByRole('slider', {name: 'Night Bass Brightness'}).press('End');
      await expect.poll(() => sent.filter(c => c.action === write).length).toBe(1);
      await page.evaluate(() => AfterhoursShell.render());
      await expect(page.locator('#transport-start')).toBeDisabled();
      await expect(page.locator('#transport-stop')).toBeEnabled();
      await expect(page.locator('#transport-play')).toBeEnabled();
      if (stop === 'space') {
        await page.evaluate(() => document.activeElement.blur());
        await page.keyboard.press('Space');
      } else await page.locator(stop === 'toggle' ? '#transport-play' : '#transport-stop').click();
      await expect.poll(() => sent.filter(c => c.action === 'stop').length).toBe(1);
      await expect(page.locator('#engine-ardour .engine-state')).toHaveText('Ready');
      await expect(page.locator('#transport-play')).toBeDisabled();
      await expect(page.locator('#transport-start')).toBeDisabled();
      await expect(page.locator('#transport-stop')).toBeEnabled();
      release();
      await expect(page.locator('#transport-play')).toBeEnabled();
      await expect(page.locator('#transport-start')).toBeEnabled();
    } finally {
      release();
    }
  });
}
