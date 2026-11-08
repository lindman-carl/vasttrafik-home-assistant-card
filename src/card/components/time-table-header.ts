import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localize } from '../../localize/localize';

@customElement('vt-time-table-header')
export class VasttrafikTimeTableHeader extends LitElement {
  @property({ type: String }) public language = 'en-US';

  public static styles = css`
    :host {
      display: grid;
      grid-column: 1 / span 8;
      grid-template-columns: repeat(8, 1fr);
      width: 100%;
      padding: 0.25rem 0;
      place-items: center;
      font-size: 0.75rem;
      font-weight: 400;
      line-height: 1rem;
      text-align: center;
    }

    div {
      grid-column: span 1;
      width: 100%;
    }

    .direction {
      grid-column: span 4;
      text-align: left;
    }
  `;

  protected render() {
    return html`
      <div>${localize('timetable.line', this.language)}</div>
      <div>${localize('timetable.platform', this.language)}</div>
      <div class="direction">${localize('timetable.direction', this.language)}</div>
      <div>${localize('timetable.next', this.language)}</div>
      <div>${localize('timetable.following', this.language)}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vt-time-table-header': VasttrafikTimeTableHeader;
  }
}
