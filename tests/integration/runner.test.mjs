import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);
const runner = new URL('./run.mjs', import.meta.url).pathname;

async function interruptedCreate(signal, foreign = false) {
  const directory = await mkdtemp(join(tmpdir(), 'vasttrafik-runner-safety-'));
  const stateFile = join(directory, 'state.json');
  const fakePnpm = join(directory, 'pnpm');
  const fakeDocker = join(directory, 'docker');
  await writeFile(fakePnpm, '#!/bin/sh\nexit 0\n');
  await writeFile(
    fakeDocker,
    `#!${process.execPath}
const fs = require('node:fs');
const file = process.env.DOCKER_TEST_STATE;
const args = process.argv.slice(2);
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { commands: [] };
state.commands.push(args);
if (args[0] === 'create') {
  state.name = args[args.indexOf('--name') + 1];
  state.labels = {};
  args.forEach((arg, i) => { if (arg === '--label') { const [key, value] = args[i + 1].split('='); state.labels[key] = value; } });
  if (process.env.DOCKER_TEST_FOREIGN === 'true') state.labels['vasttrafik.integration-run'] = 'another-run';
  state.exists = true;
  fs.writeFileSync(file, JSON.stringify(state));
  // The daemon accepted creation, but the CLI has not delivered the ID.
  setInterval(() => {}, 1000);
} else if (args[0] === 'inspect') {
  fs.writeFileSync(file, JSON.stringify(state));
  process.stdout.write(JSON.stringify([{ Id: 'fake-container', Config: { Labels: state.labels } }]));
} else {
  if (args[0] === 'rm') state.exists = false;
  fs.writeFileSync(file, JSON.stringify(state));
}
`,
  );
  await chmod(fakePnpm, 0o755);
  await chmod(fakeDocker, 0o755);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  let watcher;
  let timer;
  let child;
  try {
    const accepted = new Promise((resolve, reject) => {
      watcher = watch(directory, () => {
        try {
          if (existsSync(stateFile) && JSON.parse(readFileSync(stateFile, 'utf8')).exists) resolve();
        } catch {
          /* The creation event may arrive before the mock finishes writing. */
        }
      });
      timer = setTimeout(() => reject(new Error('Mock Docker did not accept creation.')), 10_000);
    });
    child = spawn(process.execPath, [runner], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        HA_PORT: String(port),
        DOCKER_TEST_STATE: stateFile,
        DOCKER_TEST_FOREIGN: String(foreign),
      },
      stdio: 'ignore',
    });
    const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)));
    await accepted;
    clearTimeout(timer);
    watcher.close();
    child.kill(signal);
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
    const code = await exited;
    clearTimeout(deadline);
    return { code, state: JSON.parse(await readFile(stateFile, 'utf8')) };
  } finally {
    clearTimeout(timer);
    watcher?.close();
    child?.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
}

test('an occupied port is refused without disturbing the existing listener', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await assert.rejects(
      exec(process.execPath, [runner], { env: { ...process.env, HA_PORT: String(port) } }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /occupied; refusing to reuse an existing server/);
        assert.equal(server.listening, true);
        return true;
      },
    );
    const diagnostic = await readFile(new URL('../../test-results/startup-error.log', import.meta.url), 'utf8');
    assert.match(diagnostic, new RegExp(`HA_PORT ${port} is occupied`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('invalid version or port fails before starting Home Assistant', async () => {
  for (const env of [{ HA_VERSION: 'latest' }, { HA_PORT: '0' }, { HA_PORT: 'not-a-port' }]) {
    await assert.rejects(exec(process.execPath, [runner], { env: { ...process.env, ...env } }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /must be an explicit HA release/);
      return true;
    });
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} reconciles and removes its container when Docker never returned its ID`, async () => {
    const { code, state } = await interruptedCreate(signal);
    assert.equal(code, signal === 'SIGINT' ? 130 : 143);
    assert.equal(state.exists, false);
    assert.ok(state.commands.some((args) => args[0] === 'rm'));
  });
}

test('interruption cleanup does not remove a container belonging to another run', async () => {
  const { state } = await interruptedCreate('SIGTERM', true);
  assert.equal(state.exists, true);
  assert.equal(
    state.commands.some((args) => args[0] === 'rm'),
    false,
  );
});
