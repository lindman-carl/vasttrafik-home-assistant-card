import type { Departure } from './types';

export const PINNED_DEPARTURES_STORAGE_KEY = 'vasttrafik-home-assistant-card:pinned-departures';
export const PINS_CHANGED_EVENT = 'vt-pinned-departures-changed';

export function readPinnedDepartures(): string[] {
  try {
    const pins: unknown = JSON.parse(localStorage.getItem(PINNED_DEPARTURES_STORAGE_KEY) ?? '[]');
    return Array.isArray(pins) && pins.every((pin) => typeof pin === 'string' && pin.length > 0) ? pins : [];
  } catch {
    return [];
  }
}

export function savePinnedDepartures(pinnedDepartures: string[]): void {
  try {
    localStorage.setItem(PINNED_DEPARTURES_STORAGE_KEY, JSON.stringify(pinnedDepartures));
  } catch {
    // Pinning still works for this session when browser storage is unavailable.
  }
}

export function togglePinnedDeparture(pinnedDepartures: readonly string[], gid: string): string[] {
  if (!gid) return [...pinnedDepartures];
  return pinnedDepartures.includes(gid) ? pinnedDepartures.filter((pin) => pin !== gid) : [...pinnedDepartures, gid];
}

export function prioritizePinnedDepartures(groups: Departure[][], pinnedDepartures: readonly string[]): Departure[][] {
  const pins = new Set(pinnedDepartures);
  const pinned: Departure[][] = [];
  const unpinned: Departure[][] = [];
  for (const group of groups) {
    const gid = group[0]?.serviceJourney.gid;
    (gid && pins.has(gid) ? pinned : unpinned).push(group);
  }
  return [...pinned, ...unpinned];
}
