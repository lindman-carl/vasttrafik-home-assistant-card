import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prioritizePinnedLines, readPinnedLines, savePinnedLines, togglePinnedLine } from './pinned-lines';
import { makeDeparture } from '../../tests/fixtures';

const storageKey = 'vasttrafik-home-assistant-card:pinned-lines';

describe('pinned line persistence', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  it('persists multiple GIDs as a JSON array and reads them back', () => {
    savePinnedLines(['line-a', 'line-b']);
    expect(JSON.parse(localStorage.getItem(storageKey) ?? 'null')).toEqual(['line-a', 'line-b']);
    expect(readPinnedLines()).toEqual(['line-a', 'line-b']);
  });

  it('returns no pins when nothing was stored', () => {
    expect(readPinnedLines()).toEqual([]);
  });

  it.each(['{', '{}', 'null', '["a", 1]', '[""]'])('ignores invalid stored pins: %s', (value) => {
    localStorage.setItem(storageKey, value);
    expect(readPinnedLines()).toEqual([]);
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
    expect(readPinnedLines()).toEqual([]);
    expect(() => savePinnedLines(['a'])).not.toThrow();
  });

  it('tolerates an unavailable localStorage global', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readPinnedLines()).toEqual([]);
    expect(() => savePinnedLines(['a'])).not.toThrow();
  });
});

describe('pinned line toggling', () => {
  it('adds, removes and re-adds GIDs without changing the original pins', () => {
    const pins = ['a'];
    expect(togglePinnedLine(pins, 'b')).toEqual(['a', 'b']);
    expect(togglePinnedLine(['a', 'b'], 'a')).toEqual(['b']);
    expect(togglePinnedLine(['b'], 'a')).toEqual(['b', 'a']);
    expect(pins).toEqual(['a']);
  });

  it('ignores empty GIDs', () => {
    expect(togglePinnedLine(['a'], '')).toEqual(['a']);
  });
});

describe('pinned line display ordering', () => {
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
    expect(prioritizePinnedLines(groups, pins)).toEqual([pinned, anotherPinned, sameGid, unpinned, missingGid]);
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
    expect(prioritizePinnedLines([first, second], ['journey-b'])).toEqual([second, first]);
    expect(prioritizePinnedLines([first, second], ['shared-line'])).toEqual([first, second]);
  });

  it('accepts empty groups without fabricating rows', () => {
    expect(prioritizePinnedLines([], ['a'])).toEqual([]);
    expect(prioritizePinnedLines([[]], ['a'])).toEqual([[]]);
  });
});
