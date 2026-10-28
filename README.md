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
- `/api/health`: returns `{ "status": "ok", "uptime": <seconds>, "db": "ok" }`, or a 503 with `{ "status": "error", "db": "error" }` if the database doesn't answer

### Configuration

`pnpm dev` reads `calendar-app/config.dev.yaml`, so it needs no setup. A production build reads `/config/config.yaml`, and `secrets.yaml` from the same folder. [`config.example.yaml`](config.example.yaml) and [`secrets.example.yaml`](secrets.example.yaml) show every option. A bad config stops the server at start-up with a message listing each problem.

In the config, `key: !secret some_name` takes its value from `some_name` in `secrets.yaml`. The environment variable `WALLCAL_SECRET_SOME_NAME` overrides it.

| Variable | Effect |
|---|---|
| `WALLCAL_CONFIG_FILE` | Full path to the config file. |
| `WALLCAL_CONFIG_DIR` | Folder holding `config.yaml` and `secrets.yaml`. Default `/config`. |
| `WALLCAL_SECRET_<NAME>` | Overrides the secret `<name>` (capitals, with each character that isn't a letter or digit turned into `_`). |
| `WALLCAL_TIMEZONE` | Overrides `timezone` in the config. |
| `WALLCAL_DATA_DIR` | Folder for the database and other app data. Default `/data` (`.data/` under `pnpm dev`). |
| `WALLCAL_MIGRATIONS_DIR` | Folder holding the SQL migrations. Normally not needed. |

### Database

Events, sync status, display state, photo records and special days are stored in SQLite (`better-sqlite3`, with Drizzle ORM). The database is `wallcal.db` in the data folder, which is `/data` in production and `calendar-app/.data/` under `pnpm dev` (git-ignored). Set `WALLCAL_DATA_DIR` to use another folder. The folder is created if it is missing, and the server stops at start-up with a message if it can't open the database there.

Migrations run at start-up, so there is nothing to do by hand. After changing `server/db/schema.ts`, run `pnpm db:generate` and commit the new files in `server/db/migrations/`. CI fails if the schema and the migrations disagree. The build copies the migrations to `.output/server/db/migrations`, and `WALLCAL_MIGRATIONS_DIR` can point the server at a different folder.

Checks, all run from `calendar-app/` and all run in CI:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm lint:fix` fixes what ESLint can. After `pnpm build`, `node .output/server/index.mjs` runs the production server.
