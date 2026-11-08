import { cardConfig, departure, expect, NOW, PIN_KEY, test } from './fixtures';
import { callHA, dashboard, setCardConfig, setDashboard } from './ha';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('home-assistant')).toBeVisible();
  await page.clock.install({ time: NOW });
});

for (const outcome of ['success', 'empty', 'failure'] as const) {
  test(`loading states: ${outcome} ends initial loading with the expected result`, async ({ page, api }) => {
    const gate = api.hold('test-stop');
    await setDashboard(page, dashboard([cardConfig()]));
    await gate.started;
    const card = page.locator('vasttrafik-home-assistant-card');
    await expect(card.getByRole('status')).toBeVisible();
    gate.release(
      outcome === 'failure'
        ? { status: 500, headers: { 'Retry-After': '120' } }
        : { results: outcome === 'success' ? [departure('a', '7', 10)] : [] },
    );
    await expect(card.getByRole('status')).toHaveCount(0);
    if (outcome === 'success') {
      await expect(card.locator('vt-header')).toContainText('Test stop');
      await expect(card.locator('vt-time-table-row .direction')).toHaveText('Centrum');
      await expect(card.locator('.time-until-departure').first()).toHaveText('10');
    } else if (outcome === 'empty') {
      await expect(card.locator('vt-time-table')).toBeVisible();
      await expect(card.locator('vt-time-table-row')).toHaveCount(0);
    } else await expect(card.getByRole('alert')).toContainText('500');
  });
}

test('failed same-stop refresh retains previously displayed departures', async ({ page, api }) => {
  await setDashboard(page, dashboard([cardConfig({ refresh_interval: 10 })]));
  await expect(page.locator('vt-time-table-row')).toBeVisible();
  api.respond('test-stop', { status: 500, headers: { 'Retry-After': '120' } });
  await page.clock.runFor(10_100);
  await expect(page.getByRole('alert')).toContainText('500');
  await expect(page.locator('vt-time-table-row .direction')).toHaveText('Centrum');
});

test('badge sizing shrinks long names and restores normal font for short names', async ({ page, api }) => {
  await setDashboard(page, dashboard([cardConfig()]));
  for (const [line, rem] of [
    ['123', 1.75],
    ['1234', 1],
    ['12345', 1],
    ['7', 1.75],
  ] as const) {
    api.respond('test-stop', { results: [departure('a', line, 10)] });
    await setCardConfig(page, cardConfig());
    const badge = page.locator('.line-badge');
    await expect(badge).toHaveText(line);
    const actual = await badge.evaluate((element) => ({
      size: parseFloat(getComputedStyle(element).fontSize),
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    }));
    expect(actual.size).toBe(actual.rem * rem);
  }
});

