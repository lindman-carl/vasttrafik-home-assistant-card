import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected network request in unit test')));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
