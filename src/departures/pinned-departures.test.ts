import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  prioritizePinnedDepartures,
  readPinnedDepartures,
  savePinnedDepartures,
  togglePinnedDeparture,
} from './pinned-departures';
import { makeDeparture } from '../../tests/fixtures';

const storageKey = 'vasttrafik-home-assistant-card:pinned-departures';

describe('pinned departure persistence', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  it('persists multiple GIDs as a JSON array and reads them back', () => {
    savePinnedDepartures(['journey-a', 'journey-b']);
    expect(JSON.parse(localStorage.getItem(storageKey) ?? 'null')).toEqual(['journey-a', 'journey-b']);
    expect(readPinnedDepartures()).toEqual(['journey-a', 'journey-b']);
  });

  it('returns no pins when nothing was stored', () => {
    expect(readPinnedDepartures()).toEqual([]);
  });

  it.each(['{', '{}', 'null', '["a", 1]', '[""]'])('ignores invalid stored pins: %s', (value) => {
    localStorage.setItem(storageKey, value);
    expect(readPinnedDepartures()).toEqual([]);
  });

  it('tolerates denied storage access', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(readPinnedDepartures()).toEqual([]);
    expect(() => savePinnedDepartures(['a'])).not.toThrow();
  });

  it('tolerates an unavailable localStorage global', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readPinnedDepartures()).toEqual([]);
    expect(() => savePinnedDepartures(['a'])).not.toThrow();
  });
});

describe('pinned departure toggling', () => {
  it('adds, removes and re-adds GIDs without changing the original pins', () => {
    const pins = ['a'];
    expect(togglePinnedDeparture(pins, 'b')).toEqual(['a', 'b']);
    expect(togglePinnedDeparture(['a', 'b'], 'a')).toEqual(['b']);
    expect(togglePinnedDeparture(['b'], 'a')).toEqual(['b', 'a']);
    expect(pins).toEqual(['a']);
  });

  it('ignores empty GIDs', () => {
    expect(togglePinnedDeparture(['a'], '')).toEqual(['a']);
  });
});

describe('pinned departure display ordering', () => {
  it('stably prioritizes all matching rows without altering input or creating absent rows', () => {
    const departure = makeDeparture();
    const group = (gid: string) => [
      makeDeparture({
        serviceJourney: { ...departure.serviceJourney, gid },
      }),
    ];
    const unpinned = group('a');
    const pinned = group('b');
    const missingGid = [makeDeparture({ serviceJourney: { ...departure.serviceJourney, gid: '' } })];
    const anotherPinned = group('c');
    const sameGid = group('b');
    const groups = [unpinned, pinned, missingGid, anotherPinned, sameGid];
    const pins = ['c', 'b', 'absent'];
    expect(prioritizePinnedDepartures(groups, pins)).toEqual([pinned, anotherPinned, sameGid, unpinned, missingGid]);
    expect(groups).toEqual([unpinned, pinned, missingGid, anotherPinned, sameGid]);
    expect(pins).toEqual(['c', 'b', 'absent']);
  });

  it('uses journey GIDs rather than line GIDs when prioritizing rows', () => {
    const departure = makeDeparture();
    const first = [
      makeDeparture({
        serviceJourney: {
          ...departure.serviceJourney,
          gid: 'journey-a',
          line: { ...departure.serviceJourney.line, gid: 'shared-line' },
        },
      }),
    ];
    const second = [
      makeDeparture({
        serviceJourney: {
          ...departure.serviceJourney,
          gid: 'journey-b',
          line: { ...departure.serviceJourney.line, gid: 'shared-line' },
        },
      }),
    ];
    expect(prioritizePinnedDepartures([first, second], ['journey-b'])).toEqual([second, first]);
    expect(prioritizePinnedDepartures([first, second], ['shared-line'])).toEqual([first, second]);
  });

  it('accepts empty groups without fabricating rows', () => {
    expect(prioritizePinnedDepartures([], ['a'])).toEqual([]);
    expect(prioritizePinnedDepartures([[]], ['a'])).toEqual([[]]);
  });
});
