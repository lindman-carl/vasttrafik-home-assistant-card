import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDeparture } from '../../tests/fixtures';
import type { Departure } from './types';
import { DepartureTriggerMonitor } from './departure-trigger';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const at = (minutes: number): string => new Date(NOW + minutes * 60_000).toISOString();
const departure = (minutes = 10, overrides: Partial<Departure> = {}): Departure =>
  makeDeparture({ plannedTime: at(10), estimatedOtherwisePlannedTime: at(minutes), ...overrides });

describe('DepartureTriggerMonitor', () => {
  let monitor: DepartureTriggerMonitor;
  const evaluate = (
    groups: Departure[][],
    now = Date.now(),
    pinnedJourneys = ['service-journey-1'],
    stopGid = 'stop',
  ) => monitor.evaluate({ groups, now, pinnedJourneys, stopGid, minutes: 5 });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    monitor = new DepartureTriggerMonitor();
  });

  it('crosses the exact five-minute boundary only once', () => {
    const d = departure();
    expect(evaluate([[d]], NOW + 299_999)).toEqual({ departures: [], nextCheckAt: NOW + 300_000 });
    expect(evaluate([[d]], NOW + 300_000).departures).toEqual([d]);
    expect(evaluate([[d]], NOW + 300_001)).toEqual({ departures: [] });
  });

  it.each([4, 5])('does not trigger a first observation %i minutes away', (minutes) => {
    expect(evaluate([[departure(minutes)]])).toEqual({ departures: [] });
    expect(evaluate([[departure(minutes)]], NOW + 60_000)).toEqual({ departures: [] });
  });

  it('counts a refreshed six-to-four-minute jump without changing identity', () => {
    expect(evaluate([[departure(6)]]).departures).toEqual([]);
    const revised = departure(4);
    expect(evaluate([[revised]]).departures).toEqual([revised]);
  });

  it('does not reattempt after delay recrossing, clearing, or unpinning', () => {
    evaluate([[departure(6)]]);
    expect(evaluate([[departure(4)]]).departures).toHaveLength(1);
    evaluate([[departure(8)]]);
    expect(evaluate([[departure(4)]]).departures).toEqual([]);
    monitor.clearObservations();
    evaluate([[departure(8)]]);
    expect(evaluate([[departure(4)]]).departures).toEqual([]);
    evaluate([[departure(8)]], NOW, []);
    evaluate([[departure(8)]]);
    expect(evaluate([[departure(4)]]).departures).toEqual([]);
  });

  it('only monitors the first departure of a pinned row', () => {
    const unpinned = departure(6, { serviceJourney: { ...departure().serviceJourney, gid: 'other' } });
    expect(evaluate([[unpinned, departure(6)]])).toEqual({ departures: [] });
    expect(evaluate([[{ ...unpinned, estimatedOtherwisePlannedTime: at(4) }, departure(4)]])).toEqual({
      departures: [],
    });
  });

  it('deduplicates duplicate rows while keeping distinct departures of the same journey', () => {
    const a = departure(6);
    const b = departure(7, { detailsReference: 'second', plannedTime: at(11) });
    expect(evaluate([[a], [a], [b]]).nextCheckAt).toBe(NOW + 60_000);
    const revisedA = { ...a, estimatedOtherwisePlannedTime: at(4) };
    const revisedB = { ...b, estimatedOtherwisePlannedTime: at(4) };
    expect(evaluate([[revisedA], [revisedA], [revisedB]]).departures).toEqual([revisedA, revisedB]);
  });

  it.each([
    { isCancelled: true },
    { isPartCancelled: true },
    { plannedTime: undefined, estimatedOtherwisePlannedTime: undefined, estimatedTime: undefined },
    { plannedTime: 'bad', estimatedOtherwisePlannedTime: 'bad', estimatedTime: 'bad' },
    { estimatedOtherwisePlannedTime: at(0) },
    { estimatedOtherwisePlannedTime: at(-1) },
  ])('excludes ineligible departures %j', (overrides) => {
    expect(evaluate([[departure(6, overrides)]])).toEqual({ departures: [] });
  });

  it('resolves invalid primary times through the estimated then planned fallback', () => {
    const d = departure(6, { estimatedOtherwisePlannedTime: 'bad', estimatedTime: at(6) });
    expect(evaluate([[d]]).nextCheckAt).toBe(NOW + 60_000);
    expect(evaluate([[{ ...d, estimatedTime: at(4) }]]).departures).toHaveLength(1);
    monitor = new DepartureTriggerMonitor();
    const planned = departure(6, { estimatedOtherwisePlannedTime: undefined, plannedTime: at(6) });
    expect(evaluate([[planned]]).nextCheckAt).toBe(NOW + 60_000);
    expect(evaluate([[planned]], NOW + 60_000).departures).toEqual([planned]);
  });

  it.each(['stop', 'journey', 'details', 'planned'] as const)(
    'starts a new baseline for a changed %s identity',
    (field) => {
      evaluate([[departure(6)]]);
      const d = departure(4, {
        ...(field === 'journey' ? { serviceJourney: { ...departure().serviceJourney, gid: 'new' } } : {}),
        ...(field === 'details' ? { detailsReference: 'new' } : {}),
        ...(field === 'planned' ? { plannedTime: at(11) } : {}),
      });
      const pins = [d.serviceJourney.gid];
      const stop = field === 'stop' ? 'new' : 'stop';
      expect(evaluate([[d]], NOW, pins, stop).departures).toEqual([]);
      evaluate([[{ ...d, estimatedOtherwisePlannedTime: at(6) }]], NOW, pins, stop);
      expect(evaluate([[d]], NOW, pins, stop).departures).toEqual([d]);
    },
  );

  it.each(['absent', 'unpinned', 'cancelled', 'cleared'] as const)('forgets a crossing baseline when %s', (kind) => {
    evaluate([[departure(6)]]);
    if (kind === 'cleared') monitor.clearObservations();
    else
      evaluate(
        kind === 'absent' ? [] : [[departure(6, { isCancelled: kind === 'cancelled' })]],
        NOW,
        kind === 'unpinned' ? [] : undefined,
      );
    expect(evaluate([[departure(4)]]).departures).toEqual([]);
    evaluate([[departure(6)]]);
    expect(evaluate([[departure(4)]]).departures).toHaveLength(1);
  });

  it('does not catch up an expired departure after a large clock leap', () => {
    evaluate([[departure(6)]]);
    expect(evaluate([[departure(6)]], NOW + 7 * 60_000)).toEqual({ departures: [] });
  });
});
