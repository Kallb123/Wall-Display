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

### Configuration

`pnpm dev` reads `calendar-app/config.dev.yaml`, so it needs no setup. A production build reads `/config/config.yaml`, and `secrets.yaml` from the same folder. [`config.example.yaml`](config.example.yaml) and [`secrets.example.yaml`](secrets.example.yaml) show every option. A bad config stops the server at start-up with a message listing each problem.

In the config, `key: !secret some_name` takes its value from `some_name` in `secrets.yaml`. The environment variable `WALLCAL_SECRET_SOME_NAME` overrides it.

| Variable | Effect |
|---|---|
| `WALLCAL_CONFIG_FILE` | Full path to the config file. |
| `WALLCAL_CONFIG_DIR` | Folder holding `config.yaml` and `secrets.yaml`. Default `/config`. |
| `WALLCAL_SECRET_<NAME>` | Overrides the secret `<name>` (capitals, with each character that isn't a letter or digit turned into `_`). |
| `WALLCAL_TIMEZONE` | Overrides `timezone` in the config. |

Checks, all run from `calendar-app/` and all run in CI:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm lint:fix` fixes what ESLint can. After `pnpm build`, `node .output/server/index.mjs` runs the production server.
