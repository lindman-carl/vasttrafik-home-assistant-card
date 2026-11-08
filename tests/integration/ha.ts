import { expect, type Locator, type Page } from '@playwright/test';
import type { VasttrafikCardConfig } from '../../src/config';

export interface DashboardConfig {
  title: string;
  views: Array<{
    title: string;
    path: string;
    type?: string;
    cards?: VasttrafikCardConfig[];
    sections?: Array<{ type: string; cards: VasttrafikCardConfig[] }>;
  }>;
}

interface HAHost extends HTMLElement {
  hass?: { callWS<T>(message: Record<string, unknown>): Promise<T> };
}

export async function callHA<T>(page: Page, message: Record<string, unknown>): Promise<T> {
  await expect.poll(() => page.locator('home-assistant').evaluate((host: HAHost) => Boolean(host.hass))).toBe(true);
  return page.locator('home-assistant').evaluate((host: HAHost, msg) => {
    if (!host.hass) throw new Error('Real HA frontend has not connected.');
    return host.hass.callWS<T>(msg);
  }, message);
}

export async function setDashboard(page: Page, config: DashboardConfig): Promise<void> {
  if (!page.url().startsWith('http')) await page.goto('/');
  await callHA(page, { type: 'lovelace/config/save', url_path: 'integration-test', config });
  // Use HA's real client-side navigation: reloading after clock installation
  // would also fake its already-established authentication/heartbeat timers.
  const link = page.getByRole('link', { name: 'Integration tests', exact: true });
  if (!(await link.isVisible())) await page.getByRole('button', { name: 'Sidebar toggle', exact: true }).click();
  await link.click();
  if (config.views.length > 1) await page.getByRole('tab', { name: 'Main', exact: true }).click();
}

export async function openEditor(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const editor = page.locator('vasttrafik-card-editor');
  await expect(editor).toBeVisible();
  return editor;
}

export function dashboard(cards: VasttrafikCardConfig[], type = 'masonry'): DashboardConfig {
  return {
    title: 'Integration tests',
    views: [
      {
        title: 'Main',
        path: 'main',
        type,
        ...(type === 'sections' ? { sections: [{ type: 'grid', cards }] } : { cards }),
      },
      { title: 'Other', path: 'other', cards: [] },
    ],
  };
}

export async function setLanguage(page: Page, language: string): Promise<void> {
  // The actual HA frontend event emitted by its profile language picker. HA owns
  // locale updates, translation loading and preference persistence; no fake hass.
  await page.locator('home-assistant-main').evaluate((main, value) => {
    main.dispatchEvent(new CustomEvent('hass-language-select', { detail: value, bubbles: true, composed: true }));
  }, language);
  await expect
    .poll(() =>
      page
        .locator('home-assistant')
        .evaluate((host: HTMLElement & { hass: { locale: { language: string } } }) => host.hass.locale.language),
    )
    .toBe(language);
}

export async function setCardConfig(page: Page, config: unknown): Promise<void> {
  await page
    .locator('vasttrafik-home-assistant-card')
    .first()
    .evaluate((card: HTMLElement & { setConfig(config: unknown): void }, value) => card.setConfig(value), config);
}
