import type { Departure } from './types';

export const PINNED_LINES_STORAGE_KEY = 'vasttrafik-home-assistant-card:pinned-lines';
export const PINS_CHANGED_EVENT = 'vt-pinned-lines-changed';

export function readPinnedLines(): string[] {
  try {
    const pins: unknown = JSON.parse(localStorage.getItem(PINNED_LINES_STORAGE_KEY) ?? '[]');
    return Array.isArray(pins) && pins.every((pin) => typeof pin === 'string' && pin.length > 0) ? pins : [];
  } catch {
    return [];
  }
}

export function savePinnedLines(pinnedLines: string[]): void {
  try {
    localStorage.setItem(PINNED_LINES_STORAGE_KEY, JSON.stringify(pinnedLines));
  } catch {
    // Pinning still works for this session when browser storage is unavailable.
  }
}

export function togglePinnedLine(pinnedLines: readonly string[], gid: string): string[] {
  if (!gid) return [...pinnedLines];
  return pinnedLines.includes(gid) ? pinnedLines.filter((pin) => pin !== gid) : [...pinnedLines, gid];
}

export function prioritizePinnedLines(groups: Departure[][], pinnedLines: readonly string[]): Departure[][] {
  const pins = new Set(pinnedLines);
  const pinned: Departure[][] = [];
  const unpinned: Departure[][] = [];
  for (const group of groups) {
    const gid = group[0]?.serviceJourney.gid;
    (gid && pins.has(gid) ? pinned : unpinned).push(group);
  }
  return [...pinned, ...unpinned];
}
