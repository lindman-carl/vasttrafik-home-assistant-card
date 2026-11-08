# Tests

## Unit tests

Use Node.js 24 and the pnpm version pinned in `package.json`:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm test                              # Run all unit tests once (also used in CI)
corepack pnpm test:watch                        # Watch for changes
corepack pnpm test src/api/token-manager.test.ts # Run a single file
corepack pnpm test:coverage                     # Text summary and coverage/index.html
corepack pnpm check
corepack pnpm typecheck
```

Unit tests live beside their subjects as `src/**/*.test.ts`. The suite tests configuration resolution/validation, direction
normalization, departure grouping/sorting, API request construction/results/errors,
and token authentication, caching, expiry and credential changes. It also covers
runtime response/configuration validation, timestamp fallbacks, cancellation,
request/body timeouts, bounded HTTP retries, and `Retry-After` handling. Vitest uses a
Node environment; no Home Assistant instance or real API credentials are needed.
Coverage is scoped to those four core modules, not the Lit card or editor.

The colocated `src/departures/departure-trigger.test.ts` tests the pure pinned-departure crossing monitor, including exact timestamp boundaries, refreshed estimates, identity/deduplication, first-below-threshold behavior, cancellation, and baseline resets. It runs in the unit suite but is not part of the existing scoped coverage report.

Import test APIs explicitly from `vitest`. Use typed departure fixtures from
`tests/fixtures.ts`, stub `fetch` at the network boundary, and keep the real API and token
manager logic under test. The shared `tests/setup.ts` blocks unstubbed network calls and
restores fake time and globals after each test. Time-sensitive tests must use a
fixed clock rather than sleeps. See the agent testing rules in
`../.github/copilot-instructions.md` for the development workflow.

## Real Home Assistant integration tests

Run these alongside the unit suite when changing Lit rendering, editor controls,
localization, card lifecycle, decorators, compiler settings, or dashboard sizing.
They replace the former standalone manual HTML regression pages.

### Prerequisites and commands

- Node.js 24 and the pnpm version in `package.json`.
- Docker running with access to the official HA image registry; the first run
  downloads the image. Linux CI and Docker Desktop on macOS are supported.
- Playwright's bundled Chromium, installed explicitly:

```sh
pnpm exec playwright install chromium
# Linux/CI: install required system libraries too
pnpm exec playwright install --with-deps chromium

pnpm test:integration
pnpm test:integration editor.spec.ts
pnpm test:integration card.spec.ts -g 'Retry-After'
HA_PORT=18124 pnpm test:integration
HA_VERSION=2026.10.4 pnpm test:integration
```

The runner builds first, starts a test-owned HA container on loopback port 18123,
performs actual onboarding/login, runs the suite with one Chromium worker and no
retries, then removes that container and generated state. It refuses occupied
ports rather than reusing an existing server. Its default **2026.10.4** image is
also pinned to a verified digest. An explicit `HA_VERSION` override selects that
release's image tag and is intended for deliberate upgrade checks; it is not a
claim of compatibility. HTTP readiness has a 180-second deadline.

The runner safety tests use Node's built-in test runner and are included in the
integration command. To run them without Docker/browser startup:

```sh
node --test tests/integration/runner.test.mjs
```

### What is real and what is mocked

The production JavaScript is a real `/local/` HA resource. Authentication, HA REST
and WebSocket traffic, card picker, editor selectors, dashboards, themes, and
navigation are genuine. User-flow tests use strict context routes for dummy
Västtrafik token/location/departure responses; no real Västtrafik traffic is allowed.
Unknown external requests fail. The picker test deliberately blocks only three
known images used by HA's built-in picture-card previews, keeping browsing offline.
Service workers are blocked so they cannot bypass request interception.

`automation.spec.ts` uses a real test-owned HA automation, counter, and condition helper from the runner-generated YAML. It verifies actual action execution and condition checking, threshold timers independent of API polling, pin/config/navigation changes, browser-storage failure, and API/action error behavior. These are real HA entities/services, not mocked `hass` calls. Reset fixture state for each test and install browser clocks only after authentication; pause them for exact-boundary assertions.

`contracts.spec.ts` preserves explicitly lower-level cases that routed HTTP cannot
faithfully reproduce, such as a fetch resolving despite abort and missing journey
IDs supplied directly to the timetable. Only those ignored-abort tests temporarily
replace the external Västtrafik fetch boundary; real HA requests and elements are
untouched. These are not substitutes for real editor/navigation flows. The
[migration inventory](../tests/integration/coverage.md) maps former assertions to
their replacements.

Use real roles/labels and auto-waiting assertions. Scope table selectors so header
labels and hidden editor previews do not cause ambiguous matches. Control response
completion with fixture gates, not sleeps. Install clocks after HA authentication
and navigate within HA without reloading before timer tests, so its established
connection/heartbeat timers remain real. Do not assert network overlap from the
order of Playwright transport notifications: verify cancellation and request
counts, with signal-level serialization covered by the lower-level contracts.

### Isolation and failure diagnostics

Every run generates its own ignored `.integration-runtime/run-*` configuration,
and authentication state. Only the YAML and bundle are mounted read-only; mutable
HA data stays inside the disposable container, avoiding root-owned host files on
Linux. Never mount/copy `.devcontainer/config` or a user's
Home Assistant configuration into automated tests. Browser contexts isolate pins
and other localStorage state; tests do not depend on preceding tests.

- HTML report: `playwright-report/index.html` (`pnpm exec playwright show-report`).
- Screenshots, traces, layout captures, and HA logs: `test-results/`.
- Open a failed test trace with `pnpm exec playwright show-trace <trace.zip>`.
- GitHub CI retains failure diagnostics for 14 days, including startup failures.

The runner cleans up on normal exit, failures and handled interruption. If the
Docker CLI is interrupted before returning a created container ID, cleanup checks
the unique name and ownership tag before removing it. If the
process or Docker daemon is forcibly killed, inspect containers labeled
`vasttrafik.integration-test=true` and remove **only** the test-owned leftovers;
do not prune unrelated containers. Generated files and auth state must stay ignored.

A passing Chromium run against the pinned HA version does not verify HACS delivery,
all HA/browser versions, live API availability or real-service CORS behavior.
Unit coverage percentages do not establish DOM or whole-project coverage. Report
warnings and blocked checks honestly.