test('journey pin identity, multiple pins, ordering and unpin survive real dashboard reloads', async ({
  page,
  api,
}) => {
  const a = departure('a', '1', 5);
  const b = departure('b', '7', 10);
  const c = departure('c', '11', 15);
  const bOtherPlatform = departure('b', '7', 20, { stopPoint: { name: 'Test stop', platform: 'B' } });
  const other = departure('other', '7', 25, {
    serviceJourney: { ...b.serviceJourney, gid: 'other', direction: 'Elsewhere' },
  });
  api.respond('test-stop', { results: [a, b, c, bOtherPlatform, other] });
  await setDashboard(page, dashboard([cardConfig()]));
  const rows = page.locator('vt-time-table-row');
  const ids = () =>
    rows.evaluateAll((elements) =>
      elements.map(
        (element: Element & { departureGroup?: Array<{ serviceJourney: { gid: string } }> }) =>
          element.departureGroup?.[0].serviceJourney.gid,
      ),
    );
  await expect(rows).toHaveCount(5);
  await rows.nth(1).locator('.direction').click();
  await expect.poll(ids).toEqual(['b', 'b', 'a', 'c', 'other']);
  await expect(page.locator('vt-time-table-row[pinned]')).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Elsewhere' })).not.toHaveAttribute('pinned');
  await page
    .locator('.line-badge')
    .filter({ hasText: /^\s*11\s*$/ })
    .click();
  await expect.poll(ids).toEqual(['b', 'c', 'b', 'a', 'other']);
  await rows.first().click();
  await expect.poll(ids).toEqual(['c', 'a', 'b', 'b', 'other']);
  await page.reload();
  await expect.poll(ids).toEqual(['c', 'a', 'b', 'b', 'other']);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), PIN_KEY)).toEqual(['c']);
  const highlight = await rows.first().evaluate((row) => ({
    background: getComputedStyle(row).backgroundColor,
    opacity: getComputedStyle(row).opacity,
    textOpacity: getComputedStyle(row.shadowRoot!.querySelector('.direction')!).opacity,
    badgeOpacity: getComputedStyle(row.shadowRoot!.querySelector('.line-badge')!).opacity,
  }));
  const alpha = highlight.background.includes('/')
    ? Number(highlight.background.split('/')[1].replace(')', '').trim())
    : Number(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(highlight.background)?.[1]);
  expect(alpha).toBeCloseTo(0.1, 3);
  expect([highlight.opacity, highlight.textOpacity, highlight.badgeOpacity]).toEqual(['1', '1', '1']);
  api.respond('test-stop', { results: [] });
  await setCardConfig(page, cardConfig());
  await expect(rows).toHaveCount(0);
  api.respond('other-stop', { results: [b, c] });
  await setCardConfig(page, cardConfig({ gid: 'other-stop' }));
  await expect.poll(ids).toEqual(['c', 'b']);
});

test('multiple cards and real same-origin tabs synchronize pins without overwriting preferences', async ({
  page,
  context,
  api,
}) => {
  api.respond('test-stop', { results: [departure('a', '1', 5), departure('b', '7', 10), departure('c', '11', 15)] });
  await setDashboard(page, dashboard([cardConfig(), cardConfig()]));
  const cards = page.locator('vasttrafik-home-assistant-card');
  await expect(page.locator('vt-time-table-row')).toHaveCount(6);
  await cards
    .first()
    .locator('.line-badge')
    .filter({ hasText: /^\s*7\s*$/ })
    .click();
  await expect(cards.nth(1).locator('[pinned]')).toHaveCount(1);
  await cards
    .nth(1)
    .locator('.line-badge')
    .filter({ hasText: /^\s*11\s*$/ })
    .click();
  await expect(cards.first().locator('[pinned]')).toHaveCount(2);
  const second = await context.newPage();
  try {
    await second.goto('/integration-test/main');
    await expect(second.locator('vt-time-table-row[pinned]')).toHaveCount(4);
    await second
      .locator('vasttrafik-home-assistant-card')
      .first()
      .locator('.line-badge')
      .filter({ hasText: /^\s*1\s*$/ })
      .click();
    await expect(cards.first().locator('[pinned]')).toHaveCount(3);
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), PIN_KEY)).toEqual(['b', 'c', 'a']);
  } finally {
    await second.close();
  }
});

test('navigation cancellation stops detached polling and reconnect refreshes without overlap', async ({
  page,
  api,
}) => {
  const gate = api.hold('test-stop');
  await setDashboard(page, dashboard([cardConfig({ refresh_interval: 10 })]));
  await gate.started;
  await page.getByRole('tab', { name: 'Other', exact: true }).click();
  await expect(page.locator('vasttrafik-home-assistant-card')).toHaveCount(0);
  gate.release({ results: [departure('obsolete', '99', 10)] });
  const requests = api.requests.length;
  await page.clock.runFor(60_000);
  expect(api.requests).toHaveLength(requests);
  api.respond('test-stop', { results: [departure('new', '7', 10)] });
  await page.getByRole('tab', { name: 'Main', exact: true }).click();
  await expect(page.locator('.line-badge')).toHaveText('7');
  expect(api.requests.filter((request) => request.url().includes('/departures?'))).toHaveLength(2);
});

