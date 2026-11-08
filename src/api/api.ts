import { z } from 'zod';
import { HttpError, requestJson, retryDelay, waitForRetry } from './request';
import { TokenManager } from './token-manager';
import { DepartureSchema, type StopArea } from '../departures/types';
import { groupDepartures, sortDepartures } from '../departures/utils';

const BASE_URL = 'https://ext-api.vasttrafik.se/pr/v4';

const LocationsResponseSchema = z.object({
  results: z
    .array(z.object({ gid: z.string().nullable().optional() }))
    .nullable()
    .optional(),
});
// Normalize unavailable transport fields while keeping internal Departure values canonical.
const ApiTimeSchema = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);
const ApiDepartureSchema = DepartureSchema.extend({
  plannedTime: ApiTimeSchema,
  estimatedTime: ApiTimeSchema,
  estimatedOtherwisePlannedTime: ApiTimeSchema,
});
const DeparturesResponseSchema = z.object({ results: z.array(ApiDepartureSchema).nullish() });

export class VasttrafikApi {
  private readonly tokenManager = new TokenManager();
  private readonly stopGids = new Map<string, string>();

  public setCredentials(clientId: string, clientSecret: string): void {
    this.tokenManager.setCredentials(clientId, clientSecret);
  }

  public async resolveStopAreaGid(stopName: string, signal?: AbortSignal): Promise<string | null> {
    signal?.throwIfAborted();
    const cached = this.stopGids.get(stopName);
    if (cached) return cached;
    const params = new URLSearchParams({
      q: stopName,
      types: 'stoparea',
      limit: '1',
    });
    const response = await this.fetchWithAuth(
      `${BASE_URL}/locations/by-text?${params}`,
      LocationsResponseSchema,
      signal,
    );
    signal?.throwIfAborted();
    const gid = response.results?.[0]?.gid ?? null;
    if (gid) this.stopGids.set(stopName, gid);
    return gid;
  }

  public async fetchStopArea(options: {
    gid?: string;
    stopName?: string;
    limit: number;
    signal?: AbortSignal;
  }): Promise<StopArea> {
    options.signal?.throwIfAborted();
    let stopAreaGid = options.gid ?? null;

    if (!stopAreaGid && options.stopName) {
      stopAreaGid = await this.resolveStopAreaGid(options.stopName, options.signal);
    }

    if (!stopAreaGid) {
      throw new Error('Could not determine a stop area GID.');
    }

    const params = new URLSearchParams({
      limit: String(options.limit),
      maxDeparturesPerLineAndDirection: '2',
    });
    const response = await this.fetchWithAuth(
      `${BASE_URL}/stop-areas/${encodeURIComponent(stopAreaGid)}/departures?${params}`,
      DeparturesResponseSchema,
      options.signal,
    );
    const departures = response.results ?? [];

    return {
      name: departures[0]?.stopPoint?.name ?? '-',
      gid: stopAreaGid,
      departures,
      groupedDepartures: sortDepartures(groupDepartures(departures)),
    };
  }

  private async fetchWithAuth<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    let authenticationRetried = false;
    let transientRetries = 0;
    while (true) {
      signal?.throwIfAborted();
      const bearer = await this.tokenManager.getBearerToken(signal);
      try {
        return await requestJson(
          url,
          { headers: { Authorization: bearer }, signal },
          schema,
          'API request failed',
          'API did not include a valid response.',
        );
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof HttpError)) throw error;
        if (error.status === 401 && !authenticationRetried) {
          authenticationRetried = true;
          this.tokenManager.invalidateToken();
          continue;
        }
        const delay = retryDelay(error, transientRetries);
        if (delay === undefined) throw error;
        transientRetries += 1;
        await waitForRetry(delay, signal);
      }
    }
  }
}
