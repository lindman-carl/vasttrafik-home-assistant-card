import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenManager } from './token-manager';
import { jsonResponse } from '../../tests/fixtures';

describe('token resilience', () => {
  let manager: TokenManager;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T10:00:00Z'));
    manager = new TokenManager();
    manager.setCredentials('dummy-client', 'dummy-secret');
    fetchMock = vi.mocked(fetch);
  });

  it('does not cache or return an old credential request after credentials change', async () => {
    let finishOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const oldRequest = manager.getAccessToken();
    const oldAssertion = expect(oldRequest).rejects.toThrow(/credentials changed/i);
    manager.setCredentials('new-client', 'new-secret');
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'new-token', expires_in: 3600 }));
    expect(await manager.getAccessToken()).toBe('new-token');
    finishOld(jsonResponse({ access_token: 'old-token', expires_in: 3600 }));
    await oldAssertion;
    expect(await manager.getAccessToken()).toBe('new-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deduplicates simultaneous authentication for the same credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'token-one', expires_in: 3600 }));
    expect(await Promise.all([manager.getAccessToken(), manager.getAccessToken()])).toEqual(['token-one', 'token-one']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses short-lived tokens instead of refreshing on every call', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'short-token', expires_in: 60 }));
    expect(await manager.getAccessToken()).toBe('short-token');
    vi.setSystemTime(new Date('2026-11-02T10:00:30Z'));
    expect(await manager.getAccessToken()).toBe('short-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([503, 429])('retries token HTTP %s with Retry-After guidance', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status, headers: { 'Retry-After': '2' } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'recovered-token', expires_in: 3600 }));
    const pending = manager.getAccessToken();
    void pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe('recovered-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds token retries to two attempts after the initial request', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const assertion = expect(manager.getAccessToken()).rejects.toThrow(/503/);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels token retry backoff without sending another authentication request', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const assertion = expect(manager.getAccessToken(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    void assertion.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry outdated credentials after a credential change during backoff', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const oldAssertion = expect(manager.getAccessToken()).rejects.toThrow(/credentials changed/i);
    void oldAssertion.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    manager.setCredentials('new-client', 'new-secret');
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'new-token', expires_in: 3600 }));
    expect(await manager.getAccessToken()).toBe('new-token');
    await vi.advanceTimersByTimeAsync(1000);
    await oldAssertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await manager.getAccessToken()).toBe('new-token');
  });

  it.each([
    { access_token: 123, expires_in: 3600 },
    { access_token: 'bad-token', expires_in: 0 },
    { access_token: 'bad-token', expires_in: -1 },
  ])('rejects malformed token data %j without caching it', async (body) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(body));
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'valid-token', expires_in: 3600 }));
    await expect(manager.getAccessToken()).rejects.toThrow(/valid access token/);
    expect(await manager.getAccessToken()).toBe('valid-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
