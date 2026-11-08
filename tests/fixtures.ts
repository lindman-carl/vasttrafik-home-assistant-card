import type { Departure } from '../src/departures/types';

export function makeDeparture(overrides: Partial<Departure> = {}): Departure {
  return {
    detailsReference: 'journey-1',
    serviceJourney: {
      gid: 'service-journey-1',
      direction: 'Centrum',
      line: {
        name: 'Spårvagn 1',
        shortName: '1',
        backgroundColor: '#ffffff',
        foregroundColor: '#000000',
        borderColor: '#ffffff',
        transportMode: 'tram',
      },
    },
    stopPoint: { name: 'Brunnsparken', platform: 'A' },
    plannedTime: '2026-11-02T10:00:00Z',
    estimatedOtherwisePlannedTime: '2026-11-02T10:00:00Z',
    isCancelled: false,
    isPartCancelled: false,
    ...overrides,
  };
}

export function jsonResponse(body: unknown): Response {
  return Response.json(body);
}
