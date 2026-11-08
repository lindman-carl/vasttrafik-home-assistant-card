import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenManager } from './token-manager';
import { jsonResponse } from '../../tests/fixtures';

describe('TokenManager', () => {
  let manager: TokenManager;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T10:00:00Z'));
    manager = new TokenManager();
    manager.setCredentials('test-client', 'test-secret');
    fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'token-one', expires_in: 3600 }));
  });

  it.each([
    ['', 'test-secret'],
    ['test-client', ''],
  ])('rejects missing credentials before requesting a token', async (id, secret) => {
    manager.setCredentials(id, secret);
    await expect(manager.getAccessToken()).rejects.toThrow(/Missing.*credentials/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests a token with Basic authentication and the client credentials grant', async () => {
    await expect(manager.getBearerToken()).resolves.toBe('Bearer token-one');
    expect(fetchMock).toHaveBeenCalledWith('https://ext-api.vasttrafik.se/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic dGVzdC1jbGllbnQ6dGVzdC1zZWNyZXQ=',
      },
      body: 'grant_type=client_credentials',
      signal: expect.any(AbortSignal),
    });
  });

  it('reuses a cached token before the five-minute refresh boundary', async () => {
    await manager.getAccessToken();
    vi.setSystemTime(new Date('2026-11-02T10:54:59.999Z'));
    await expect(manager.getAccessToken()).resolves.toBe('token-one');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['2026-11-02T10:55:00Z', '2026-11-02T11:00:01Z'])('refreshes at %s', async (time) => {
    await manager.getAccessToken();
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'token-two', expires_in: 3600 }));
    vi.setSystemTime(new Date(time));
    await expect(manager.getAccessToken()).resolves.toBe('token-two');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the cached token when credentials are unchanged', async () => {
    await manager.getAccessToken();
    manager.setCredentials('test-client', 'test-secret');
    await expect(manager.getAccessToken()).resolves.toBe('token-one');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['new-client', 'test-secret'],
    ['test-client', 'new-secret'],
  ])('invalidates the cache when credentials change to %s / %s', async (id, secret) => {
    await manager.getAccessToken();
    manager.setCredentials(id, secret);
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'token-two', expires_in: 3600 }));
    await expect(manager.getAccessToken()).resolves.toBe('token-two');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: `Basic ${btoa(`${id}:${secret}`)}` });
  });

  it('keeps caches isolated between instances', async () => {
    await manager.getAccessToken();
    const other = new TokenManager();
    other.setCredentials('test-client', 'test-secret');
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'other-token', expires_in: 3600 }));
    await expect(other.getAccessToken()).resolves.toBe('other-token');
    await expect(manager.getAccessToken()).resolves.toBe('token-one');
  });

  it('reports token endpoint HTTP failures and allows a later retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401, statusText: 'Unauthorized' }));
    await expect(manager.getAccessToken()).rejects.toThrow(/401 Unauthorized/);
    await expect(manager.getAccessToken()).resolves.toBe('token-one');
  });

  it('propagates network failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network offline'));
    await expect(manager.getAccessToken()).rejects.toThrow('Network offline');
  });

  it.each([
    { expires_in: 3600 },
    { access_token: '', expires_in: 3600 },
    { access_token: 'bad-token' },
    { access_token: 'bad-token', expires_in: '3600' },
    { access_token: 'bad-token', expires_in: null },
  ])('rejects malformed token data %j without caching it', async (body) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(body));
    await expect(manager.getAccessToken()).rejects.toThrow(/valid access token/);
    await expect(manager.getAccessToken()).resolves.toBe('token-one');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
