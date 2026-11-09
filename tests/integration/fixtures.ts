import { test as base, expect, type BrowserContext, type Request } from '@playwright/test';
import type { VasttrafikCardConfig } from '../../src/config';
import type { Departure } from '../../src/departures/types';

export const NOW = new Date('2026-11-03T12:00:00+01:00');
export const PIN_KEY = 'vasttrafik-home-assistant-card:pinned-departures';

export function departure(gid: string, line: string, minutes: number, overrides: Partial<Departure> = {}): Departure {
  return {
    detailsReference: `details-${gid}`,
    serviceJourney: {
      gid,
      direction: 'Centrum',
      line: {
        gid: `line-${line}`,
        shortName: line,
        name: `Line ${line}`,
        transportMode: 'tram',
        backgroundColor: '#ffffff',
        foregroundColor: '#000000',
        borderColor: '#000000',
      },
    },
    stopPoint: { name: 'Test stop', platform: 'A' },
    plannedTime: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
    isCancelled: false,
    isPartCancelled: false,
    ...overrides,
  };
}

export function cardConfig(overrides: Partial<VasttrafikCardConfig> = {}): VasttrafikCardConfig {
  return {
    type: 'custom:vasttrafik-home-assistant-card',
    gid: 'test-stop',
    client_id: 'dummy-client',
    client_secret: 'dummy-secret',
    ...overrides,
  };
}

export interface MockResponse {
  results?: Departure[];
  status?: number;
  headers?: Record<string, string>;
}

export class ApiMock {
  public readonly requests: Request[] = [];
  public readonly unexpected: string[] = [];
  public blockKnownHAPreviewImages = false;
  private readonly responses = new Map<string, () => Promise<MockResponse>>();
  private readonly releases: Array<() => void> = [];

  public respond(gid: string, response: MockResponse): void {
    this.responses.set(gid, async () => response);
  }

  public hold(gid: string): { started: Promise<void>; release(response: MockResponse): void } {
    let start!: () => void;
    let finish!: (response: MockResponse) => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const pending = new Promise<MockResponse>((resolve) => {
      finish = resolve;
    });
    this.responses.set(gid, () => {
      start();
      return pending;
    });
    this.releases.push(() => finish({ results: [] }));
    return { started, release: finish };
  }

  public releaseAll(): void {
    this.releases.forEach((release) => release());
  }

  public assertNoUnexpectedRequests(): void {
    expect(this.unexpected, `Unexpected external request: ${this.unexpected.join(', ')}`).toEqual([]);
  }

  public async install(context: BrowserContext): Promise<void> {
    const origin = new URL(process.env.HA_URL!).origin;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin) return route.continue();
      if (
        this.blockKnownHAPreviewImages &&
        request.resourceType() === 'image' &&
        [
          'https://demo.home-assistant.io/stub_config/t-shirt-promo.png',
          'https://demo.home-assistant.io/stub_config/floorplan.png',
          'https://demo.home-assistant.io/stub_config/kitchen.png',
        ].includes(request.url())
      )
        return route.abort('blockedbyclient');
      this.requests.push(request);
      const headers = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization,content-type',
        'Access-Control-Expose-Headers': 'Retry-After',
      };
      if (url.origin === 'https://ext-api.vasttrafik.se') {
        const token = url.pathname === '/token';
        const location = url.pathname === '/pr/v4/locations/by-text';
        const match = /^\/pr\/v4\/stop-areas\/([^/]+)\/departures$/.exec(url.pathname);
        const respond = match && this.responses.get(decodeURIComponent(match[1]));
        const preflightMethod = request.headers()['access-control-request-method'];
        if (
          request.method() === 'OPTIONS' &&
          ((token && preflightMethod === 'POST') || ((location || respond) && preflightMethod === 'GET'))
        )
          return route.fulfill({
            status: 204,
            headers: { ...headers, 'Access-Control-Allow-Methods': preflightMethod },
          });
        if (token && request.method() === 'POST') {
          return route.fulfill({ json: { access_token: 'dummy-token', expires_in: 3600 }, headers });
        }
        if (location && request.method() === 'GET') {
          return route.fulfill({ json: { results: [{ gid: 'test-stop' }] }, headers });
        }
        if (respond && request.method() === 'GET') {
          const response = await respond();
          try {
            await route.fulfill({
              status: response.status ?? 200,
              headers: { ...headers, ...response.headers },
              json: { results: response.results ?? [] },
            });
          } catch {
            /* A disconnected card may already have aborted this route. */
          }
          return;
        }
      }
      this.unexpected.push(request.url());
      await route.abort('blockedbyclient');
    });
  }
}

export async function mockVasttrafik(context: BrowserContext): Promise<ApiMock> {
  const api = new ApiMock();
  api.respond('test-stop', { results: [departure('journey-1', '7', 10)] });
  await api.install(context);
  return api;
}

export const test = base.extend<{ api: ApiMock }>({
  api: [
    async ({ context }, use) => {
      const api = await mockVasttrafik(context);
      const errors: string[] = [];
      context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
      try {
        await use(api);
      } finally {
        api.releaseAll();
        api.assertNoUnexpectedRequests();
        expect(errors, 'Uncaught browser errors').toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };
