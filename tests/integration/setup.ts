import { chromium, expect, type FullConfig, request } from '@playwright/test';
import { join } from 'node:path';
import { callHA } from './ha';

export default async function setup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0].use.baseURL!;
  const clientId = `${baseURL}/`;
  const api = await request.newContext({ baseURL });
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL, serviceWorkers: 'block' });
  try {
    const created = await api.post('/api/onboarding/users', {
      data: {
        name: 'Integration tester',
        username: 'integration',
        password: 'dummy-integration-password',
        client_id: clientId,
        language: 'en',
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { auth_code: code } = await created.json();
    const tokenResponse = await api.post('/auth/token', {
      form: { grant_type: 'authorization_code', code, client_id: clientId },
    });
    expect(tokenResponse.ok(), await tokenResponse.text()).toBe(true);
    const { access_token: accessToken } = await tokenResponse.json();
    for (const step of ['core_config', 'analytics', 'integration']) {
      const response = await api.post(`/api/onboarding/${step}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: step === 'integration' ? { client_id: clientId, redirect_uri: clientId } : {},
      });
      expect(response.ok(), await response.text()).toBe(true);
    }
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('integration');
    await page.getByLabel('Password', { exact: true }).fill('dummy-integration-password');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page.locator('home-assistant')).toBeVisible();
    await callHA(page, {
      type: 'lovelace/dashboards/create',
      url_path: 'integration-test',
      title: 'Integration tests',
      icon: 'mdi:test-tube',
      show_in_sidebar: true,
      require_admin: true,
    });
    await callHA(page, {
      type: 'lovelace/resources/create',
      res_type: 'module',
      url: '/local/vasttrafik-home-assistant-card.js',
    });
    await callHA(page, {
      type: 'lovelace/config/save',
      url_path: 'integration-test',
      config: {
        title: 'Integration tests',
        views: [{ title: 'Main', path: 'main', cards: [] }],
      },
    });
    await page.context().storageState({ path: join(process.env.HA_TEST_RUNTIME!, 'auth.json') });
  } catch (error) {
    await page.screenshot({ path: 'test-results/setup-failure.png' });
    throw error;
  } finally {
    await browser.close();
    await api.dispose();
  }
}
