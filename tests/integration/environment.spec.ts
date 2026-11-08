import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

test('HA configuration and bundle mounts are read-only and mutable state stays inside its disposable container', async () => {
  const { stdout } = await promisify(execFile)('docker', ['inspect', process.env.HA_TEST_CONTAINER!]);
  const [{ Mounts: mounts }] = JSON.parse(stdout) as Array<{ Mounts: Array<{ Destination: string; RW: boolean }> }>;
  expect(mounts.map((mount) => mount.Destination).sort()).toEqual([
    '/config/configuration.yaml',
    '/config/www/vasttrafik-home-assistant-card.js',
  ]);
  expect(mounts.every((mount) => !mount.RW)).toBe(true);
});
