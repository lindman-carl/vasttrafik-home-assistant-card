import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VasttrafikApi } from './api';
import { jsonResponse, makeDeparture } from '../../tests/fixtures';

describe('VasttrafikApi', () => {
  let api: VasttrafikApi;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    api = new VasttrafikApi();
    api.setCredentials('test-client', 'test-secret');
    fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'api-token', expires_in: 3600 }));
  });

  it('resolves stop names using encoded search parameters and Bearer authentication', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ gid: '123' }, { gid: '456' }] }));
    await expect(api.resolveStopAreaGid('Brunnsparken, Göteborg & Torget')).resolves.toBe('123');
    const [url, options] = fetchMock.mock.calls[1];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe('https://ext-api.vasttrafik.se/pr/v4/locations/by-text');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      q: 'Brunnsparken, Göteborg & Torget',
      types: 'stoparea',
      limit: '1',
    });
    expect(options?.headers).toEqual({ Authorization: 'Bearer api-token' });
  });

  it.each([{}, { results: [] }, { results: null }, { results: [{}] }, { results: [{ gid: null }] }])(
    'returns null when search has no usable GID: %j',
    async (body) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(body));
      await expect(api.resolveStopAreaGid('Unknown')).resolves.toBeNull();
    },
  );

  it('prefers a supplied GID over stop name and encodes it in the departure URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await expect(api.fetchStopArea({ gid: 'stop/123', stopName: 'Ignored', limit: 7 })).resolves.toEqual({
      name: '-',
      gid: 'stop/123',
      departures: [],
      groupedDepartures: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://ext-api.vasttrafik.se/pr/v4/stop-areas/stop%2F123/departures?limit=7&maxDeparturesPerLineAndDirection=2',
      { headers: { Authorization: 'Bearer api-token' }, signal: expect.any(AbortSignal) },
    );
  });

  it('resolves the stop name, reuses authentication and returns sorted departure groups', async () => {
    const late = makeDeparture({ detailsReference: 'late', estimatedOtherwisePlannedTime: '2026-11-02T10:30:00Z' });
    const early = makeDeparture({ detailsReference: 'early' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ gid: '123' }] }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [late, early] }));
    await expect(api.fetchStopArea({ stopName: 'Brunnsparken', limit: 10 })).resolves.toEqual({
      name: 'Brunnsparken',
      gid: '123',
      departures: [late, early],
      groupedDepartures: [[early, late]],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toEqual({ Authorization: 'Bearer api-token' });
  });

  it('treats absent departure results as an empty timetable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(api.fetchStopArea({ gid: '123', limit: 10 })).resolves.toEqual({
      name: '-',
      gid: '123',
      departures: [],
      groupedDepartures: [],
    });
  });

  it('rejects requests with neither a GID nor a stop name before accessing the network', async () => {
    await expect(api.fetchStopArea({ limit: 10 })).rejects.toThrow(/stop area GID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unresolved stop without requesting departures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await expect(api.fetchStopArea({ stopName: 'Unknown', limit: 10 })).rejects.toThrow(/stop area GID/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports HTTP status details from API failures', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503, statusText: 'Service Unavailable' }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503, statusText: 'Service Unavailable' }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503, statusText: 'Service Unavailable' }));
    const assertion = expect(api.fetchStopArea({ gid: '123', limit: 10 })).rejects.toThrow(/503 Service Unavailable/);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it('propagates API network failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network offline'));
    await expect(api.resolveStopAreaGid('Brunnsparken')).rejects.toThrow('Network offline');
  });
});
