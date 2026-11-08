import { cardConfig, departure, expect, test } from './fixtures';
import { callHA, dashboard, openEditor, setCardConfig, setDashboard, setLanguage, type DashboardConfig } from './ha';

test('departure automation controls save, reopen, localize and clear optional settings', async ({ page }) => {
  await setDashboard(page, dashboard([cardConfig({ grid_options: { columns: 12 } })]));
  const editor = await openEditor(page);
  const selector = editor.locator('ha-selector-entity');
  await expect(selector).toBeVisible();
  await selector.click();
  // The choice's headline is slotted outside its inner listitem button.
  await selector.locator('ha-combo-box-item').filter({ hasText: 'Integration departure trigger' }).click();
  await expect
    .poll(() => selector.evaluate((element) => (element as HTMLElement & { value?: string }).value))
    .toBe('automation.integration_departure_trigger');
  await expect(editor.getByRole('spinbutton', { name: 'Minutes before departure', exact: true })).toHaveValue('5');
  await editor.getByRole('spinbutton', { name: 'Minutes before departure', exact: true }).fill('10');
  await editor.getByRole('spinbutton', { name: 'Minutes before departure', exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  let saved = await callHA<DashboardConfig>(page, { type: 'lovelace/config', url_path: 'integration-test' });
  expect(saved.views[0].cards?.[0]).toMatchObject({
    automation_entity: 'automation.integration_departure_trigger',
    departure_trigger_minutes: 10,
  });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(editor.getByRole('spinbutton', { name: 'Minutes before departure', exact: true })).toHaveValue('10');
  await editor.locator('ha-selector-select').click();
  await page.getByRole('menuitem', { name: 'Swedish', exact: true }).click();
  await expect(editor.getByRole('spinbutton', { name: 'Minuter före avgång', exact: true })).toBeVisible();
  await expect(selector).toContainText('Avgångsautomation');
  await editor.locator('ha-selector-select').click();
  await page.getByRole('menuitem', { name: 'Engelska', exact: true }).click();
  await expect(editor.getByRole('spinbutton', { name: 'Minutes before departure', exact: true })).toBeVisible();
  await selector.getByRole('button').click();
  await expect.poll(() => selector.evaluate((element) => (element as HTMLElement & { value?: string }).value)).toBe('');
  await editor.getByRole('spinbutton', { name: 'Minutes before departure', exact: true }).fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  saved = await callHA<DashboardConfig>(page, { type: 'lovelace/config', url_path: 'integration-test' });
  expect(saved.views[0].cards?.[0]).not.toHaveProperty('automation_entity');
  expect(saved.views[0].cards?.[0]).not.toHaveProperty('departure_trigger_minutes');
  expect(saved.views[0].cards?.[0]).toMatchObject({
    client_id: 'dummy-client',
    client_secret: 'dummy-secret',
    grid_options: { columns: 12 },
  });
});

test('invalid timetable heights retain a finite error-card layout size', async ({ page }) => {
  await setDashboard(page, dashboard([cardConfig()]));
  const card = page.locator('vasttrafik-home-assistant-card');
  await expect(card.locator('vt-time-table-row')).toBeVisible();
  for (const height of [NaN, Infinity, 0, -1, '400']) {
    await setCardConfig(page, { ...cardConfig(), time_table_height: height });
    await expect(card).toContainText('Timetable height');
    expect(await card.evaluate((element: HTMLElement & { getCardSize(): number }) => element.getCardSize())).toBe(1);
  }
});

test('departure automation editor stays usable at narrow and wide dashboard sizes', async ({ page }) => {
  await setDashboard(
    page,
    dashboard([
      cardConfig({ automation_entity: 'automation.integration_departure_trigger', departure_trigger_minutes: 5 }),
    ]),
  );
  const editor = await openEditor(page);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const threshold = editor.getByRole('spinbutton', { name: 'Minutes before departure', exact: true });
    await threshold.scrollIntoViewIfNeeded();
    await expect(threshold).toBeVisible();
    await expect(editor.locator('ha-selector-entity')).toContainText('Integration departure trigger');
    const bounds = await threshold.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/departure-automation-editor-${width}.png` });
  }
});

test('editor edits real text controls and saves/reopens configuration', async ({ page, api }) => {
  api.respond('other-stop', { results: [departure('other-journey', '7', 10)] });
  await setDashboard(page, {
    title: 'Integration tests',
    views: [{ title: 'Main', path: 'main', cards: [cardConfig({ grid_options: { columns: 12 } })] }],
  });
  await expect(page.locator('vt-time-table-row')).toBeVisible();
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const editor = page.locator('vasttrafik-card-editor');
  await expect(editor.getByRole('textbox', { name: 'Stop name', exact: true })).toBeVisible();
  await editor.getByRole('textbox', { name: 'Stop name', exact: true }).fill('Configured stop');
  await editor.getByRole('textbox', { name: 'Stop GID', exact: true }).fill('other-stop');
  await editor.getByRole('textbox', { name: 'Client ID', exact: true }).fill('dummy-updated-client');
  await editor.getByRole('textbox', { name: 'Client secret', exact: true }).fill('dummy-updated-secret');
  await editor.getByRole('spinbutton', { name: 'Timetable height', exact: false }).fill('350');
  await editor.getByRole('spinbutton', { name: 'Departure limit', exact: false }).fill('20');
  await editor.getByRole('spinbutton', { name: 'Refresh interval', exact: false }).fill('30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await callHA<DashboardConfig>(page, { type: 'lovelace/config', url_path: 'integration-test' });
  expect(saved.views[0].cards?.[0]).toMatchObject({
    stop_name: 'Configured stop',
    gid: 'other-stop',
    client_id: 'dummy-updated-client',
    client_secret: 'dummy-updated-secret',
    time_table_height: 350,
    limit: 20,
    refresh_interval: 30,
    grid_options: { columns: 12 },
  });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(editor.getByRole('textbox', { name: 'Stop GID', exact: true })).toHaveValue('other-stop');
  await expect(editor.getByRole('spinbutton', { name: 'Departure limit', exact: false })).toHaveValue('20');
});

test('card editor exposes its documentation help link', async ({ page }) => {
  await setDashboard(page, dashboard([cardConfig()]));
  await openEditor(page);
  const help = page.locator(
    'ha-icon-button[title="Help"][href="https://github.com/lindman-carl/vasttrafik-home-assistant-card#readme"]',
  );
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute('target', '_blank');
});

test('a user can add the card from the real Home Assistant card picker', async ({ page, api }) => {
  // HA's built-in picture-card previews are intentionally offline; no HA API or
  // controls are mocked, and every other unknown external request still fails.
  api.blockKnownHAPreviewImages = true;
  await setDashboard(page, dashboard([]));
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await page.getByRole('button', { name: 'Browse all cards', exact: true }).click();
  await page.getByPlaceholder('Search cards', { exact: true }).fill('Västtrafik');
  await page
    .locator('hui-card-picker .card')
    .filter({ hasText: 'Västtrafik Home Assistant Card' })
    .locator('.overlay')
    .click();
  const editor = page.locator('vasttrafik-card-editor');
  await expect(editor).toBeVisible();
  await editor.getByRole('textbox', { name: 'Stop GID', exact: true }).fill('test-stop');
  await editor.getByRole('textbox', { name: 'Client ID', exact: true }).fill('dummy-client');
  await editor.getByRole('textbox', { name: 'Client secret', exact: true }).fill('dummy-secret');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('vt-time-table-row')).toBeVisible();
  const saved = await callHA<DashboardConfig>(page, { type: 'lovelace/config', url_path: 'integration-test' });
  expect(saved.views[0].cards?.[0].type).toBe('custom:vasttrafik-home-assistant-card');
});

test('real language selector supports overrides and clearing back to automatic', async ({ page }) => {
  await setDashboard(page, dashboard([cardConfig()]));
  const editor = await openEditor(page);
  await editor.locator('ha-selector-select').click();
  await page.getByRole('menuitem', { name: 'Swedish', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'Hållplatsnamn', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('vt-time-table-header')).toContainText('Linje');
  let saved = await callHA<DashboardConfig>(page, { type: 'lovelace/config', url_path: 'integration-test' });
  expect(saved.views[0].cards?.[0].language).toBe('sv');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await editor.locator('ha-selector-select').click();
  await page.getByRole('menuitem', { name: 'Engelska', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'Stop name', exact: true })).toBeVisible();
  await editor.locator('ha-selector-select').click();
  await page.getByRole('menuitem', { name: 'Automatic (Home Assistant language)', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  saved = await callHA<DashboardConfig>(page, { type: 'lovelace/config', url_path: 'integration-test' });
  expect(saved.views[0].cards?.[0]).not.toHaveProperty('language');
  await expect(page.locator('vt-time-table-header')).toContainText('Line');
});

test('real editor clearing optional fields restores defaults and preserves credentials', async ({ page }) => {
  await setDashboard(page, dashboard([cardConfig({ stop_name: 'Test stop', limit: 20, language: 'sv' })]));
  const editor = await openEditor(page);
  await editor.getByRole('textbox', { name: 'Hållplatsnamn', exact: true }).fill('');
  await editor.getByRole('textbox', { name: 'Hållplatsens GID', exact: true }).fill('');
  await editor.getByRole('spinbutton', { name: 'Antal avgångar', exact: false }).fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await callHA<DashboardConfig>(page, { type: 'lovelace/config', url_path: 'integration-test' });
  expect(saved.views[0].cards?.[0]).not.toHaveProperty('gid');
  expect(saved.views[0].cards?.[0]).not.toHaveProperty('limit');
  expect(saved.views[0].cards?.[0]).toMatchObject({ client_id: 'dummy-client', client_secret: 'dummy-secret' });
});

test('unrelated real Home Assistant state updates do not rerender the card', async ({ page }) => {
  await setDashboard(page, dashboard([cardConfig()]));
  const card = page.locator('vasttrafik-home-assistant-card');
  await expect(card.locator('vt-time-table-row')).toBeVisible();
  await expect(card.locator('vt-header vt-spinner')).toHaveCount(0);
  await card.evaluate((element: HTMLElement & { render(): unknown }) => {
    const render = element.render;
    element.dataset.renders = '0';
    element.render = function () {
      this.dataset.renders = String(Number(this.dataset.renders) + 1);
      return render.call(this);
    };
  });
  await callHA(page, {
    type: 'call_service',
    domain: 'input_boolean',
    service: 'toggle',
    target: { entity_id: 'input_boolean.integration_noise' },
  });
  await expect
    .poll(() =>
      page
        .locator('home-assistant')
        .evaluate(
          (host: HTMLElement & { hass: { states: Record<string, { state: string }> } }) =>
            host.hass.states['input_boolean.integration_noise'].state,
        ),
    )
    .toBe('on');
  await expect(card).toHaveAttribute('data-renders', '0');
  await setLanguage(page, 'sv');
  await expect(card.locator('vt-time-table-header')).toContainText('Linje');
  await expect.poll(() => card.getAttribute('data-renders')).not.toBe('0');
});

test('actual HA locale and explicit card override control nested text and validation errors', async ({ page, api }) => {
  await setDashboard(page, dashboard([cardConfig()]));
  for (const [locale, language, expected] of [
    ['en', 'sv', 'Klient-ID måste anges.'],
    ['sv', 'en', 'Client ID is required.'],
    ['sv', undefined, 'Klient-ID måste anges.'],
    ['de', undefined, 'Client ID is required.'],
  ] as const) {
    await setLanguage(page, locale);
    const before = api.requests.length;
    await setCardConfig(page, { type: 'custom:vasttrafik-home-assistant-card', language });
    await expect(page.locator('vasttrafik-home-assistant-card')).toContainText(expected);
    expect(api.requests).toHaveLength(before);
  }
  await setLanguage(page, 'sv');
  await setCardConfig(page, cardConfig({ language: 'en' }));
  await expect(page.locator('vt-time-table-header')).toContainText('Line');
  await setCardConfig(page, cardConfig());
  await expect(page.locator('vt-time-table-header')).toContainText('Linje');
});

test('card provides accurate masonry size and content-driven Sections sizing', async ({ page }) => {
  await setDashboard(page, {
    title: 'Integration tests',
    views: [{ title: 'Main', path: 'main', cards: [cardConfig({ time_table_height: 350 })] }],
  });
  const card = page.locator('vasttrafik-home-assistant-card');
  await expect(page.locator('vt-time-table-row')).toBeVisible();
  const size = await card.evaluate((element: HTMLElement & { getCardSize?(): number; getGridOptions?(): unknown }) => ({
    masonry: element.getCardSize?.(),
    grid: element.getGridOptions?.(),
    height: element.getBoundingClientRect().height,
  }));
  expect(size.masonry).toBe(Math.ceil(size.height / 50));
  expect(size.grid).toEqual({ columns: 12, min_columns: 6, rows: 'auto' });
});
