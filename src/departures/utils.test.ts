import { describe, expect, it } from 'vitest';
import type { Departure } from './types';
import {
  getMinutesUntilDeparture,
  groupDepartures,
  normalizeDirection,
  resolveDepartureTime,
  sortDepartures,
} from './utils';
import { makeDeparture } from '../../tests/fixtures';

describe('normalizeDirection', () => {
  it.each([
    ['Centrum, påstigning fram', 'Centrum'],
    ['Centrum, PÅSTIGNING FRAM', 'Centrum'],
    ['Centrum', 'Centrum'],
    ['Centrum, påstigning fram via Torget', 'Centrum, påstigning fram via Torget'],
    ['', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeDirection(input)).toBe(expected);
  });
});

describe('groupDepartures', () => {
  it('returns no groups for an empty timetable', () => {
    expect(groupDepartures([])).toEqual({});
  });

  it('groups matching lines, platforms and normalized directions', () => {
    const first = makeDeparture();
    const second = makeDeparture({
      detailsReference: 'journey-2',
      serviceJourney: { ...first.serviceJourney, direction: 'Centrum, påstigning fram' },
    });
    expect(groupDepartures([first, second])).toEqual({ '1:A:Centrum': [first, second] });
  });

  it('keeps different lines, platforms and directions separate', () => {
    const first = makeDeparture();
    const line = makeDeparture({
      serviceJourney: { ...first.serviceJourney, line: { ...first.serviceJourney.line, shortName: '2' } },
    });
    const platform = makeDeparture({ stopPoint: { name: 'Brunnsparken', platform: 'B' } });
    const direction = makeDeparture({ serviceJourney: { ...first.serviceJourney, direction: 'Torget' } });
    expect(groupDepartures([first, line, platform, direction])).toEqual({
      '1:A:Centrum': [first],
      '2:A:Centrum': [line],
      '1:B:Centrum': [platform],
      '1:A:Torget': [direction],
    });
  });

  it('skips API entries with missing line data', () => {
    const malformed = { ...makeDeparture(), serviceJourney: {} } as Departure;
    expect(groupDepartures([malformed])).toEqual({});
  });

  it('uses an empty platform when API stop point data is absent', () => {
    const departure = { ...makeDeparture(), stopPoint: undefined } as unknown as Departure;
    expect(groupDepartures([departure])).toEqual({ '1::Centrum': [departure] });
  });
});

describe('sortDepartures', () => {
  it('returns an empty timetable for no groups', () => {
    expect(sortDepartures({})).toEqual([]);
  });

  it('orders each group and then groups by their earliest departure', () => {
    const early = makeDeparture({ detailsReference: 'early', estimatedOtherwisePlannedTime: '2026-11-02T09:00:00Z' });
    const middle = makeDeparture({ detailsReference: 'middle', estimatedOtherwisePlannedTime: '2026-11-02T09:30:00Z' });
    const late = makeDeparture({ detailsReference: 'late', estimatedOtherwisePlannedTime: '2026-11-02T10:00:00Z' });
    expect(sortDepartures({ second: [middle], first: [late, early] })).toEqual([[early, late], [middle]]);
  });

  it('preserves input order for equal departure times', () => {
    const first = makeDeparture({ detailsReference: 'first' });
    const second = makeDeparture({ detailsReference: 'second' });
    expect(sortDepartures({ same: [first, second] })).toEqual([[first, second]]);
  });

  it.each([undefined, 'not-a-date'])('retains a lone departure with an unusable timestamp: %j', (time) => {
    const departure = makeDeparture({ estimatedOtherwisePlannedTime: time });
    expect(sortDepartures({ only: [departure] })).toEqual([[departure]]);
  });

  it('sorts valid fallback timestamps before unknown times without mutating group arrays', () => {
    const unknown = makeDeparture({
      detailsReference: 'unknown',
      estimatedOtherwisePlannedTime: 'not-a-date',
      estimatedTime: undefined,
      plannedTime: undefined,
    });
    const planned = makeDeparture({
      detailsReference: 'planned',
      estimatedOtherwisePlannedTime: undefined,
      estimatedTime: undefined,
      plannedTime: '2026-11-02T09:45:00Z',
    });
    const estimated = makeDeparture({
      detailsReference: 'estimated',
      estimatedOtherwisePlannedTime: undefined,
      estimatedTime: '2026-11-02T09:30:00Z',
    });
    const earliest = makeDeparture({
      detailsReference: 'earliest',
      estimatedOtherwisePlannedTime: '2026-11-02T09:00:00Z',
    });
    const departures = [unknown, planned, estimated, earliest];

    expect(sortDepartures({ unknown: [unknown], mixed: departures })).toEqual([
      [earliest, estimated, planned, unknown],
      [unknown],
    ]);
    expect(departures).toEqual([unknown, planned, estimated, earliest]);
  });
});

describe('resolveDepartureTime', () => {
  it('uses the first valid timestamp in estimated-otherwise, estimated, planned order', () => {
    expect(
      resolveDepartureTime(
        makeDeparture({
          estimatedOtherwisePlannedTime: 'not-a-date',
          estimatedTime: '2026-11-02T09:30:00Z',
          plannedTime: '2026-11-02T09:45:00Z',
        }),
      ),
    ).toBe('2026-11-02T09:30:00Z');
    expect(
      resolveDepartureTime(
        makeDeparture({
          estimatedOtherwisePlannedTime: 'not-a-date',
          estimatedTime: 'also-not-a-date',
          plannedTime: '2026-11-02T09:45:00Z',
        }),
      ),
    ).toBe('2026-11-02T09:45:00Z');
  });

  it('returns undefined when all timestamps are missing or invalid', () => {
    expect(
      resolveDepartureTime(
        makeDeparture({
          estimatedOtherwisePlannedTime: 'not-a-date',
          estimatedTime: undefined,
          plannedTime: undefined,
        }),
      ),
    ).toBeUndefined();
  });
});

describe('getMinutesUntilDeparture', () => {
  it('uses the first valid fallback timestamp when calculating minutes', () => {
    const departure = makeDeparture({
      estimatedOtherwisePlannedTime: 'not-a-date',
      estimatedTime: undefined,
      plannedTime: '2026-11-02T10:00:40Z',
    });

    expect(getMinutesUntilDeparture(departure, Date.parse('2026-11-02T10:00:00Z'))).toBe(1);
  });

  it('returns a dash for unusable timestamps and clamps past departures to zero', () => {
    const unknown = makeDeparture({
      estimatedOtherwisePlannedTime: 'not-a-date',
      estimatedTime: undefined,
      plannedTime: undefined,
    });
    const past = makeDeparture({ estimatedOtherwisePlannedTime: '2026-11-02T09:59:00Z' });
    const now = Date.parse('2026-11-02T10:00:00Z');

    expect(getMinutesUntilDeparture(unknown, now)).toBe('-');
    expect(getMinutesUntilDeparture(past, now)).toBe(0);
  });
});
