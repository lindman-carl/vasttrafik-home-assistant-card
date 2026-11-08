import type { Page } from '@playwright/test';
import type { Departure } from '../../src/departures/types';
import { cardConfig, departure, expect, NOW, test } from './fixtures';
import { callHA, dashboard, setCardConfig, setDashboard } from './ha';

const AUTOMATION = 'automation.integration_departure_trigger';
const COUNTER = 'counter.integration_departure_triggers';
const ALLOWED = 'input_boolean.integration_departure_allowed';
const pausedPages = new WeakSet<Page>();
const config = (overrides = {}) => cardConfig({ automation_entity: AUTOMATION, refresh_interval: 3600, ...overrides });
const first = () => departure('a', '7', 6);
const revised = (minutes: number): Departure => ({
  ...first(),
  estimatedOtherwisePlannedTime: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
});

async function state(page: Page, entity: string): Promise<string | undefined> {
  const states = await callHA<Array<{ entity_id: string; state: string }>>(page, { type: 'get_states' });
  return states.find((item) => item.entity_id === entity)?.state;
}

async function service(page: Page, domain: string, name: string, entity: string): Promise<void> {
  await callHA(page, { type: 'call_service', domain, service: name, target: { entity_id: entity } });
}

async function pin(page: Page, pauseClock = true): Promise<void> {
  const row = page.locator('vasttrafik-home-assistant-card vt-time-table-row').first();
  await expect(row).toBeVisible();
  if (pauseClock && !pausedPages.has(page)) {
    // Let HA finish its resource/navigation timers before freezing the card clock.
    await page.clock.pauseAt(new Date(NOW.getTime() + 10_000));
    pausedPages.add(page);
  }
  await row.locator('.direction').click();
  await expect(row).toHaveAttribute('pinned');
}

test.beforeEach(async ({ page, api }) => {
  await page.goto('/');
  await expect.poll(() => state(page, COUNTER)).toBeDefined();
  await service(page, 'counter', 'reset', COUNTER);
  await service(page, 'automation', 'turn_on', AUTOMATION);
  await service(page, 'input_boolean', 'turn_on', ALLOWED);
  await service(page, 'input_boolean', 'turn_off', 'input_boolean.integration_departure_release');
  await expect.poll(() => state(page, COUNTER)).toBe('0');
  await expect.poll(() => state(page, ALLOWED)).toBe('on');
  await page.clock.install({ time: NOW });
  api.respond('test-stop', { results: [first()] });
});

test('exact default five-minute crossing calls the real automation once without an API refresh', async ({
  page,
  api,
}) => {
  await setDashboard(page, dashboard([config()]));
  await pin(page);
  const requests = api.requests.length;
  await page.clock.runFor(49_999);
  expect(await state(page, COUNTER)).toBe('0');
  await page.clock.runFor(1);
  await expect.poll(() => state(page, COUNTER)).toBe('1');
  await page.clock.runFor(60_000);
  expect(await state(page, COUNTER)).toBe('1');
  expect(api.requests).toHaveLength(requests);
});

for (const minutes of [4, 5]) {
  test(`pinning an initial ${minutes}-minute departure never immediately triggers`, async ({ page, api }) => {
    api.respond('test-stop', { results: [revised(minutes)] });
    await setDashboard(page, dashboard([config()]));
    await pin(page);
    await page.clock.runFor(30_000);
    expect(await state(page, COUNTER)).toBe('0');
  });
}

test('opening with an already-pinned below-threshold journey does not trigger', async ({ page, api }) => {
  await page.evaluate(() => localStorage.setItem('vasttrafik-home-assistant-card:pinned-lines', JSON.stringify(['a'])));
  api.respond('test-stop', { results: [revised(4)] });
  await setDashboard(page, dashboard([config()]));
  await expect(page.locator('vt-time-table-row[pinned]')).toBeVisible();
  await page.clock.runFor(30_000);
  expect(await state(page, COUNTER)).toBe('0');
});

test('configured threshold overrides five minutes', async ({ page }) => {
  await setDashboard(page, dashboard([config({ departure_trigger_minutes: 3 })]));
  await pin(page);
  await page.clock.runFor(60_000);
  expect(await state(page, COUNTER)).toBe('0');
  await page.clock.runFor(120_000);
  await expect.poll(() => state(page, COUNTER)).toBe('1');
});

test('no automation configured makes pins presentation-only', async ({ page }) => {
  await setDashboard(page, dashboard([cardConfig({ departure_trigger_minutes: 5, refresh_interval: 3600 })]));
  await pin(page);
  await page.clock.runFor(60_000);
  expect(await state(page, COUNTER)).toBe('0');
});

