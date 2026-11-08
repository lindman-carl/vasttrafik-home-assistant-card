import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Departure } from '../../departures/types';
import { getMinutesUntilDeparture, normalizeDirection } from '../../departures/utils';

@customElement('vt-time-table-row')
export class VasttrafikTimeTableRow extends LitElement {
  @property({ type: Array }) public departureGroup: Departure[] = [];
  @property({ type: String }) public language = 'en-US';
  @property({ type: Boolean, reflect: true }) public pinned = false;

  public static styles = css`
    :host {
      display: grid;
      grid-column: 1 / span 8;
      grid-template-columns: repeat(8, 1fr);
      width: 100%;
      height: 50px;
    }

    :host([pinnable]) {
      cursor: pointer;
    }

    :host([pinned]) {
      background-color: color-mix(in srgb, var(--primary-text-color, #212121) 10%, transparent);
    }

    .line-badge {
      display: grid;
      grid-column: span 1;
      width: 100%;
      box-sizing: border-box;
      border: 0.25rem solid;
      place-items: center;
      font-size: 1.75rem;
      font-weight: 600;
      letter-spacing: 0.025rem;
    }

    .line-badge.long-name {
      font-size: 1rem;
    }

    .platform,
    .time-until-departure {
      display: grid;
      grid-column: span 1;
      width: 100%;
      place-items: center;
      font-size: 1.25rem;
      font-weight: 600;
      line-height: 1.75;
    }

    .platform {
      font-weight: 500;
    }

    .direction {
      display: flex;
      grid-column: span 4;
      align-items: center;
      width: 100%;
      font-size: 1.125rem;
      font-weight: 500;
    }
  `;

  protected render() {
    const firstDeparture = this.departureGroup[0];
    if (!firstDeparture) return nothing;

    const secondDeparture = this.departureGroup[1];
    const { line } = firstDeparture.serviceJourney;

    return html`
      <div
        class=${line.shortName.length > 3 ? 'line-badge long-name' : 'line-badge'}
        style=${`background-color: ${line.backgroundColor}; color: ${line.foregroundColor}; border-color: ${line.borderColor};`}
      >
        ${line.shortName}
      </div>
      <div class="platform">${firstDeparture.stopPoint.platform}</div>
      <div class="direction">${normalizeDirection(firstDeparture.serviceJourney.direction)}</div>
      <div class="time-until-departure">${getMinutesUntilDeparture(firstDeparture)}</div>
      <div class="time-until-departure">${getMinutesUntilDeparture(secondDeparture)}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vt-time-table-row': VasttrafikTimeTableRow;
  }
}
