import type { Departure, GroupedDepartures } from './types';

const BOARDING_SUFFIX = /, påstigning fram$/i;

export function normalizeDirection(direction: string): string {
  return direction.replace(BOARDING_SUFFIX, '');
}

export function groupDepartures(departures: Departure[]): GroupedDepartures {
  return departures.reduce<GroupedDepartures>((groups, departure) => {
    const line = departure.serviceJourney?.line;
    if (!line) return groups;

    const key = `${line.shortName}:${departure.stopPoint?.platform ?? ''}:${normalizeDirection(
      departure.serviceJourney.direction,
    )}`;
    (groups[key] ??= []).push(departure);
    return groups;
  }, {});
}

export function resolveDepartureTime(departure: Departure): string | undefined {
  for (const time of [departure.estimatedOtherwisePlannedTime, departure.estimatedTime, departure.plannedTime]) {
    if (time !== undefined && Number.isFinite(Date.parse(time))) return time;
  }

  return undefined;
}

function departureTimestamp(departure: Departure): number | undefined {
  const time = resolveDepartureTime(departure);
  return time === undefined ? undefined : Date.parse(time);
}

function compareTimestamps(left: number | undefined, right: number | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return left - right;
}

export function getMinutesUntilDeparture(departure: Departure | undefined, now = Date.now()): number | string {
  if (!departure) return '-';

  const timestamp = departureTimestamp(departure);
  if (timestamp === undefined) return '-';

  return Math.max(Math.round((timestamp - now) / 60_000), 0);
}

export function sortDepartures(groupedDepartures: GroupedDepartures): Departure[][] {
  const groups = Object.values(groupedDepartures).map((departures) => [...departures]);

  for (const departures of groups) {
    departures.sort((left, right) => compareTimestamps(departureTimestamp(left), departureTimestamp(right)));
  }

  return groups.sort((left, right) =>
    compareTimestamps(
      left[0] ? departureTimestamp(left[0]) : undefined,
      right[0] ? departureTimestamp(right[0]) : undefined,
    ),
  );
}
