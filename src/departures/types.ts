import type { LovelaceCard, LovelaceCardEditor } from 'custom-card-helpers';
import { z } from 'zod';

declare global {
  interface HTMLElementTagNameMap {
    'vasttrafik-card-editor': LovelaceCardEditor;
    'hui-error-card': LovelaceCard;
  }
}

export const LineSchema = z.object({
  gid: z.string().optional(),
  name: z.string(),
  shortName: z.string(),
  backgroundColor: z.string(),
  foregroundColor: z.string(),
  borderColor: z.string(),
  transportMode: z.string(),
});

export type Line = z.infer<typeof LineSchema>;

export const ServiceJourneySchema = z.object({
  gid: z.string(),
  direction: z.string(),
  line: LineSchema,
});

export type ServiceJourney = z.infer<typeof ServiceJourneySchema>;

export const StopPointSchema = z.object({
  name: z.string(),
  platform: z.string(),
});

export type StopPoint = z.infer<typeof StopPointSchema>;

export const DepartureSchema = z.object({
  detailsReference: z.string(),
  serviceJourney: ServiceJourneySchema,
  stopPoint: StopPointSchema,
  plannedTime: z.string().optional(),
  estimatedTime: z.string().optional(),
  estimatedOtherwisePlannedTime: z.string().optional(),
  isCancelled: z.boolean(),
  isPartCancelled: z.boolean(),
});

export type Departure = z.infer<typeof DepartureSchema>;

export const GroupedDeparturesSchema = z.record(z.string(), z.array(DepartureSchema));

export type GroupedDepartures = z.infer<typeof GroupedDeparturesSchema>;

export const StopAreaSchema = z.object({
  name: z.string(),
  gid: z.string(),
  departures: z.array(DepartureSchema),
  groupedDepartures: z.array(z.array(DepartureSchema)),
});

export type StopArea = z.infer<typeof StopAreaSchema>;
