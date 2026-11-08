import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const version = process.env.HA_VERSION ?? '2026.10.4';
const port = Number(process.env.HA_PORT ?? 18123);
if (!/^\d{4}\.\d{1,2}\.\d+(?:b\d+)?$/.test(version) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('HA_VERSION must be an explicit HA release; HA_PORT must be an integer from 1024 to 65535.');
}
const root = resolve(import.meta.dirname, '../..');
const url = `http://127.0.0.1:${port}`;
const runId = randomUUID();
const name = `vasttrafik-integration-${runId}`;
let container;
let creatingContainer = false;
let runtime;
let child;
let interrupted = false;

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    child = spawn(command, args, {
      cwd: root,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      ...options,
    });
    const current = child;
    let output = '';
    let error = '';
    current.stdout?.on('data', (chunk) => {
      output += chunk;
    });
    current.stderr?.on('data', (chunk) => {
      error += chunk;
    });
    current.on('error', reject);
    current.on('exit', (code, signal) => {
      if (child === current) child = undefined;
      if (code === 0) resolveRun((output + (options.includeStderr ? error : '')).trim());
      else reject(new Error(`${command} ${args[0]} failed (${signal ?? code})${error ? `: ${error}` : ''}`));
    });
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted = true;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    child?.kill(signal);
  });
}

async function checkPort() {
  const server = createServer();
  await new Promise((resolvePort, reject) => {
    server.once('error', () => reject(new Error(`HA_PORT ${port} is occupied; refusing to reuse an existing server.`)));
    server.listen(port, '127.0.0.1', resolvePort);
  });
  await new Promise((resolveClose) => server.close(resolveClose));
}

try {
  await checkPort();
  await run('pnpm', ['build']);
  await mkdir(resolve(root, '.integration-runtime'), { recursive: true });
  runtime = await mkdtemp(resolve(root, '.integration-runtime/run-'));
  await writeFile(
    resolve(runtime, 'configuration.yaml'),
    `
homeassistant:
  name: Card integration tests
  latitude: 57.7
  longitude: 11.9
  elevation: 0
  unit_system: metric
  time_zone: Europe/Stockholm
frontend:
  themes:
    Integration dark:
      modes:
        dark: {}
http:
api:
auth:
onboarding:
config:
person:
analytics:
recorder:
energy:
input_boolean:
  integration_noise:
    name: Integration noise
  integration_departure_allowed:
    name: Integration departure allowed
  integration_departure_release:
    name: Integration departure release
counter:
  integration_departure_triggers:
    name: Integration departure triggers
    initial: 0
automation:
  - id: integration_departure_trigger
    alias: Integration departure trigger
    triggers: []
    conditions:
      - condition: state
        entity_id: input_boolean.integration_departure_allowed
        state: 'on'
    actions:
      - action: counter.increment
        target:
          entity_id: counter.integration_departure_triggers
  - id: integration_departure_delayed
    alias: Integration departure delayed
    triggers: []
    actions:
      - wait_template: "{{ is_state('input_boolean.integration_departure_release', 'on') }}"
      - action: counter.increment
        target:
          entity_id: counter.integration_departure_triggers
lovelace:
  mode: storage
logger:
  default: warning
`,
  );
  creatingContainer = true;
  container = await run(
    'docker',
    [
      'create',
      '--name',
      name,
      '--label',
      'vasttrafik.integration-test=true',
      '--label',
      `vasttrafik.integration-run=${runId}`,
      '-p',
      `127.0.0.1:${port}:8123`,
      '--mount',
      `type=bind,source=${resolve(runtime, 'configuration.yaml')},target=/config/configuration.yaml,readonly`,
      '--mount',
      `type=bind,source=${resolve(root, 'dist/vasttrafik-home-assistant-card.js')},target=/config/www/vasttrafik-home-assistant-card.js,readonly`,
      `ghcr.io/home-assistant/home-assistant:${version}${version === '2026.10.4' ? '@sha256:23f4dfbb69ce76315dbc4de7915504f1c2dcecd7ca2648113a493a385972e133' : ''}`,
    ],
    { capture: true },
  );
  await run('docker', ['start', container], { capture: true });
  const deadline = Date.now() + 180_000;
  while (true) {
    if (interrupted) throw new Error('Integration run interrupted.');
    try {
      const response = await fetch(`${url}/api/onboarding`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) break;
    } catch {
      /* HA has not started listening yet. */
    }
    if (Date.now() >= deadline) throw new Error('Home Assistant did not become ready within 180 seconds.');
    await delay(500);
  }
  console.info(`Real Home Assistant ${version} ready at ${url}`);
  await run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
    env: { ...process.env, HA_URL: url, HA_TEST_RUNTIME: runtime, HA_TEST_CONTAINER: container },
  });
} catch (error) {
  console.error(error.message);
  process.exitCode ||= 1;
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await writeFile(resolve(root, 'test-results/startup-error.log'), `${error.message}\n`);
} finally {
  if (!container && creatingContainer) {
    // Creation may have succeeded in Docker even if interruption prevented the
    // CLI from returning its ID. Reconcile by name AND this run's ownership tag.
    try {
      const [created] = JSON.parse(await run('docker', ['inspect', name], { capture: true }));
      if (created.Config?.Labels?.['vasttrafik.integration-run'] === runId) container = created.Id;
    } catch {
      /* Failed creation may have left no container to reconcile. */
    }
  }
  if (container) {
    await mkdir(resolve(root, 'test-results'), { recursive: true });
    try {
      const logs = await run('docker', ['logs', container], { capture: true, includeStderr: true });
      await writeFile(resolve(root, 'test-results/home-assistant.log'), logs);
    } catch (error) {
      console.error(`Could not collect HA logs: ${error.message}`);
    }
    try {
      await run('docker', ['rm', '-f', container], { capture: true });
    } catch (error) {
      console.error(`Could not remove test container ${container}: ${error.message}`);
      process.exitCode ||= 1;
    }
  }
  if (runtime) await rm(runtime, { recursive: true, force: true });
}
