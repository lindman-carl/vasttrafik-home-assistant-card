# GitHub Copilot Instructions

You are assisting with development of the Västtrafik Home Assistant custom card. The project is TypeScript + Lit 3 and builds a single ES module with Rollup.

## Quick Reference

```bash
pnpm install --frozen-lockfile
pnpm start
pnpm check
pnpm typecheck
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm build
```

## Primary Files

- `src/card/vasttrafik-card.ts`: custom element, card lifecycle, refresh scheduling, and top-level rendering.
- `src/config.ts`: public configuration, defaults, and validation.
- `src/api/api.ts`, `src/api/request.ts`, and `src/api/token-manager.ts`: browser-side Västtrafik API authentication and requests.
- `src/card/components/`: focused Lit components for the header and timetable.
- `src/card/editor.ts`: visual editor implementing `LovelaceCardEditor`.
- `src/departures/`: departure schemas, grouping/time helpers, and pinning.
- `src/localize/localize.ts`: locale normalization and dictionary lookup.
- `src/localize/languages/en.json` and `src/localize/languages/sv.json`: matching English and Swedish strings.

## Architecture And Compatibility

- The custom element and card type are `vasttrafik-home-assistant-card` and `custom:vasttrafik-home-assistant-card`.
- Preserve public configuration fields: `stop_name`, `gid`, `client_id`, `client_secret`, `time_table_height`, `limit`, and `refresh_interval`.
- A configured GID takes precedence over a stop name.
- Keep the token cache in memory and scoped to the individual card API instance. Never log credentials or tokens.
- The card must avoid overlapping refresh requests and clear scheduled work on disconnect.

## Localization

- Do not hardcode user-facing static strings. Add keys to both English and Swedish dictionaries.
- Use the optional `language` config override (`sv` or `en`) for runtime card and editor text when set; otherwise use `hass.locale.language`. `sv-*` selects Swedish; `en-*` and unsupported locales fall back to English.
- API-provided stop names, directions, line values, platform values, and technical HTTP status details remain unchanged.

## TypeScript And Lit

- Use strict types and `import type` for type-only imports.
- Use `@property` for public reactive inputs and `@state` for internal reactive values.
- Keep components focused; do not move API or refresh logic into presentation components.
- Use Home Assistant theme variables and keep the timetable usable in narrow and wide dashboard layouts.

## Quality

- Keep `pnpm test`, `pnpm check`, `pnpm typecheck`, and `pnpm build` passing.
- Keep Rollup dev and production entry/output names aligned with `vasttrafik-home-assistant-card.js`.
- Update README and HACS metadata when public configuration, installation, output, or credential behavior changes.

## Testing And Writing Tests

- Read `docs/testing.md`. Unit tests live beside their subjects as `src/**/*.test.ts` and run with Vitest in Node. Playwright specs in `tests/integration/` run the production bundle inside disposable real Home Assistant; only external Västtrafik API data is mocked. Never use or modify `.devcontainer/config` for automated tests.
- For new behavior or a bug fix, first add a focused test, run it and confirm it fails for the intended reason, then make the smallest production change and rerun it. For existing behavior, add characterization tests without changing production code just to satisfy a test.
- Use explicit imports from `vitest`, strict TypeScript types and descriptive names that identify the regression being caught. `pnpm typecheck` includes test files; `pnpm check` includes tests and the Vitest configuration.
- Test observable outputs, error paths and meaningful boundary cases. Derive expected values independently; do not compute expectations using the function under test or assert private cache fields.
- Mock only external boundaries such as `fetch`. Keep configuration, grouping, API and token manager implementations real. Assert emitted URLs, authentication headers and request counts when they establish request or caching contracts.
- Never make real network requests or use real credentials/tokens. Shared setup blocks accidental network access. Use dummy credentials and `Response.json` fixtures; unexpected calls must fail rather than return a blanket successful response.
- Use `tests/fixtures.ts` for typed departure data and response helpers. Shared setup lives in `tests/setup.ts`. Keep test-only helpers out of production code.
- Control time with `vi.useFakeTimers()` and `vi.setSystemTime()`. Test token refresh boundaries without real waits. Shared setup restores time/globals; configure per-test mock responses in `beforeEach`, not shared mutable caches or concurrent tests with global stubs.
- Run a focused file with `pnpm test src/api/token-manager.test.ts` while iterating, then run the full `pnpm test`, `pnpm check`, `pnpm typecheck`, and `pnpm build` before reporting completion. Report failures, warnings and checks you could not run.
- Use `pnpm test:coverage` to find gaps, not as proof of correctness. Its report covers only `src/config.ts`, `src/departures/utils.ts`, `src/api/api.ts` and `src/api/token-manager.ts`; it does not establish DOM or whole-project coverage. Do not weaken assertions or exclusions to hide failures.
- For changes to Lit rendering, the editor, card lifecycle or compiler/decorator settings, also run `pnpm test:integration` with Docker running and Playwright Chromium installed. Test actual HA controls, authentication and WebSocket communication; do not replace them with stand-ins. Preserve the distinction between routed integration flows and the explicitly lower-level ignored-abort contracts. Do not claim `pnpm test` verifies browser behavior, or that a blocked integration run passed.
