import type { LovelaceCardConfig } from 'custom-card-helpers';
import { z } from 'zod';

const DEFAULT_TYPE = 'custom:vasttrafik-home-assistant-card';
const DEFAULT_STOP_NAME = 'Brunnsparken, Göteborg';
export const DEFAULT_DEPARTURE_TRIGGER_MINUTES = 5;

const nonBlankString = z.string().refine((value) => value.trim().length > 0);

/** Structural schema for card configuration; unknown Home Assistant fields are retained. */
export const ConfigSchema = z.looseObject({
  type: z.string().default(DEFAULT_TYPE),
  gid: nonBlankString.optional(),
  stop_name: nonBlankString.default(DEFAULT_STOP_NAME),
  client_id: z.string().default(''),
  client_secret: z.string().default(''),
  language: z.enum(['sv', 'en']).optional(),
  time_table_height: z.number().min(100).max(1000).default(250),
  limit: z.number().int().min(1).max(100).default(50),
  refresh_interval: z.number().min(10).max(3600).default(60),
  automation_entity: z
    .string()
    .regex(/^automation\.[a-z0-9_]+$/)
    .refine((value) => value === value.trim())
    .optional(),
  departure_trigger_minutes: z.number().int().min(1).max(60).optional(),
});

/** Full schema for a usable card configuration, including credential and stop requirements. */
export const ValidatedConfigSchema = ConfigSchema.extend({
  client_id: nonBlankString,
  client_secret: nonBlankString,
});

export type VasttrafikCardConfig = z.input<typeof ConfigSchema> & LovelaceCardConfig;
export type ResolvedCardConfig = z.output<typeof ConfigSchema> & LovelaceCardConfig;

export type ConfigErrorKey =
  | 'errors.invalid_configuration'
  | 'errors.client_id_required'
  | 'errors.client_secret_required'
  | 'errors.stop_required'
  | 'errors.language_invalid'
  | 'errors.height_positive'
  | 'errors.limit_positive'
  | 'errors.refresh_positive'
  | 'errors.automation_entity_invalid'
  | 'errors.departure_trigger_minutes_invalid';

export const DEFAULT_CONFIG: ResolvedCardConfig = {
  type: DEFAULT_TYPE,
  stop_name: DEFAULT_STOP_NAME,
  client_id: '',
  client_secret: '',
  time_table_height: 250,
  limit: 50,
  refresh_interval: 60,
};

/** Apply defaults without coercing malformed runtime values or discarding HA fields. */
export function resolveConfig(config: VasttrafikCardConfig): ResolvedCardConfig {
  const parsed = ConfigSchema.safeParse(config);
  if (parsed.success) return parsed.data as ResolvedCardConfig;

  if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
    const resolved = { ...DEFAULT_CONFIG, ...config };
    if (config.type === undefined) resolved.type = DEFAULT_CONFIG.type;
    if (config.stop_name === undefined) resolved.stop_name = DEFAULT_CONFIG.stop_name;
    if (config.client_id === undefined) resolved.client_id = DEFAULT_CONFIG.client_id;
    if (config.client_secret === undefined) resolved.client_secret = DEFAULT_CONFIG.client_secret;
    if (config.time_table_height === undefined) resolved.time_table_height = DEFAULT_CONFIG.time_table_height;
    if (config.limit === undefined) resolved.limit = DEFAULT_CONFIG.limit;
    if (config.refresh_interval === undefined) resolved.refresh_interval = DEFAULT_CONFIG.refresh_interval;
    return resolved as ResolvedCardConfig;
  }

  return { ...DEFAULT_CONFIG };
}

/** Return the localized error key for the first invalid configuration concern. */
export function validateConfig(config: unknown): ConfigErrorKey | undefined {
  const result = ValidatedConfigSchema.safeParse(config);
  if (result.success) return undefined;

  const issues = result.error.issues;
  const hasPath = (field: string): boolean => issues.some((issue) => issue.path[0] === field);

  if (hasPath('client_id')) return 'errors.client_id_required';
  if (hasPath('client_secret')) return 'errors.client_secret_required';
  if (hasPath('gid') || hasPath('stop_name')) return 'errors.stop_required';
  if (hasPath('time_table_height')) return 'errors.height_positive';
  if (hasPath('limit')) return 'errors.limit_positive';
  if (hasPath('refresh_interval')) return 'errors.refresh_positive';
  if (hasPath('language')) return 'errors.language_invalid';
  if (hasPath('automation_entity')) return 'errors.automation_entity_invalid';
  if (hasPath('departure_trigger_minutes')) return 'errors.departure_trigger_minutes_invalid';
  return 'errors.invalid_configuration';
}
