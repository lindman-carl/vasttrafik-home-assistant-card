import type { z } from 'zod';

const REQUEST_TIMEOUT_MS = 30_000;

export class HttpError extends Error {
  public readonly status: number;
  public readonly retryAfterMs: number;

  public constructor(response: Response, prefix: string) {
    super(`${prefix}: ${response.status} ${response.statusText}`);
    this.status = response.status;
    const header = response.headers.get('Retry-After');
    const seconds = header && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : Number.NaN;
    const delay = header ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()) : 0;
    // Keep scheduled delays within the browser timer range.
    this.retryAfterMs = Number.isFinite(delay) ? Math.min(Math.max(delay, 0), 2_147_483_647) : 0;
  }
}

export class ResponseError extends Error {
  public readonly translationKey = 'errors.api_response_invalid';
}

export class RequestTimeoutError extends Error {
  public readonly translationKey = 'errors.request_timeout';

  public constructor() {
    super('Request timed out.');
    this.name = 'TimeoutError';
  }
}

export async function requestJson<T>(
  url: string,
  options: RequestInit,
  schema: z.ZodType<T>,
  failurePrefix: string,
  invalidMessage: string,
): Promise<T> {
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new RequestTimeoutError()), REQUEST_TIMEOUT_MS);
  let rejectAborted!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const onRequestAbort = (): void => rejectAborted(controller.signal.reason);
  controller.signal.addEventListener('abort', onRequestAbort, { once: true });

  try {
    const request = (async (): Promise<T> => {
      const response = await fetch(url, { ...options, signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!response.ok) throw new HttpError(response, failurePrefix);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        controller.signal.throwIfAborted();
        throw new ResponseError(invalidMessage);
      }
      controller.signal.throwIfAborted();
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new ResponseError(invalidMessage);
      return parsed.data;
    })();
    // Racing guarantees settlement even if a fetch implementation ignores abort.
    return await Promise.race([request, aborted]);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
    controller.signal.removeEventListener('abort', onRequestAbort);
  }
}

export function retryDelay(error: unknown, retries: number): number | undefined {
  if (
    !(error instanceof HttpError) ||
    ![429, 500, 502, 503, 504].includes(error.status) ||
    retries >= 2 ||
    error.retryAfterMs > 60_000
  )
    return undefined;
  return Math.max(1000 * 2 ** retries, error.retryAfterMs);
}

export function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
