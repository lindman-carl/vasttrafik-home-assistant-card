import { cardConfig, departure, expect, PIN_KEY, test } from './fixtures';
import { dashboard, openEditor, setDashboard } from './ha';

// These intentionally narrow browser contracts use real components in the HA
// page, not real user flows. Only the ignored-abort cases replace external fetch.
for (const scenario of ['disconnect', 'stop-change', 'reconnect', 'invalid-config'] as const) {
  test(`ignored-abort contract: ${scenario} never publishes obsolete data`, async ({ page }) => {
    await setDashboard(page, dashboard([]));
    await expect
      .poll(() => page.evaluate(() => Boolean(customElements.get('vasttrafik-home-assistant-card'))))
      .toBe(true);
    const result = await page.evaluate(
      async ({ config, fixture, scenario }) => {
        type Card = HTMLElement & { setConfig(config: unknown): void; hass: unknown };
        const requests: Array<{ url: string; signal?: AbortSignal | null; finish(name: string): void }> = [];
        const original = window.fetch;
        let active = 0;
        let maxActive = 0;
        window.fetch = (input, options) => {
          const url = String(input);
          if (!url.startsWith('https://ext-api.vasttrafik.se/')) return original(input, options);
          if (url.endsWith('/token'))
            return Promise.resolve(Response.json({ access_token: 'dummy-token', expires_in: 3600 }));
          if (!url.includes('/stop-areas/')) throw new Error(`Unexpected external request: ${url}`);
          active++;
          maxActive = Math.max(maxActive, active);
          let completed = false;
          const complete = () => {
            if (!completed) {
              completed = true;
              active--;
            }
          };
          options?.signal?.addEventListener('abort', complete, { once: true });
          return new Promise((resolve) =>
            requests.push({
              url,
              signal: options?.signal,
              finish: (name) => {
                complete();
                resolve(Response.json({ results: [{ ...fixture, stopPoint: { name, platform: 'A' } }] }));
              },
            }),
          );
        };
        const card = document.createElement('vasttrafik-home-assistant-card') as Card;
        card.hass = (document.querySelector('home-assistant') as HTMLElement & { hass: unknown }).hass;
        const until = async (predicate: () => boolean) => {
          for (let attempt = 0; attempt < 100; attempt++) {
            if (predicate()) return;
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          throw new Error('Browser contract did not settle.');
        };
        const text = () => card.shadowRoot?.querySelector('vt-header')?.shadowRoot?.textContent ?? '';
        try {
          card.setConfig(config);
          document.body.append(card);
          await until(() => requests.length === 1);
          if (scenario === 'disconnect') {
            card.remove();
            requests[0].finish('Obsolete stop');
            await until(() => active === 0);
            await new Promise((resolve) => setTimeout(resolve, 0));
            return {
              aborted: requests[0].signal?.aborted,
              count: requests.length,
              stale: text().includes('Obsolete stop'),
            };
          }
          if (scenario === 'invalid-config') {
            card.setConfig({ ...config, refresh_interval: 0 });
            await until(() => Boolean(card.shadowRoot?.querySelector('hui-error-card')));
            return {
              aborted: requests[0].signal?.aborted,
              count: requests.length,
              error: card.shadowRoot?.querySelector('hui-error-card')?.shadowRoot?.textContent,
            };
          }
          card.setConfig({ ...config, gid: 'new-stop' });
          if (scenario === 'reconnect') {
            card.remove();
            requests[0].finish('Obsolete stop');
            await new Promise((resolve) => setTimeout(resolve, 0));
            const detachedCount = requests.length;
            document.body.append(card);
            await until(() => requests.length === 2);
            requests[1].finish('Reconnected stop');
            await until(() => text().includes('Reconnected stop'));
            return {
              aborted: requests[0].signal?.aborted,
              detachedCount,
              count: requests.length,
              maxActive,
              current: text(),
            };
          }
          await until(() => requests.length === 2);
          requests[1].finish('New stop');
          await until(() => text().includes('New stop'));
          requests[0].finish('Obsolete stop');
          await new Promise((resolve) => setTimeout(resolve, 0));
          return { aborted: requests[0].signal?.aborted, count: requests.length, maxActive, current: text() };
        } finally {
          card.remove();
          requests.forEach((request) => request.finish('Cleanup'));
          window.fetch = original;
        }
      },
      { config: cardConfig({ refresh_interval: 10 }), fixture: departure('a', '7', 10), scenario },
    );
    expect(result.aborted).toBe(true);
    if (scenario === 'disconnect') {
      expect(result.count).toBe(1);
      expect(result.stale).toBe(false);
    } else if (scenario === 'invalid-config') {
      expect(result.count).toBe(1);
      expect(result.error).toContain('Refresh interval');
    } else {
      expect(result.count).toBe(2);
      expect(result.maxActive).toBe(1);
      expect(result.current).toContain(scenario === 'reconnect' ? 'Reconnected stop' : 'New stop');
      expect(result.current).not.toContain('Obsolete stop');
      if (scenario === 'reconnect') expect(result.detachedCount).toBe(1);
    }
  });
}

test('missing journey GID cannot create a pin through the public timetable input', async ({ page }) => {
  await setDashboard(page, dashboard([cardConfig()]));
  const row = page.locator('vt-time-table-row');
  await expect(row).toBeVisible();
  await page.locator('vt-time-table').evaluate(
    (table: HTMLElement & { groupedDepartures: unknown[][] }, fixture) => {
      table.groupedDepartures = [[{ ...fixture, serviceJourney: { ...fixture.serviceJourney, gid: undefined } }]];
    },
    departure('a', '7', 10),
  );
  await expect(row).not.toHaveAttribute('pinnable');
  await row.click();
  expect(await page.evaluate((key) => localStorage.getItem(key), PIN_KEY)).toBeNull();
  await expect(row).not.toHaveAttribute('pinned');
});

test('malformed top-level configuration is rejected at the public card boundary', async ({ page }) => {
  await setDashboard(page, dashboard([cardConfig()]));
  await expect(page.locator('vt-time-table-row')).toBeVisible();
  const rejected = await page
    .locator('vasttrafik-home-assistant-card')
    .evaluate((card: HTMLElement & { setConfig(value: unknown): void }) => {
      return ['invalid', [], 42].map((value) => {
        try {
          card.setConfig(value);
          return false;
        } catch (error) {
          return error instanceof Error && error.message === 'Invalid configuration.';
        }
      });
    });
  expect(rejected).toEqual([true, true, true]);
});

test('undefined language clear events remove the override and retain unrelated configuration', async ({ page }) => {
  await setDashboard(page, dashboard([cardConfig({ language: 'sv' })]));
  const editor = await openEditor(page);
  const result = await editor.evaluate(async (editor) => {
    return await new Promise<Record<string, unknown>>((resolve) => {
      editor.addEventListener('config-changed', (event) => resolve((event as CustomEvent).detail.config), {
        once: true,
      });
      const selector = [...editor.shadowRoot!.querySelectorAll('ha-selector')].find(
        (element) => element.getAttribute('label') === 'Språk',
      )!;
      selector.dispatchEvent(new CustomEvent('value-changed', { detail: { value: undefined } }));
    });
  });
  expect(result).not.toHaveProperty('language');
  expect(result).toMatchObject({ gid: 'test-stop', client_id: 'dummy-client', client_secret: 'dummy-secret' });
});
