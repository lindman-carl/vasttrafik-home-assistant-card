import { expect, test } from '@playwright/test';
import { cardConfig, departure, mockVasttrafik } from './fixtures';
import { setDashboard } from './ha';

test('unexpected Västtrafik preflight paths are reported rather than silently accepted', async ({ page, context }) => {
  const api = await mockVasttrafik(context);
  await page.goto('/');
  await page.evaluate(async () => {
    try {
      await fetch('https://ext-api.vasttrafik.se/unexpected', { method: 'OPTIONS' });
    } catch {
      /* The fixture is expected to block this external request. */
    }
  });
  expect(() => api.assertNoUnexpectedRequests()).toThrow(/Unexpected external request/);
});

test('real card emits authenticated lookup and departure requests without using the live API', async ({
  page,
  context,
}) => {
  const api = await mockVasttrafik(context);
  api.respond('test-stop', { results: [departure('journey-1', '7', 10)] });
  await setDashboard(page, {
    title: 'Integration tests',
    views: [
      {
        title: 'Main',
        path: 'main',
        cards: [cardConfig({ gid: undefined, stop_name: 'Test stop' })],
      },
    ],
  });
  await expect(page.locator('vt-header')).toContainText('Test stop');
  await expect(page.locator('vt-time-table-row .direction')).toHaveText('Centrum');
  const lookup = api.requests.find((request) => request.url().includes('/locations/'))!;
  expect(new URL(lookup.url()).searchParams.get('q')).toBe('Test stop');
  expect(new URL(lookup.url()).searchParams.get('types')).toBe('stoparea');
  const departures = api.requests.find((request) => request.url().includes('/departures?'))!;
  expect(new URL(departures.url()).searchParams.get('limit')).toBe('50');
  expect(departures.headers().authorization).toBe('Bearer dummy-token');
  const tokenRequests = api.requests.filter((request) => request.url().endsWith('/token'));
  expect(tokenRequests.length).toBeGreaterThan(0);
  for (const token of tokenRequests) {
    expect(token.method()).toBe('POST');
    expect(token.headers().authorization).toBe('Basic ZHVtbXktY2xpZW50OmR1bW15LXNlY3JldA==');
    expect(token.postData()).toBe('grant_type=client_credentials');
  }
  await page
    .locator('vasttrafik-home-assistant-card')
    .evaluate((card: HTMLElement & { setConfig(config: unknown): void }) => {
      card.setConfig({
        type: 'custom:vasttrafik-home-assistant-card',
        stop_name: 'Test stop',
        client_id: 'dummy-client',
        client_secret: 'dummy-secret',
      });
    });
  await expect.poll(() => api.requests.filter((request) => request.url().includes('/departures?')).length).toBe(2);
  expect(api.requests.filter((request) => request.url().endsWith('/token'))).toHaveLength(tokenRequests.length);
  expect(api.requests.filter((request) => request.url().includes('/locations/'))).toHaveLength(1);
  api.assertNoUnexpectedRequests();
});

test('unexpected external requests are blocked and reported instead of reaching the network', async ({
  page,
  context,
}) => {
  const api = await mockVasttrafik(context);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    try {
      await fetch('https://ext-api.vasttrafik.se/unexpected');
      return 'escaped';
    } catch {
      return 'blocked';
    }
  });
  expect(result).toBe('blocked');
  expect(() => api.assertNoUnexpectedRequests()).toThrow(/Unexpected external request/);
});
