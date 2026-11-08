import { describe, expect, it } from 'vitest';
import { ConfigSchema, DEFAULT_CONFIG, resolveConfig, validateConfig } from './config';
import type { ResolvedCardConfig } from './config';

const validConfig: ResolvedCardConfig = {
  type: 'custom:vasttrafik-home-assistant-card',
  client_id: 'test-client',
  client_secret: 'test-secret',
  stop_name: 'Brunnsparken',
  time_table_height: 250,
  limit: 50,
  refresh_interval: 60,
};

describe('resolveConfig', () => {
  it('fills omitted options with usable defaults', () => {
    expect(resolveConfig({ type: 'custom:vasttrafik-home-assistant-card' })).toEqual({
      type: 'custom:vasttrafik-home-assistant-card',
      stop_name: 'Brunnsparken, Göteborg',
      client_id: '',
      client_secret: '',
      time_table_height: 250,
      limit: 50,
      refresh_interval: 60,
    });
  });

  it('preserves supplied values without mutating the input or defaults', () => {
    const input = { ...validConfig, gid: '123', limit: 10, refresh_interval: 30, time_table_height: 400 };
    const originalDefaults = { ...DEFAULT_CONFIG };
    const resolved = resolveConfig(input);
    expect(resolved).toEqual(input);
    expect(resolved).not.toBe(input);
    resolved.limit = 5;
    expect(input.limit).toBe(10);
    expect(DEFAULT_CONFIG).toEqual(originalDefaults);
  });

  it('applies defaults for undefined options while preserving arbitrary Home Assistant fields', () => {
    const resolved = resolveConfig({
      type: 'custom:vasttrafik-home-assistant-card',
      limit: undefined,
      custom_field: { enabled: true },
    } as unknown as ResolvedCardConfig);

    expect(resolved.limit).toBe(DEFAULT_CONFIG.limit);
    expect(resolved.custom_field).toEqual({ enabled: true });
  });

  it('does not coerce malformed raw values and resolves non-object input safely', () => {
    const malformed = resolveConfig({ limit: '12', refresh_interval: undefined } as unknown as ResolvedCardConfig);
    expect(malformed.limit).toBe('12');
    expect(malformed.refresh_interval).toBe(DEFAULT_CONFIG.refresh_interval);
    expect(resolveConfig(null as unknown as ResolvedCardConfig)).toEqual(DEFAULT_CONFIG);
  });
});

