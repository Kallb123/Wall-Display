# Wall Display

A self-hosted smart wall calendar, similar to a Skylight calendar but running on your own server. It's a Nuxt app on the home server, a Chromium kiosk on a Raspberry Pi, and Home Assistant integration over MQTT.

- [Architecture](docs/architecture.md)
- [Implementation plan](docs/implementation-plan.md)

## Development

The app lives in `calendar-app/`. It is a standalone pnpm project.

Prerequisites:

- Node 24 (see `.node-version`)
- pnpm, via corepack: `corepack enable`

```sh
cd calendar-app
pnpm install
pnpm dev
```

The dev server is at <http://localhost:3000>. Pages and endpoints so far:

- `/display`: the wall display (stub)
- `/remote`: the phone remote (stub)
- `/settings`: settings (stub)
- `/api/health`: returns `{ "status": "ok", "uptime": <seconds> }`

Checks, all run from `calendar-app/` and all run in CI:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm lint:fix` fixes what ESLint can. After `pnpm build`, `node .output/server/index.mjs` runs the production server.
