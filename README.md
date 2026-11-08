# Västtrafik Home Assistant Card

A Home Assistant card that shows real-time departures from Västtrafik public transit stops in western Sweden.

## Installation

### HACS

1. In HACS, open **Frontend** and select **Explore & Download Repositories**.
2. Add `lindman-carl/vasttrafik-home-assistant-card` as a custom repository if it is not already listed.
3. Download **Västtrafik Home Assistant Card** and refresh your browser.

### Manual

1. Download `vasttrafik-home-assistant-card.js` from the latest release.
2. Copy it to `<config>/www/vasttrafik-home-assistant-card.js`.
3. Add it as a dashboard resource:

```yaml
resources:
  - url: /local/vasttrafik-home-assistant-card.js
    type: module
```

## Configuration

### Minimal configuration

```yaml
type: custom:vasttrafik-home-assistant-card
stop_name: Brunnsparken
client_id: your_vasttrafik_client_id
client_secret: your_vasttrafik_client_secret
```

### Complete configuration

```yaml
type: custom:vasttrafik-home-assistant-card
stop_name: Brunnsparken
gid: "9021014001760000"
client_id: your_vasttrafik_client_id
client_secret: your_vasttrafik_client_secret
time_table_height: 250
limit: 50
refresh_interval: 60
language: sv
```

| Option | Type | Required | Description | Default |
| --- | --- | --- | --- | --- |
| `type` | string | Yes | `custom:vasttrafik-home-assistant-card` | |
| `stop_name` | string | One of `stop_name` or `gid` | Stop area name used for lookup | `Brunnsparken, Göteborg` |
| `gid` | string | One of `stop_name` or `gid` | Västtrafik stop area GID; takes precedence over `stop_name` | |
| `client_id` | string | Yes | Västtrafik API client ID | |
| `client_secret` | string | Yes | Västtrafik API client secret | |
| `time_table_height` | number | No | Scrollable timetable height in pixels, 100–1000 | `250` |
| `limit` | number | No | Maximum departures requested from the API, integer 1–100 | `50` |
| `refresh_interval` | number | No | Seconds between updates, 10–3600 | `60` |
| `language` | string | No | Override the card and editor language: `sv` (Swedish) or `en` (English) | Home Assistant locale |
| `automation_entity` | string | No | Automation entity ID to run when a pinned journey crosses the advance-time threshold | Disabled |
| `departure_trigger_minutes` | number | No | Minutes before departure, integer 1–60; only used when `automation_entity` is set | `5` |

