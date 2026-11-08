import type { Departure } from './types';
import { resolveDepartureTime } from './utils';

interface TriggerInput {
  stopGid: string;
  groups: Departure[][];
  pinnedJourneys: readonly string[];
  minutes: number;
  now: number;
}

interface TriggerResult {
  departures: Departure[];
  nextCheckAt?: number;
}

/** Crossing observations are transient; attempted departures last for the card session. */
export class DepartureTriggerMonitor {
  private observations = new Map<string, boolean>();
  private readonly attempted = new Set<string>();

  public clearObservations(): void {
    this.observations.clear();
  }

  public evaluate({ stopGid, groups, pinnedJourneys, minutes, now }: TriggerInput): TriggerResult {
    const pins = new Set(pinnedJourneys);
    const observations = new Map<string, boolean>();
    const result: TriggerResult = { departures: [] };

    for (const group of groups) {
      const departure = group[0];
      if (!departure || !pins.has(departure.serviceJourney.gid) || departure.isCancelled || departure.isPartCancelled) {
        continue;
      }
      const time = resolveDepartureTime(departure);
      if (time === undefined) continue;
      const timestamp = Date.parse(time);
      if (timestamp <= now) continue;

      const planned = departure.plannedTime;
      const key = JSON.stringify([
        stopGid,
        departure.serviceJourney.gid,
        departure.detailsReference,
        planned && Number.isFinite(Date.parse(planned)) ? Date.parse(planned) : null,
      ]);
      if (this.attempted.has(key) || observations.has(key)) continue;

      const thresholdAt = timestamp - minutes * 60_000;
      const above = now < thresholdAt;
      observations.set(key, above);
      if (!above && this.observations.get(key) === true) {
        this.attempted.add(key);
        result.departures.push(departure);
      } else if (above) {
        result.nextCheckAt = Math.min(result.nextCheckAt ?? thresholdAt, thresholdAt);
      }
    }

    this.observations = observations;
    return result;
  }
}
