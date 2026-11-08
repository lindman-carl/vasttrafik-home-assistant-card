import { describe, expect, it } from 'vitest';
import {
  DepartureSchema,
  GroupedDeparturesSchema,
  LineSchema,
  ServiceJourneySchema,
  StopAreaSchema,
  StopPointSchema,
} from './types';
import { makeDeparture } from '../../tests/fixtures';

describe('domain schemas', () => {
  const departure = makeDeparture();
  const line = departure.serviceJourney.line;
  const stopArea = {
    name: 'Brunnsparken',
    gid: 'stop-area-1',
    departures: [departure],
    groupedDepartures: [[departure]],
  };

  it.each([
    ['line without an optional GID', LineSchema, line],
    ['line with a GID', LineSchema, { ...line, gid: 'line-1' }],
    ['service journey', ServiceJourneySchema, departure.serviceJourney],
    ['stop point', StopPointSchema, departure.stopPoint],
    ['departure', DepartureSchema, departure],
    ['grouped departures', GroupedDeparturesSchema, { Centrum: [departure] }],
    ['empty grouped departures', GroupedDeparturesSchema, {}],
    ['stop area', StopAreaSchema, stopArea],
  ])('accepts a valid %s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it('accepts a departure without optional times', () => {
    const { plannedTime, estimatedTime, estimatedOtherwisePlannedTime, ...withoutTimes } = departure;
    expect(DepartureSchema.safeParse(withoutTimes).success).toBe(true);
  });

  it.each([
    ['missing line name', LineSchema, { ...line, name: undefined }],
    ['non-string line GID', LineSchema, { ...line, gid: 123 }],
    ['missing journey GID', ServiceJourneySchema, { ...departure.serviceJourney, gid: undefined }],
    ['invalid nested line', ServiceJourneySchema, { ...departure.serviceJourney, line: {} }],
    ['missing platform', StopPointSchema, { name: 'Brunnsparken' }],
    ['non-string time', DepartureSchema, { ...departure, plannedTime: 123 }],
    ['null optional time', DepartureSchema, { ...departure, estimatedTime: null }],
    ['non-boolean cancellation', DepartureSchema, { ...departure, isCancelled: 'false' }],
    ['missing partial cancellation', DepartureSchema, { ...departure, isPartCancelled: undefined }],
    ['invalid nested stop', DepartureSchema, { ...departure, stopPoint: {} }],
    ['non-array group', GroupedDeparturesSchema, { Centrum: departure }],
    ['invalid grouped departure', GroupedDeparturesSchema, { Centrum: [{}] }],
    ['missing stop area GID', StopAreaSchema, { ...stopArea, gid: undefined }],
    ['invalid stop area departure', StopAreaSchema, { ...stopArea, departures: [{}] }],
    ['flat stop area groups', StopAreaSchema, { ...stopArea, groupedDepartures: [departure] }],
  ])('rejects %s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