test('stop-change race only renders the latest stop and cancels obsolete requests', async ({ page, api }) => {
  const gate = api.hold('test-stop');
  await setDashboard(page, dashboard([cardConfig()]));
  await gate.started;
  api.respond('new-stop', { results: [departure('new', '7', 10, { stopPoint: { name: 'New stop', platform: 'A' } })] });
  await setCardConfig(page, cardConfig({ gid: 'new-stop' }));
  await expect(page.locator('vt-header')).toContainText('New stop');
  gate.release({ results: [departure('old', '99', 10, { stopPoint: { name: 'Obsolete stop', platform: 'A' } })] });
  await expect(page.locator('vt-header')).toContainText('New stop');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const obsolete = api.requests.find((request) => request.url().includes('/test-stop/departures?'))!;
  await expect.poll(() => obsolete.failure()?.errorText).toContain('ERR_ABORTED');
  expect(api.requests.filter((request) => request.url().includes('/new-stop/departures?'))).toHaveLength(1);
});

test('Retry-After deferral waits 120 seconds before the next refresh', async ({ page, api }) => {
  api.respond('test-stop', { status: 429, headers: { 'Retry-After': '120' } });
  await setDashboard(page, dashboard([cardConfig({ refresh_interval: 10 })]));
  await expect(page.getByRole('alert')).toContainText('429');
  const count = api.requests.filter((request) => request.url().includes('/departures?')).length;
  api.respond('test-stop', { results: [departure('a', '7', 10)] });
  await page.clock.runFor(119_000);
  expect(api.requests.filter((request) => request.url().includes('/departures?'))).toHaveLength(count);
  await page.clock.runFor(1100);
  await expect(page.locator('vt-time-table-row')).toBeVisible();
  expect(api.requests.filter((request) => request.url().includes('/departures?'))).toHaveLength(count + 1);
});

for (const type of ['masonry', 'sections']) {
  for (const width of [390, 1280]) {
    test(`${type} layout at ${width}px uses configured height and real light/dark HA themes`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await setDashboard(page, dashboard([cardConfig({ time_table_height: 350 })], type));
      const card = page.locator('vasttrafik-home-assistant-card');
      await expect(card.locator('vt-time-table-row')).toBeVisible();
      const colors: string[] = [];
      for (const theme of ['light', 'dark']) {
        await page.locator('home-assistant-main').evaluate(
          (main, dark) =>
            main.dispatchEvent(
              new CustomEvent('settheme', {
                detail: { theme: 'default', dark },
                bubbles: true,
                composed: true,
              }),
            ),
          theme === 'dark',
        );
        await expect
          .poll(() =>
            page
              .locator('home-assistant')
              .evaluate((host: HTMLElement & { hass: { themes: { darkMode: boolean } } }) => host.hass.themes.darkMode),
          )
          .toBe(theme === 'dark');
        const measurements = await card.locator('vt-time-table').evaluate((table) => ({
          height: table.getBoundingClientRect().height,
          width: table.clientWidth,
          scrollWidth: table.scrollWidth,
          color: getComputedStyle(table).getPropertyValue('--primary-text-color').trim(),
        }));
        expect(measurements.height).toBe(350);
        expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.width + 1);
        expect(measurements.color).not.toBe('');
        colors.push(measurements.color);
      }
      expect(colors[0]).not.toBe(colors[1]);
      // Actual captures support diagnosis; these are not pixel-golden assertions.
      await page.screenshot({ path: `test-results/layout-${type}-${width}.png` });
      const saved = await callHA<{ views: unknown[] }>(page, { type: 'lovelace/config', url_path: 'integration-test' });
      expect(saved.views).toHaveLength(2);
    });
  }
}
