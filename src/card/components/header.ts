import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { format } from 'date-fns';
import './spinner';

@customElement('vt-header')
export class VasttrafikHeader extends LitElement {
  @property({ type: String }) public title = '';
  @property({ type: Boolean }) public isLoading = false;
  @property({ attribute: false }) public lastUpdated?: Date;
  @property({ type: String }) public language = 'en-US';

  public static styles = css`
    :host {
      display: grid;
      grid-column: span 8;
      grid-template-columns: repeat(8, 1fr);
      width: 100%;
      font-size: 1.5rem;
      font-weight: 600;
      line-height: 2rem;
    }

    .title {
      grid-column: 1 / span 7;
      display: flex;
      align-items: center;
      width: 100%;
      height: 50px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .updated-timestamp {
      display: grid;
      width: 100%;
      height: 50px;
      place-items: center;
      font-size: 1rem;
      font-weight: 500;
      line-height: 1.5rem;
    }
  `;

  protected render() {
    return html`
      <div class="title">${this.title}</div>
      <div class="updated-timestamp">
        ${
          this.isLoading
            ? html`<vt-spinner></vt-spinner>`
            : this.lastUpdated
              ? format(this.lastUpdated, 'HH:mm')
              : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vt-header': VasttrafikHeader;
  }
}