test('unpinning before the crossing cancels the scheduled action', async ({ page }) => {
  await setDashboard(page, dashboard([config()]));
  await pin(page);
  await page.locator('vt-time-table-row[pinned]').click();
  await expect(page.locator('vt-time-table-row[pinned]')).toHaveCount(0);
  await page.clock.runFor(60_000);
  expect(await state(page, COUNTER)).toBe('0');
});

test('refresh crossing and subsequent estimated delay recrossing only run once', async ({ page, api }) => {
  await setDashboard(page, dashboard([config({ refresh_interval: 10 })]));
  await pin(page);
  api.respond('test-stop', { results: [revised(4)] });
  await page.clock.runFor(10_000);
  await expect.poll(() => state(page, COUNTER)).toBe('1');
  api.respond('test-stop', { results: [revised(8)] });
  await page.clock.runFor(10_000);
  await expect(page.locator('.time-until-departure').first()).toHaveText('8');
  api.respond('test-stop', { results: [revised(4)] });
  await page.clock.runFor(10_000);
  await expect(page.locator('.time-until-departure').first()).toHaveText('3');
  expect(await state(page, COUNTER)).toBe('1');
});

test('different pinned journeys run separately while following unpinned journeys do not', async ({ page, api }) => {
  api.respond('test-stop', {
    results: [first(), departure('following', '7', 6.5), departure('b', '8', 7), departure('c', '9', 6)],
  });
  await setDashboard(page, dashboard([config()]));
  await pin(page);
  const second = page
    .locator('vt-time-table-row')
    .filter({ has: page.locator('.line-badge', { hasText: /^\s*8\s*$/ }) });
  await second.click();
  await expect(page.locator('vt-time-table-row[pinned]')).toHaveCount(2);
  await page.clock.runFor(60_000);
  await expect.poll(() => state(page, COUNTER)).toBe('1');
  await page.clock.runFor(60_000);
  await expect.poll(() => state(page, COUNTER)).toBe('2');
});

test('automation conditions are respected and a skipped crossing is not retried', async ({ page }) => {
  await service(page, 'input_boolean', 'turn_off', ALLOWED);
  await expect.poll(() => state(page, ALLOWED)).toBe('off');
  await setDashboard(page, dashboard([config()]));
  await pin(page);
  await page.clock.runFor(60_000);
  expect(await state(page, COUNTER)).toBe('0');
  await service(page, 'input_boolean', 'turn_on', ALLOWED);
  await page.clock.runFor(30_000);
  expect(await state(page, COUNTER)).toBe('0');
});

test('unpinning and configuration edits retain attempted identities through another delay crossing', async ({
  page,
  api,
}) => {
  await setDashboard(page, dashboard([config({ refresh_interval: 10 })]));
  await pin(page);
  api.respond('test-stop', { results: [revised(4)] });
  await page.clock.runFor(10_000);
  await expect.poll(() => state(page, COUNTER)).toBe('1');
  await page.locator('vt-time-table-row[pinned]').click();
  api.respond('test-stop', { results: [revised(8)] });
  await setCardConfig(page, config({ refresh_interval: 10, time_table_height: 350 }));
  await expect(page.locator('.time-until-departure').first()).toHaveText('8');
  await pin(page);
  api.respond('test-stop', { results: [revised(4)] });
  await page.clock.runFor(10_000);
  await expect(page.locator('.time-until-departure').first()).toHaveText('4');
  expect(await state(page, COUNTER)).toBe('1');
});

test('navigation stops monitoring and reconnecting below threshold does not catch up', async ({ page }) => {
  await setDashboard(page, dashboard([config()]));
  await pin(page);
  await page.getByRole('tab', { name: 'Other', exact: true }).click();
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return page.locator('vasttrafik-home-assistant-card').count();
    })
    .toBe(0);
  await page.clock.runFor(120_000);
  expect(await state(page, COUNTER)).toBe('0');
  await page.getByRole('tab', { name: 'Main', exact: true }).click();
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return page.locator('vt-time-table-row[pinned]').count();
    })
    .toBe(1);
  await expect(page.locator('vt-time-table-row[pinned]')).toBeVisible();
  await page.clock.runFor(30_000);
  expect(await state(page, COUNTER)).toBe('0');
});

test('changing stop or disabling the automation cancels old threshold timers', async ({ page, api }) => {
  await setDashboard(page, dashboard([config()]));
  await pin(page);
  api.respond('other-stop', { results: [] });
  await setCardConfig(page, config({ gid: 'other-stop' }));
  await expect(page.locator('vt-time-table-row')).toHaveCount(0);
  await page.clock.runFor(60_000);
  expect(await state(page, COUNTER)).toBe('0');
  await setCardConfig(page, cardConfig({ refresh_interval: 3600 }));
  await expect(page.locator('vt-time-table-row')).toBeVisible();
  await page.clock.runFor(30_000);
  expect(await state(page, COUNTER)).toBe('0');
});

