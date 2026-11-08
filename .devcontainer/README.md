# Home Assistant Custom Card Dev Container

This dev container runs Home Assistant and the Västtrafik Home Assistant Card development server together.

## Start

1. Open the repository in VS Code.
2. Choose **Dev Containers: Reopen in Container**.
3. Open Home Assistant at <http://localhost:8123> and sign in with `dev` / `dev`.
4. The container starts `pnpm start`, which serves `vasttrafik-home-assistant-card.js` on port 5002 with Rollup watch mode.

The Home Assistant configuration loads the card from `http://localhost:5002/vasttrafik-home-assistant-card.js`.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm start
pnpm check
pnpm typecheck
pnpm build
```

`pnpm build` runs linting, type-checking, and the production Rollup build. The artifact is written to `dist/vasttrafik-home-assistant-card.js`.

## Troubleshooting

If the development server or Home Assistant port is already occupied, inspect the port with:

```bash
lsof -i :5002
lsof -i :8123
```

To recreate dependencies, remove `node_modules` and run `pnpm install --frozen-lockfile`.
