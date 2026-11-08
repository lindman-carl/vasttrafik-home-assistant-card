import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VasttrafikApi } from './api';
import { jsonResponse, makeDeparture } from '../../tests/fixtures';

describe('API resilience', () => {
  let api: VasttrafikApi;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T10:00:00Z'));
    api = new VasttrafikApi();
    api.setCredentials('dummy-client', 'dummy-secret');
    fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'token-one', expires_in: 3600 }));
  });

  it('caches successful stop lookups but retries missing stops', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ gid: 'stop-1' }] }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await api.fetchStopArea({ stopName: 'Brunnsparken', limit: 10 });
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await api.fetchStopArea({ stopName: 'Brunnsparken', limit: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3][0])).toContain('/stop-areas/stop-1/departures?');
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    expect(await api.resolveStopAreaGid('Unknown')).toBeNull();
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ gid: 'found' }] }));
    expect(await api.resolveStopAreaGid('Unknown')).toBe('found');
  });

  it.each([{ results: 'invalid' }, { results: [{}] }, { results: [{ ...makeDeparture(), stopPoint: {} }] }])(
    'rejects malformed departure payloads: %j',
    async (body) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(body));
      await expect(api.fetchStopArea({ gid: 'stop-1', limit: 10 })).rejects.toThrow(/valid.*response/i);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('rejects non-string location GIDs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ gid: 123 }] }));
    await expect(api.resolveStopAreaGid('Brunnsparken')).rejects.toThrow(/valid.*response/i);
  });

  it('treats null departure results as an empty timetable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: null }));
    expect(await api.fetchStopArea({ gid: 'stop-1', limit: 10 })).toEqual({
      name: '-',
      gid: 'stop-1',
      departures: [],
      groupedDepartures: [],
    });
  });

  it('normalizes null API times to missing fields so estimated/planned fallbacks remain usable', async () => {
    const departure = makeDeparture();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            ...departure,
            estimatedOtherwisePlannedTime: null,
            estimatedTime: '2026-11-02T10:05:00Z',
            plannedTime: null,
          },
        ],
      }),
    );
    const stop = await api.fetchStopArea({ gid: 'stop-1', limit: 10 });
    expect(stop.departures[0].estimatedOtherwisePlannedTime).toBeUndefined();
    expect(stop.departures[0].plannedTime).toBeUndefined();
    expect(stop.departures[0].estimatedTime).toBe('2026-11-02T10:05:00Z');
    expect(stop.groupedDepartures).toHaveLength(1);
  });

  it('refreshes an unauthorized token once and sends the new bearer token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401, statusText: 'Unauthorized' }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'token-two', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [makeDeparture()] }));
    expect((await api.fetchStopArea({ gid: 'stop-1', limit: 10 })).departures).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][1]?.headers).toMatchObject({ Authorization: 'Bearer token-two' });
  });

  it('does not loop on repeated authorization failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'token-two', expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(api.fetchStopArea({ gid: 'stop-1', limit: 10 })).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('uses exponential backoff and cleans up timers after recovery', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    const pending = api.fetchStopArea({ gid: 'stop-1', limit: 10 });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).departures).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops after two transient retries', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const pending = api.fetchStopArea({ gid: 'stop-1', limit: 10 });
    const assertion = expect(pending).rejects.toThrow(/503/);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(['3', 'Mon, 02 Nov 2026 10:00:03 GMT'])('honors Retry-After %s', async (retryAfter) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    const pending = api.fetchStopArea({ gid: 'stop-1', limit: 10 });
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).departures).toEqual([]);
  });

  it('returns long Retry-After guidance without retrying too early', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '120' } }));
    await expect(api.fetchStopArea({ gid: 'stop-1', limit: 10 })).rejects.toMatchObject({ retryAfterMs: 120_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry permanent HTTP errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(api.fetchStopArea({ gid: 'stop-1', limit: 10 })).rejects.toThrow(/403/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not make requests when supplied an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(api.fetchStopArea({ gid: 'stop-1', limit: 10, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('times out response-body parsing as well as the initial fetch', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await api.fetchStopArea({ gid: 'stop-1', limit: 10 });
    const response = jsonResponse({ results: [] });
    vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}));
    fetchMock.mockResolvedValueOnce(response);
    const pending = api.fetchStopArea({ gid: 'stop-1', limit: 10 });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts token authentication without starting departures', async () => {
    const controller = new AbortController();
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        }),
    );
    const pending = api.fetchStopArea({ gid: 'stop-1', limit: 10, signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels backoff without sending another request', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const pending = api.fetchStopArea({ gid: 'stop-1', limit: 10, signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out even if fetch never settles and permits later requests', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await api.fetchStopArea({ gid: 'stop-1', limit: 10 });
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const pending = api.fetchStopArea({ gid: 'stop-1', limit: 10 });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(fetchMock.mock.calls[2][1]?.signal?.aborted).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    expect((await api.fetchStopArea({ gid: 'stop-1', limit: 10 })).departures).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