test('a same-origin second tab pin change arms the existing card', async ({ page, context }) => {
  await setDashboard(page, dashboard([config()]));
  const second = await context.newPage();
  try {
    await second.goto('/integration-test/main');
    await expect(second.locator('vt-time-table-row')).toBeVisible();
    await setCardConfig(second, cardConfig({ refresh_interval: 3600 }));
    await pin(second, false);
    await expect(page.locator('vt-time-table-row[pinned]')).toBeVisible();
    await page.clock.runFor(60_000);
    await expect.poll(() => state(page, COUNTER)).toBe('1');
  } finally {
    await second.close();
  }
});

test('storage failure still lets a same-tab pin arm the card', async ({ page }) => {
  await page.evaluate(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'vasttrafik-home-assistant-card:pinned-lines') throw new Error('blocked pin storage');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'vasttrafik-home-assistant-card:pinned-lines') throw new Error('blocked pin storage');
      setItem.call(this, key, value);
    };
  });
  await setDashboard(page, dashboard([config()]));
  await pin(page);
  await page.clock.runFor(60_000);
  await expect.poll(() => state(page, COUNTER)).toBe('1');
});

test('failed refresh suspends stale-data triggers and recovery below threshold establishes a baseline', async ({
  page,
  api,
}) => {
  await setDashboard(page, dashboard([config({ refresh_interval: 10 })]));
  await pin(page);
  api.respond('test-stop', { status: 500, headers: { 'Retry-After': '120' } });
  await page.clock.runFor(10_000);
  await expect(page.getByRole('alert')).toContainText('500');
  await expect(page.locator('vt-time-table-row')).toBeVisible();
  await page.clock.runFor(60_000);
  expect(await state(page, COUNTER)).toBe('0');
  api.respond('test-stop', { results: [first()] });
  await page.clock.runFor(60_000);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await state(page, COUNTER)).toBe('0');
});

for (const invalid of ['cancelled', 'partly-cancelled', 'missing', 'expired'] as const) {
  test(`a ${invalid} departure never triggers`, async ({ page, api }) => {
    const d = first();
    if (invalid === 'cancelled') d.isCancelled = true;
    if (invalid === 'partly-cancelled') d.isPartCancelled = true;
    if (invalid === 'missing') d.plannedTime = undefined;
    if (invalid === 'expired') d.plannedTime = new Date(NOW.getTime() - 60_000).toISOString();
    api.respond('test-stop', { results: [d] });
    await setDashboard(page, dashboard([config()]));
    await pin(page);
    await page.clock.runFor(60_000);
    expect(await state(page, COUNTER)).toBe('0');
  });
}

test('a missing automation shows a localized action error without losing departures or retrying', async ({ page }) => {
  await setDashboard(page, dashboard([config({ automation_entity: 'automation.missing_departure', language: 'sv' })]));
  await pin(page);
  await page.clock.runFor(60_000);
  await expect(page.getByRole('alert')).toContainText('Kunde inte köra avgångsautomationen');
  await expect(page.locator('vt-time-table-row')).toBeVisible();
  expect(await state(page, COUNTER)).toBe('0');
  await page.screenshot({ path: 'test-results/departure-automation-error.png' });
  await page.clock.runFor(60_000);
  expect(await state(page, COUNTER)).toBe('0');
});

test('an offline HA connection does not queue a stale action for reconnection', async ({ page }) => {
  await setDashboard(page, dashboard([config()]));
  await pin(page);
  await page.locator('home-assistant').evaluate((element) => {
    const host = element as HTMLElement & {
      hass: { connection: { suspendReconnectUntil(promise: Promise<void>): void; suspend(): void } };
    };
    const pending = new Promise<void>((resolve) => {
      (window as Window & { resumeDepartureHA?: () => void }).resumeDepartureHA = resolve;
    });
    host.hass.connection.suspendReconnectUntil(pending);
    host.hass.connection.suspend();
  });
  await expect
    .poll(() =>
      page
        .locator('home-assistant')
        .evaluate((element) => (element as HTMLElement & { hass: { connected: boolean } }).hass.connected),
    )
    .toBe(false);
  await page.clock.runFor(420_000);
  await page.evaluate(() => (window as Window & { resumeDepartureHA?: () => void }).resumeDepartureHA!());
  await page.clock.runFor(5_000);
  await expect
    .poll(() =>
      page
        .locator('home-assistant')
        .evaluate((element) => (element as HTMLElement & { hass: { connected: boolean } }).hass.connected),
    )
    .toBe(true);
  await expect.poll(() => state(page, COUNTER)).toBe('0');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an obsolete real action completion cannot clear a newer configuration action error', async ({ page, api }) => {
  await setDashboard(page, dashboard([config({ automation_entity: 'automation.integration_departure_delayed' })]));
  await pin(page);
  await page.clock.runFor(60_000);
  await expect
    .poll(async () => {
      const states = await callHA<Array<{ entity_id: string; attributes: { current?: number } }>>(page, {
        type: 'get_states',
      });
      return states.find((item) => item.entity_id === 'automation.integration_departure_delayed')?.attributes.current;
    })
    .toBe(1);
  api.respond('test-stop', { results: [departure('a', '7', 10, { detailsReference: 'next-departure' })] });
  await setCardConfig(page, config({ automation_entity: 'automation.missing_departure' }));
  await expect(page.locator('.time-until-departure').first()).toHaveText('9');
  await page.clock.runFor(230_000);
  await expect(page.getByRole('alert')).toContainText('automation.missing_departure');
  await service(page, 'input_boolean', 'turn_on', 'input_boolean.integration_departure_release');
  await expect.poll(() => state(page, COUNTER)).toBe('1');
  await expect(page.getByRole('alert')).toContainText('automation.missing_departure');
});

test('a genuine HA permission rejection is handled without an uncaught error or retry', async ({
  page,
  browser,
  api,
}) => {
  await setDashboard(page, dashboard([config()]));
  const dashboards = await callHA<Array<{ id: string; url_path: string }>>(page, { type: 'lovelace/dashboards/list' });
  const dashboardId = dashboards.find((item) => item.url_path === 'integration-test')!.id;
  const { user } = await callHA<{ user: { id: string } }>(page, {
    type: 'config/auth/create',
    name: 'Departure readonly tester',
    group_ids: ['system-read-only'],
  });
  await callHA(page, {
    type: 'config/auth_provider/homeassistant/create',
    user_id: user.id,
    username: 'departure-readonly',
    password: 'dummy-readonly-password',
  });
  await callHA(page, { type: 'lovelace/dashboards/update', dashboard_id: dashboardId, require_admin: false });
  const readonlyContext = await browser.newContext({
    baseURL: process.env.HA_URL,
    serviceWorkers: 'block',
    storageState: { cookies: [], origins: [] },
  });
  const errors: string[] = [];
  try {
    await api.install(readonlyContext);
    const readonlyPage = await readonlyContext.newPage();
    readonlyPage.on('pageerror', (error) => errors.push(error.message));
    const rejections: string[] = [];
    readonlyPage.on('websocket', (socket) => {
      let actionId: number | undefined;
      socket.on('framesent', ({ payload }) => {
        const message = JSON.parse(String(payload)) as {
          id?: number;
          type?: string;
          domain?: string;
          service?: string;
        };
        if (message.type === 'call_service' && message.domain === 'automation' && message.service === 'trigger')
          actionId = message.id;
      });
      socket.on('framereceived', ({ payload }) => {
        const message = JSON.parse(String(payload)) as {
          id?: number;
          type?: string;
          success?: boolean;
          error?: { code: string };
        };
        if (message.id === actionId && message.type === 'result' && message.success === false && message.error)
          rejections.push(message.error.code);
      });
    });
    await readonlyPage.goto('/integration-test/main');
    await readonlyPage.getByRole('textbox', { name: 'Username', exact: true }).fill('departure-readonly');
    await readonlyPage.getByLabel('Password', { exact: true }).fill('dummy-readonly-password');
    await readonlyPage.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(readonlyPage.locator('vt-time-table-row')).toBeVisible();
    await readonlyPage.clock.install({ time: NOW });
    const refreshed = api.hold('test-stop');
    await setCardConfig(readonlyPage, config());
    await refreshed.started;
    await expect(readonlyPage.locator('vt-header vt-spinner')).toBeVisible();
    refreshed.release({ results: [first()] });
    await expect(readonlyPage.locator('vt-header vt-spinner')).toHaveCount(0);
    await pin(readonlyPage);
    await readonlyPage.clock.runFor(60_000);
    await expect.poll(() => rejections.length).toBeGreaterThan(0);
    const actionAlert = readonlyPage.locator('vasttrafik-home-assistant-card').getByRole('alert');
    await expect
      .poll(async () => {
        // HA loads/translates its own service error before callService rejects.
        await readonlyPage.clock.runFor(100);
        return actionAlert.count();
      })
      .toBe(1);
    await expect(actionAlert).toContainText('Could not run the departure automation');
    await expect(readonlyPage.locator('vt-time-table-row')).toBeVisible();
    await readonlyPage.clock.runFor(60_000);
    expect(await state(page, COUNTER)).toBe('0');
    expect(errors).toEqual([]);
  } finally {
    await readonlyContext.close();
    await callHA(page, { type: 'lovelace/dashboards/update', dashboard_id: dashboardId, require_admin: true });
    await callHA(page, { type: 'config/auth/delete', user_id: user.id });
  }
});
