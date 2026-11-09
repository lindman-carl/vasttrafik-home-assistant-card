import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  PINNED_DEPARTURES_STORAGE_KEY,
  PINS_CHANGED_EVENT,
  prioritizePinnedDepartures,
  readPinnedDepartures,
  savePinnedDepartures,
  togglePinnedDeparture,
} from '../../departures/pinned-departures';
import type { Departure } from '../../departures/types';
import './time-table-row';

@customElement('vt-time-table')
export class VasttrafikTimeTable extends LitElement {
  @property({ attribute: false }) public groupedDepartures: Departure[][] = [];
  @property({ type: Number }) public height = 250;
  @property({ type: String }) public language = 'en-US';

  @state() private pinnedDepartures = readPinnedDepartures();

  private readonly onPinsChanged = (event: Event): void => {
    this.pinnedDepartures = [...(event as CustomEvent<string[]>).detail];
  };

  private readonly onStorageChanged = (event: StorageEvent): void => {
    if ((event.key === PINNED_DEPARTURES_STORAGE_KEY || event.key === null) && event.storageArea === localStorage) {
      this.pinnedDepartures = readPinnedDepartures();
    }
  };

  public connectedCallback(): void {
    super.connectedCallback();
    this.pinnedDepartures = readPinnedDepartures();
    window.addEventListener(PINS_CHANGED_EVENT, this.onPinsChanged);
    window.addEventListener('storage', this.onStorageChanged);
  }

  public disconnectedCallback(): void {
    window.removeEventListener(PINS_CHANGED_EVENT, this.onPinsChanged);
    window.removeEventListener('storage', this.onStorageChanged);
    super.disconnectedCallback();
  }

  public static styles = css`
    :host {
      display: grid;
      grid-column: span 8;
      grid-template-columns: repeat(8, 1fr);
      grid-auto-rows: 50px;
      width: 100%;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      row-gap: 4px;
      place-items: center;
      scrollbar-width: none;
    }

    :host::-webkit-scrollbar {
      display: none;
    }
  `;

  private togglePin(gid?: string): void {
    if (!gid) return;
    this.pinnedDepartures = togglePinnedDeparture(this.pinnedDepartures, gid);
    savePinnedDepartures(this.pinnedDepartures);
    window.dispatchEvent(new CustomEvent<string[]>(PINS_CHANGED_EVENT, { detail: this.pinnedDepartures }));
  }

  protected render() {
    return html`
      <style>
        :host {
          height: ${this.height}px;
        }
      </style>
      ${prioritizePinnedDepartures(this.groupedDepartures, this.pinnedDepartures).map((departureGroup) => {
        const gid = departureGroup[0]?.serviceJourney.gid;
        return html`
          <vt-time-table-row
            .departureGroup=${departureGroup}
            .language=${this.language}
            .pinned=${Boolean(gid && this.pinnedDepartures.includes(gid))}
            ?pinnable=${Boolean(gid)}
            @click=${() => this.togglePin(gid)}
          ></vt-time-table-row>
        `;
      })}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vt-time-table': VasttrafikTimeTable;
  }
}
