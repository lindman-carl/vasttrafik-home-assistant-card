import { z } from 'zod';
import { requestJson, retryDelay, waitForRetry } from './request';

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

export class TokenManager {
  private accessToken?: string;
  private tokenExpiry = 0;
  private clientId?: string;
  private clientSecret?: string;
  private readonly tokenRefreshBuffer = 5 * 60 * 1000;
  private refreshBuffer = this.tokenRefreshBuffer;
  private credentialVersion = 0;
  private tokenRequest?: { promise: Promise<string>; signal?: AbortSignal; version: number };

  public setCredentials(clientId: string, clientSecret: string): void {
    if (this.clientId !== clientId || this.clientSecret !== clientSecret) {
      this.clearToken();
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  public async getAccessToken(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const accessToken = this.accessToken;
    if (accessToken && this.isTokenValid()) {
      return accessToken;
    }

    if (this.tokenRequest?.version === this.credentialVersion && this.tokenRequest.signal === signal) {
      return this.tokenRequest.promise;
    }
    const request = { promise: this.fetchAccessToken(signal), signal, version: this.credentialVersion };
    this.tokenRequest = request;
    try {
      return await request.promise;
    } finally {
      if (this.tokenRequest === request) this.tokenRequest = undefined;
    }
  }

  public async getBearerToken(signal?: AbortSignal): Promise<string> {
    return `Bearer ${await this.getAccessToken(signal)}`;
  }

  public invalidateToken(): void {
    this.clearToken();
  }

  private clearToken(): void {
    this.accessToken = undefined;
    this.tokenExpiry = 0;
    this.credentialVersion += 1;
    this.tokenRequest = undefined;
  }

  private isTokenValid(): boolean {
    return Boolean(this.accessToken && Date.now() < this.tokenExpiry - this.refreshBuffer);
  }

  private async fetchAccessToken(signal?: AbortSignal): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Missing Västtrafik API credentials.');
    }

    const version = this.credentialVersion;
    const credentials = btoa(`${this.clientId}:${this.clientSecret}`);
    let retries = 0;
    while (true) {
      signal?.throwIfAborted();
      if (version !== this.credentialVersion) throw new Error('API credentials changed during authentication.');
      try {
        const token = await requestJson(
          'https://ext-api.vasttrafik.se/token',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${credentials}`,
            },
            body: 'grant_type=client_credentials',
            signal,
          },
          TokenResponseSchema,
          'Token request failed',
          'Token response did not include a valid access token.',
        );
        signal?.throwIfAborted();
        if (version !== this.credentialVersion) throw new Error('API credentials changed during authentication.');

        this.accessToken = token.access_token;
        this.tokenExpiry = Date.now() + token.expires_in * 1000;
        this.refreshBuffer = Math.min(this.tokenRefreshBuffer, token.expires_in * 100);
        return this.accessToken;
      } catch (error) {
        signal?.throwIfAborted();
        if (version !== this.credentialVersion) throw new Error('API credentials changed during authentication.');
        const delay = retryDelay(error, retries);
        if (delay === undefined) throw error;
        retries += 1;
        await waitForRetry(delay, signal);
      }
    }
  }
}
