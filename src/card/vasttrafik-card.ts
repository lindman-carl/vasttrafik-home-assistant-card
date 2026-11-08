import { css, html, LitElement, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';
import { VasttrafikApi } from '../api/api';
import {
  DEFAULT_CONFIG,
  DEFAULT_DEPARTURE_TRIGGER_MINUTES,
  resolveConfig,
  validateConfig,
  type ResolvedCardConfig,
  type VasttrafikCardConfig,
} from '../config';
import { CARD_VERSION } from '../const';
import { localize } from '../localize/localize';
import { HttpError, RequestTimeoutError, ResponseError } from '../api/request';
import type { StopArea } from '../departures/types';
import { DepartureTriggerMonitor } from '../departures/departure-trigger';
import { PINNED_LINES_STORAGE_KEY, PINS_CHANGED_EVENT, readPinnedLines } from '../departures/pinned-lines';
import './components/header';
import './components/spinner';
import './components/time-table';
import './components/time-table-header';

interface CustomCardMetadata {
  type: string;
  name: string;
  description: string;
  documentationURL?: string;
}

interface WindowWithCustomCards extends Window {
  customCards?: CustomCardMetadata[];
}

const customCards = ((window as WindowWithCustomCards).customCards ??= []);
customCards.push({
  type: 'vasttrafik-home-assistant-card',
  name: 'Västtrafik Home Assistant Card',
  description: 'Display Västtrafik departures in a Home Assistant dashboard card.',
  documentationURL: 'https://github.com/lindman-carl/vasttrafik-home-assistant-card#readme',
});

console.info(
  `%c  VASTTRAFIK-HOME-ASSISTANT-CARD \n%c  ${localize('common.version', navigator.language)} ${CARD_VERSION}    `,
  'color: #007ac9; font-weight: bold; background: #f5f5f5',
  'color: white; font-weight: bold; background: #005b96',
);

@customElement('vasttrafik-home-assistant-card')
export class VasttrafikCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private config?: ResolvedCardConfig;
  @state() private stopArea?: StopArea;
  @state() private isLoading = false;
  @state() private lastUpdated?: Date;
  @state() private errorMessage?: string;
  @state() private automationError?: string;

  private readonly api = new VasttrafikApi();
  private refreshTimer?: number;
  private refreshInFlight?: Promise<void>;
  private refreshRequested = false;
  private refreshController?: AbortController;
  private configVersion = 0;
  private readonly departureTriggers = new DepartureTriggerMonitor();
  private departureTriggerTimer?: number;
  private pinnedJourneys: string[] = [];
  private hasFreshDepartures = false;

  private readonly onPinsChanged = (event: Event): void => {
    this.pinnedJourneys = [...(event as CustomEvent<string[]>).detail];
    this.evaluateDepartureTriggers();
  };

  private readonly onStorageChanged = (event: StorageEvent): void => {
    if ((event.key === PINNED_LINES_STORAGE_KEY || event.key === null) && event.storageArea === localStorage) {
      this.pinnedJourneys = readPinnedLines();
      this.evaluateDepartureTriggers();
    }
  };

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import('./editor');
    return document.createElement('vasttrafik-card-editor');
  }

  public static getStubConfig(): VasttrafikCardConfig {
    return { ...DEFAULT_CONFIG };
  }

  public getCardSize(): number {
    if (!this.config || validateConfig(this.config)) return 1;
    return Math.ceil(((this.config?.time_table_height ?? DEFAULT_CONFIG.time_table_height) + 106) / 50);
  }

  public getGridOptions(): { columns: number; min_columns: number; rows: 'auto' } {
    return { columns: 12, min_columns: 6, rows: 'auto' };
  }

  public setConfig(config: VasttrafikCardConfig): void {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error(localize('errors.invalid_configuration', this.language));
    }

    const resolved = resolveConfig(config);
    if (this.config?.gid !== resolved.gid || this.config?.stop_name !== resolved.stop_name) {
      this.stopArea = undefined;
      this.lastUpdated = undefined;
    }
    this.config = resolved;
    this.automationError = undefined;
    if (!validateConfig(resolved)) {
      this.api.setCredentials(resolved.client_id, resolved.client_secret);
    }

    if (this.isConnected) {
      this.restartRefresh();
    }
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this.pinnedJourneys = readPinnedLines();
    window.addEventListener(PINS_CHANGED_EVENT, this.onPinsChanged);
    window.addEventListener('storage', this.onStorageChanged);
    this.restartRefresh();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(PINS_CHANGED_EVENT, this.onPinsChanged);
    window.removeEventListener('storage', this.onStorageChanged);
    this.cancelRefresh();
  }

  public static styles = css`
    ha-card {
      padding: 1rem;
    }

    .content {
      display: grid;
      grid-template-columns: repeat(8, auto);
      width: 100%;
      overflow: hidden;
    }

    .spinner-container {
      display: flex;
      grid-column: 1 / -1;
      align-items: center;
      justify-content: center;
      min-height: 250px;
    }

    .error {
      grid-column: 1 / -1;
      margin: 0 0 0.75rem;
      padding: 0.75rem;
      border-radius: 0.25rem;
      background: var(--error-color, #db4437);
      color: var(--text-primary-color, white);
    }

    .loading-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }
  `;

  protected shouldUpdate(changed: PropertyValues<this>): boolean {
    if (changed.size === 1 && changed.has('hass')) {
      const previous = changed.get('hass') as HomeAssistant | undefined;
      return previous?.locale.language !== this.hass?.locale.language;
    }
    return true;
  }

  protected render(): TemplateResult {
    const config = this.config;
    if (!config) {
      return this.renderErrorCard(localize('errors.invalid_configuration', this.language));
    }

    const configError = validateConfig(config);
    if (configError) {
      return this.renderErrorCard(localize(configError, this.language));
    }

    if (!this.stopArea && this.isLoading) {
      return html`
        <ha-card>
          <div class="spinner-container" role="status">
            <vt-spinner></vt-spinner>
            <span class="loading-label">${localize('common.loading', this.language)}</span>
          </div>
        </ha-card>
      `;
    }

    return html`
      <ha-card>
        <div class="content">
          ${this.errorMessage ? html`<div class="error" role="alert">${this.errorMessage}</div>` : ''}
          ${this.automationError ? html`<div class="error" role="alert">${this.automationError}</div>` : ''}
          <vt-header
            .title=${this.stopArea?.name ?? ''}
            .isLoading=${this.isLoading}
            .lastUpdated=${this.lastUpdated}
            .language=${this.language}
          ></vt-header>
          <vt-time-table-header .language=${this.language}></vt-time-table-header>
          <vt-time-table
            .groupedDepartures=${this.stopArea?.groupedDepartures ?? []}
            .height=${config.time_table_height}
            .language=${this.language}
          ></vt-time-table>
        </div>
      </ha-card>
    `;
  }

  private get language(): string {
    const language = this.config?.language;
    return language === 'sv' || language === 'en' ? language : (this.hass?.locale.language ?? 'en-US');
  }

  private restartRefresh(): void {
    this.cancelRefresh();
    if (this.isConnected && this.config) {
      void this.refresh();
    }
  }

  private cancelRefresh(): void {
    this.configVersion += 1;
    this.suspendDepartureTriggers();
    this.clearRefreshTimer();
    this.refreshRequested = false;
    this.refreshController?.abort();
    this.isLoading = false;
    this.errorMessage = undefined;
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('hass')) this.evaluateDepartureTriggers();
  }

  private clearDepartureTriggerTimer(): void {
    if (this.departureTriggerTimer !== undefined) {
      window.clearTimeout(this.departureTriggerTimer);
      this.departureTriggerTimer = undefined;
    }
  }

  private suspendDepartureTriggers(): void {
    this.clearDepartureTriggerTimer();
    this.departureTriggers.clearObservations();
    this.hasFreshDepartures = false;
  }

  private evaluateDepartureTriggers(): void {
    this.clearDepartureTriggerTimer();
    const config = this.config;
    const stopArea = this.stopArea;
    if (
      !this.isConnected ||
      !config?.automation_entity ||
      !this.hass ||
      !this.hasFreshDepartures ||
      !stopArea ||
      validateConfig(config)
    ) {
      this.departureTriggers.clearObservations();
      return;
    }

    const result = this.departureTriggers.evaluate({
      stopGid: stopArea.gid,
      groups: stopArea.groupedDepartures,
      pinnedJourneys: this.pinnedJourneys,
      minutes: config.departure_trigger_minutes ?? DEFAULT_DEPARTURE_TRIGGER_MINUTES,
      now: Date.now(),
    });
    for (const _departure of result.departures) void this.triggerDepartureAutomation();
    if (result.nextCheckAt !== undefined) {
      this.departureTriggerTimer = window.setTimeout(
        () => this.evaluateDepartureTriggers(),
        Math.max(0, result.nextCheckAt - Date.now()),
      );
    }
  }

  private async triggerDepartureAutomation(): Promise<void> {
    const entity = this.config?.automation_entity;
    const hass = this.hass;
    if (!this.isConnected || !entity || !hass) return;
    const version = this.configVersion;
    this.automationError = undefined;
    try {
      // HA silently ignores missing entity targets; surface misconfiguration here.
      if (!hass.states[entity]) throw new Error(localize('errors.automation_not_found', this.language, { entity }));
      await hass.callService('automation', 'trigger', { skip_condition: false }, { entity_id: entity });
    } catch (error) {
      if (!this.isConnected || version !== this.configVersion) return;
      const message =
        error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message
          : String(error);
      this.automationError = localize('errors.automation_trigger_failed', this.language, { message });
    }
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== undefined) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private scheduleRefresh(retryAfterMs = 0): void {
    if (!this.isConnected || !this.config) return;

    this.clearRefreshTimer();
    const delay = Math.max(this.config.refresh_interval * 1000, retryAfterMs);
    this.refreshTimer = window.setTimeout(() => void this.refresh(), delay);
  }

  private refresh(): Promise<void> {
    if (!this.isConnected) return Promise.resolve();
    if (this.refreshInFlight) {
      this.refreshRequested = true;
      return this.refreshInFlight;
    }

    const config = this.config;
    if (!config) return Promise.resolve();

    const configError = validateConfig(config);
    if (configError) {
      this.errorMessage = localize(configError, this.language);
      return Promise.resolve();
    }

    this.isLoading = true;
    this.errorMessage = undefined;
    const controller = new AbortController();
    this.refreshController = controller;
    const request = this.performRefresh(config, this.configVersion, controller);
    this.refreshInFlight = request;
    return request;
  }

  private async performRefresh(
    config: ResolvedCardConfig,
    version: number,
    controller: AbortController,
  ): Promise<void> {
    let retryAfterMs = 0;
    const isCurrent = (): boolean => this.isConnected && version === this.configVersion && !controller.signal.aborted;
    try {
      const stopArea = await this.api.fetchStopArea({
        gid: config.gid,
        stopName: config.stop_name,
        limit: config.limit,
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      this.stopArea = stopArea;
      this.lastUpdated = new Date();
      this.hasFreshDepartures = true;
      this.evaluateDepartureTriggers();
    } catch (error) {
      if (!isCurrent()) return;
      this.suspendDepartureTriggers();
      if (error instanceof HttpError) retryAfterMs = error.retryAfterMs;
      const message =
        error instanceof ResponseError || error instanceof RequestTimeoutError
          ? localize(error.translationKey, this.language)
          : error instanceof Error
            ? error.message
            : String(error);
      this.errorMessage = localize('errors.fetch_failed', this.language, { message });
    } finally {
      if (isCurrent()) this.isLoading = false;
      this.refreshInFlight = undefined;
      if (this.refreshController === controller) this.refreshController = undefined;

      if (this.refreshRequested && this.isConnected) {
        this.refreshRequested = false;
        void this.refresh();
      } else if (isCurrent()) {
        this.scheduleRefresh(retryAfterMs);
      }
    }
  }

  private renderErrorCard(message: string): TemplateResult {
    const errorCard = document.createElement('hui-error-card');
    errorCard.setConfig({
      type: 'error',
      error: message,
      origConfig: this.config,
    });
    return html`${errorCard}`;
  }
}