Create API credentials in the [Västtrafik Developer Portal](https://developer.vasttrafik.se/) and subscribe the application to the **Planera Resa v4** API.

Configuration is validated with Zod. Numeric options must be finite numbers (not quoted strings); credentials and supplied stop identifiers must not be blank. Omitted or `undefined` options use defaults.

Requests time out after 30 seconds and are cancelled when the card disconnects or its configuration changes. A successful stop-name lookup is cached per card instance. Unauthorized departure/location requests refresh authentication once; transient HTTP errors from token, location, and departure endpoints retry at most twice with exponential backoff and `Retry-After` guidance. Delays over 60 seconds are deferred to the next card refresh instead of retried early. Failed updates retain existing data for the same stop. Departure times fall back from estimated-otherwise-planned to estimated to planned; null API time fields are normalized to missing values. Unavailable times display `-` and sort last.

### Visual editor

The card provides a Home Assistant visual editor for every configuration option. A configured GID overrides the stop name.

By default, the card follows Home Assistant's selected locale. `sv`, `sv-SE`, and other Swedish regional locales use Swedish. `en`, `en-US`, `en-GB`, other English regional locales, and unsupported locales use English; `en-US` is the fallback. Set `language: sv` or `language: en` to override this for both the card and its editor. Choose **Automatic** in the visual editor (or omit `language` in YAML) to restore the default. API-provided stop names and directions are unchanged.

### Credential security

`client_id` and `client_secret` are stored in the Home Assistant card configuration and used by browser-side code to call the Västtrafik API. They are not secret from users who can inspect the dashboard configuration or browser runtime. The visual editor's password input only masks the displayed value; it does not encrypt it.

## Pinning lines

Click a timetable row to pin it to the top; click it again to unpin. Multiple rows can be pinned. Pins use `serviceJourney.gid` and are saved as an array in your browser's localStorage, surviving page reloads and stop changes on the same Home Assistant origin. Rows with the same journey GID share a pin; other journeys on the same line do not. Pins are not synced between browsers or devices.

Pinned rows have a theme-aware background at 10% opacity. By default, pinning only changes sorting: rows still appear only when departure data is received, with departure-time ordering preserved within pinned and unpinned sections. Pinning is click-only. If browser storage is unavailable, pins last for the current timetable session. Optionally, enable departure automations as described below.

## Departure automations (dashboard-only)

Optionally run an existing Home Assistant automation when the **next departure in a pinned row** crosses a configurable advance time:

```yaml
type: custom:vasttrafik-home-assistant-card
stop_name: Brunnsparken
client_id: your_vasttrafik_client_id
client_secret: your_vasttrafik_client_secret
automation_entity: automation.leave_home
departure_trigger_minutes: 5
```

Select **Departure automation** and **Minutes before departure** in the visual editor, or use YAML. The same automation and threshold apply to every pinned journey in that card. Clear `automation_entity` to disable this feature; minutes alone do not enable it. No device, sensor, or backend integration is created.

The card must observe the departure **above** the threshold before it crosses to at-or-below it. Opening the dashboard, restoring pins, or pinning a journey already five minutes away or less does **not** trigger immediately. A refreshed estimate jumping from six minutes to four does trigger. A local timer checks the exact timestamp between API refreshes, using estimated-otherwise-planned, estimated, then planned time; it does not use the timetable's rounded minute display.

Only the first departure of a row whose first journey GID is pinned is monitored, matching existing pinning. Following departures and other journeys on the same line are not automatically monitored. Fully/partly cancelled departures, expired departures, and missing/invalid times are ignored. An API update failure suspends triggers while retaining the timetable; recovery starts a fresh baseline rather than catching up missed crossings.

The automation is called with `automation.trigger` and `skip_condition: false`, so its **conditions are checked**. Like Home Assistant's manual trigger, this can run an automation even when its regular triggers are switched off; use conditions to gate execution. This is a direct call: normal automation `trigger` data and trigger IDs are unavailable. For example, create an automation like this and use its actual entity ID in the card:

```yaml
alias: Leave home
triggers: []
conditions: []
actions:
  - action: persistent_notification.create
    data:
      title: Time to leave
      message: Your pinned departure is approaching.
mode: single
```

Each departure gets **at most one action attempt per card session**, even after estimate changes, unpin/re-pin, or configuration changes. A skipped condition or failed/uncertain action is not retried automatically; action errors appear without removing the timetable. Reloading or creating a new card starts a new session.

**Limitations:** the dashboard must remain open and running. Navigation away stops monitoring, but HA automations already started can finish. Suspended tabs, sleeping devices, or a lost connection can miss timing. Separate cards, tabs, or browsers may each call the automation. This is not suitable for safety-critical or closed-dashboard automation; those need a server-side integration. The card reports missing targets and rejected action requests; failures inside the automation itself must be inspected in Home Assistant's automation traces.

## Development

Requirements:

- Node.js 24
- Corepack, bundled with Node.js
- pnpm version pinned in `package.json`

```bash
corepack enable
pnpm install
pnpm check
pnpm typecheck
pnpm build
pnpm start
```

`pnpm start` runs the Rollup development watcher on port 5002. `pnpm build` produces `dist/vasttrafik-home-assistant-card.js`.

`pnpm check` checks source and unit-test formatting and lint rules with Biome. Use `pnpm check:write` to apply formatting and safe fixes. The configuration in `biome.json` preserves the previous formatting style and supported lint rules; TypeScript checking remains a separate step.

Run `pnpm test` for the unit suite, `pnpm test:watch` during development, or `pnpm test:coverage` for core-module coverage. Tests use mocked network requests and dummy credentials.

For real Home Assistant integration tests, start Docker and run:

```bash
pnpm exec playwright install chromium
pnpm test:integration
```

This builds the production bundle, starts disposable Home Assistant **2026.10.4**, authenticates a test user, and runs Playwright Chromium against actual dashboards and editor controls. Västtrafik responses are mocked; no real API credentials are needed. The container and its generated configuration are cleaned up afterwards, without touching `.devcontainer/config`. GitHub CI runs the same suite. See [docs/testing.md](docs/testing.md) for targeted tests, version/port overrides, and failure diagnostics.

### Repository structure

```text
src/
  config.ts, config.test.ts  Configuration, defaults, and validation
  const.ts                  Card version used by release automation
  card/                     Card lifecycle, editor, and Lit components
  api/                      API client, authentication, and request handling
  departures/               Departure schemas, grouping, timing, and pinning
  localize/                 Localization and language dictionaries
tests/
  fixtures.ts, setup.ts     Shared unit-test helpers and network isolation
  integration/              Real Home Assistant Playwright tests and isolated runner
docs/
  testing.md                Testing and verification guidance
```

Unit tests live beside the modules they test as `*.test.ts`. Root-level configurations remain alongside `package.json`.

### Dev container

The included dev container starts Home Assistant and exposes the Rollup development server as a dashboard resource. Reopen the project in the container, then visit <http://localhost:8123> and sign in with `dev` / `dev`.
