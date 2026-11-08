import { css, html, LitElement, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, type HomeAssistant, type LovelaceCardEditor } from 'custom-card-helpers';
import { DEFAULT_CONFIG, DEFAULT_DEPARTURE_TRIGGER_MINUTES, type VasttrafikCardConfig } from '../config';
import { localize } from '../localize/localize';

interface ConfigFieldTarget extends EventTarget {
  configValue?:
    | 'stop_name'
    | 'gid'
    | 'client_id'
    | 'client_secret'
    | 'language'
    | 'time_table_height'
    | 'limit'
    | 'refresh_interval'
    | 'automation_entity'
    | 'departure_trigger_minutes';
}

interface SelectorEventDetail {
  value: unknown;
}

@customElement('vasttrafik-card-editor')
export class VasttrafikCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private config?: VasttrafikCardConfig;

  public static styles = css`
    :host {
      display: block;
    }

    ha-selector {
      display: block;
      margin-bottom: 1rem;
    }

    .helper,
    .warning {
      margin: -0.5rem 0 1rem;
      color: var(--secondary-text-color);
      font-size: 0.875rem;
      line-height: 1.25rem;
    }

    .warning {
      padding: 0.75rem;
      border-radius: 0.25rem;
      background: var(--secondary-background-color);
    }
  `;

  public setConfig(config: VasttrafikCardConfig): void {
    this.config = structuredClone(config);
  }

  protected render(): TemplateResult {
    const config = this.config ?? { type: DEFAULT_CONFIG.type };
    const language = this.language;

    return html`
      ${this.renderTextSelector('stop_name', localize('editor.stop_name', language), config.stop_name ?? DEFAULT_CONFIG.stop_name ?? '')}
      <div class="helper">${localize('editor.stop_name_help', language)}</div>

      ${this.renderTextSelector('gid', localize('editor.gid', language), config.gid ?? '')}
      <div class="helper">${localize('editor.gid_help', language)}</div>

      ${this.renderTextSelector('client_id', localize('editor.client_id', language), config.client_id ?? '')}

      ${this.renderTextSelector('client_secret', localize('editor.client_secret', language), config.client_secret ?? '', 'password')}
      <div class="warning">${localize('editor.credentials_warning', language)}</div>

      <ha-selector
        .hass=${this.hass}
        .required=${false}
        .selector=${{
          select: {
            options: [
              { value: '', label: localize('editor.language_automatic', language) },
              { value: 'sv', label: localize('editor.language_swedish', language) },
              { value: 'en', label: localize('editor.language_english', language) },
            ],
            mode: 'dropdown',
          },
        }}
        .value=${config.language ?? ''}
        .configValue=${'language'}
        label=${localize('editor.language', language)}
        @value-changed=${this.handleSelectorChanged}
      ></ha-selector>

      ${this.renderNumberSelector(
        'time_table_height',
        localize('editor.time_table_height', language),
        config.time_table_height ?? DEFAULT_CONFIG.time_table_height,
        100,
        1000,
        10,
      )}
      ${this.renderNumberSelector(
        'limit',
        localize('editor.limit', language),
        config.limit ?? DEFAULT_CONFIG.limit,
        1,
        100,
        1,
      )}
      ${this.renderNumberSelector(
        'refresh_interval',
        localize('editor.refresh_interval', language),
        config.refresh_interval ?? DEFAULT_CONFIG.refresh_interval,
        10,
        3600,
        10,
      )}

      <ha-selector
        .hass=${this.hass}
        .required=${false}
        .selector=${{ entity: { filter: { domain: 'automation' } } }}
        .value=${config.automation_entity ?? ''}
        .configValue=${'automation_entity'}
        label=${localize('editor.automation_entity', language)}
        @value-changed=${this.handleSelectorChanged}
      ></ha-selector>
      <div class="helper">${localize('editor.automation_entity_help', language)}</div>
      ${this.renderNumberSelector(
        'departure_trigger_minutes',
        localize('editor.departure_trigger_minutes', language),
        config.departure_trigger_minutes ?? DEFAULT_DEPARTURE_TRIGGER_MINUTES,
        1,
        60,
        1,
      )}
    `;
  }

  private get language(): string {
    const language = this.config?.language;
    return language === 'sv' || language === 'en' ? language : (this.hass?.locale.language ?? 'en-US');
  }

  private renderNumberSelector(
    configValue: 'time_table_height' | 'limit' | 'refresh_interval' | 'departure_trigger_minutes',
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
  ): TemplateResult {
    return html`
      <ha-selector
        .hass=${this.hass}
        .required=${false}
        .selector=${{ number: { min, max, step, mode: 'box' } }}
        .value=${value}
        .configValue=${configValue}
        label=${label}
        @value-changed=${this.handleSelectorChanged}
      ></ha-selector>
    `;
  }

  private renderTextSelector(
    configValue: 'stop_name' | 'gid' | 'client_id' | 'client_secret',
    label: string,
    value: string,
    type: 'text' | 'password' = 'text',
  ): TemplateResult {
    return html`<ha-selector
      .hass=${this.hass}
      .required=${false}
      .selector=${{ text: { type } }}
      .value=${value}
      .configValue=${configValue}
      label=${label}
      @value-changed=${this.handleSelectorChanged}
    ></ha-selector>`;
  }

  private handleSelectorChanged(event: Event): void {
    const target = event.target as ConfigFieldTarget | null;
    const detail = (event as CustomEvent<SelectorEventDetail>).detail;
    if (!target?.configValue) return;

    if (detail?.value === undefined) {
      this.updateConfig(target.configValue, undefined);
      return;
    }

    if (['stop_name', 'gid', 'client_id', 'client_secret', 'automation_entity'].includes(target.configValue)) {
      if (typeof detail.value === 'string') this.updateConfig(target.configValue, detail.value);
      return;
    }

    if (target.configValue === 'language') {
      if (detail?.value === '' || detail?.value === 'sv' || detail?.value === 'en') {
        this.updateConfig('language', detail.value);
      }
      return;
    }

    if (typeof detail?.value !== 'number') return;

    this.updateConfig(target.configValue, detail.value);
  }

  private updateConfig(key: keyof VasttrafikCardConfig, value: string | number | undefined): void {
    const currentConfig = this.config ?? { type: DEFAULT_CONFIG.type };
    const nextConfig = { ...currentConfig, [key]: value };

    if (value === undefined || value === '') {
      delete nextConfig[key];
    }

    this.config = nextConfig;
    fireEvent(this, 'config-changed', { config: this.config });
  }
}