describe('validateConfig', () => {
  it('keeps departure automation optional without changing existing defaults', () => {
    expect(resolveConfig(validConfig)).toEqual(validConfig);
    expect(
      validateConfig({ ...validConfig, automation_entity: undefined, departure_trigger_minutes: undefined }),
    ).toBeUndefined();
    expect(validateConfig({ ...validConfig, automation_entity: 'automation.leave_home' })).toBeUndefined();
    expect(validateConfig({ ...validConfig, departure_trigger_minutes: 5 })).toBeUndefined();
  });

  it.each([1, 5, 60])('accepts and preserves a %i-minute automation threshold', (minutes) => {
    const input = {
      ...validConfig,
      automation_entity: 'automation.leave_home',
      departure_trigger_minutes: minutes,
      grid_options: { columns: 12 },
    };
    const resolved = resolveConfig(input);
    expect(resolved).toEqual(input);
    expect(resolved).not.toBe(input);
    expect(validateConfig(resolved)).toBeUndefined();
  });

  it.each([
    '',
    ' ',
    'script.leave_home',
    'automation.',
    'automation.leave-home',
    'automation.Leave',
    'automation.leave.home',
    'automation.leave\n',
    null,
    5,
  ])('rejects an invalid automation entity %j', (automation_entity) => {
    expect(validateConfig({ ...validConfig, automation_entity })).toBe('errors.automation_entity_invalid');
  });

  it.each([0, 61, 1.5, '5', null, NaN, Infinity, -Infinity])(
    'rejects an invalid departure threshold %j',
    (departure_trigger_minutes) => {
      expect(validateConfig({ ...validConfig, departure_trigger_minutes })).toBe(
        'errors.departure_trigger_minutes_invalid',
      );
    },
  );

  it('reports credentials before invalid automation settings', () => {
    expect(validateConfig({ ...validConfig, client_id: '', automation_entity: 'bad' })).toBe(
      'errors.client_id_required',
    );
  });

  it.each(['sv', 'en'] as const)('accepts and preserves the %s language override', (language) => {
    const resolved = resolveConfig({ ...validConfig, language });
    expect(resolved.language).toBe(language);
    expect(validateConfig(resolved)).toBeUndefined();
  });

  it('leaves language selection automatic when the override is omitted or undefined', () => {
    expect(resolveConfig(validConfig).language).toBeUndefined();
    expect(validateConfig({ ...validConfig, language: undefined })).toBeUndefined();
  });

  it.each(['de', 'sv-SE', 'EN', '', null, 42])('rejects invalid language override %j', (language) => {
    expect(ConfigSchema.safeParse({ ...validConfig, language }).success).toBe(false);
    expect(validateConfig({ ...validConfig, language })).toBe('errors.language_invalid');
  });

  it('reports missing credentials before a numeric type error', () => {
    expect(validateConfig({ ...validConfig, client_id: ' ', limit: 'invalid' })).toBe('errors.client_id_required');
  });
  it('accepts a stop name with credentials and positive options', () => {
    expect(validateConfig(validConfig)).toBeUndefined();
  });

  it('accepts a GID without a stop name', () => {
    expect(validateConfig({ ...validConfig, gid: '123', stop_name: undefined })).toBeUndefined();
  });

  it.each([
    { time_table_height: 100, limit: 1, refresh_interval: 10 },
    { time_table_height: 1000, limit: 100, refresh_interval: 3600 },
    { time_table_height: 250.5, limit: 50, refresh_interval: 60.5 },
  ])('accepts numeric boundaries and supported fractional options %j', (overrides) => {
    expect(validateConfig({ ...validConfig, ...overrides })).toBeUndefined();
  });

  it.each([
    [{ client_id: '' }, 'errors.client_id_required'],
    [{ client_secret: '' }, 'errors.client_secret_required'],
    [{ gid: undefined, stop_name: '' }, 'errors.stop_required'],
    [{ time_table_height: 0 }, 'errors.height_positive'],
    [{ time_table_height: -1 }, 'errors.height_positive'],
    [{ time_table_height: 99 }, 'errors.height_positive'],
    [{ time_table_height: 1001 }, 'errors.height_positive'],
    [{ time_table_height: Number.NaN }, 'errors.height_positive'],
    [{ time_table_height: Number.POSITIVE_INFINITY }, 'errors.height_positive'],
    [{ time_table_height: Number.NEGATIVE_INFINITY }, 'errors.height_positive'],
    [{ limit: 0 }, 'errors.limit_positive'],
    [{ limit: -1 }, 'errors.limit_positive'],
    [{ limit: 1.5 }, 'errors.limit_positive'],
    [{ limit: 101 }, 'errors.limit_positive'],
    [{ limit: Number.NaN }, 'errors.limit_positive'],
    [{ limit: Number.POSITIVE_INFINITY }, 'errors.limit_positive'],
    [{ limit: Number.NEGATIVE_INFINITY }, 'errors.limit_positive'],
    [{ refresh_interval: 0 }, 'errors.refresh_positive'],
    [{ refresh_interval: -1 }, 'errors.refresh_positive'],
    [{ refresh_interval: 9 }, 'errors.refresh_positive'],
    [{ refresh_interval: 3601 }, 'errors.refresh_positive'],
    [{ refresh_interval: Number.NaN }, 'errors.refresh_positive'],
    [{ refresh_interval: Number.POSITIVE_INFINITY }, 'errors.refresh_positive'],
    [{ refresh_interval: Number.NEGATIVE_INFINITY }, 'errors.refresh_positive'],
    [{ client_id: '   ' }, 'errors.client_id_required'],
    [{ client_secret: '\t' }, 'errors.client_secret_required'],
    [{ gid: '  ', stop_name: undefined }, 'errors.stop_required'],
    [{ stop_name: '  ' }, 'errors.stop_required'],
  ] as const)('rejects invalid options %j', (overrides, error) => {
    expect(validateConfig({ ...validConfig, ...overrides })).toBe(error);
  });

  it('reports missing credentials before dependent configuration errors', () => {
    expect(validateConfig({ ...validConfig, client_id: '', client_secret: '', limit: 0 })).toBe(
      'errors.client_id_required',
    );
  });

  it('maps malformed raw values to localized field errors without coercion', () => {
    expect(validateConfig({ ...validConfig, limit: '50' } as unknown as ResolvedCardConfig)).toBe(
      'errors.limit_positive',
    );
    expect(validateConfig({ ...validConfig, client_id: 123 } as unknown as ResolvedCardConfig)).toBe(
      'errors.client_id_required',
    );
  });

  it('returns the generic localized configuration error for invalid raw objects', () => {
    expect(validateConfig(null as unknown as ResolvedCardConfig)).toBe('errors.invalid_configuration');
  });

  it('exports a passthrough schema with strict numeric types and absent-only defaults', () => {
    const parsed = ConfigSchema.parse({
      type: 'custom:vasttrafik-home-assistant-card',
      client_id: ' client ',
      client_secret: ' secret ',
      limit: undefined,
      custom_field: 'kept',
    });

    expect(parsed.client_id).toBe(' client ');
    expect(parsed.limit).toBe(DEFAULT_CONFIG.limit);
    expect(parsed.custom_field).toBe('kept');
    expect(ConfigSchema.safeParse({ limit: '50' }).success).toBe(false);
  });
});
