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

- `/display`: the wall display. A 2560×1440 stage scaled to fit the window, showing the view the server chose (placeholders for now) in the theme set for the display in config. `/display?id=hallway` picks a display; with no `id` it shows the first one in the config (or the last one it showed, if the server can't be reached). It keeps the last-known state and events in `localStorage`, so a reload while the server is down still shows the wall, and a small "Offline" badge appears once the WebSocket has been down for 3 seconds. `brightness` dims it with a black overlay and `screen: off` makes it black
- `/remote`: the phone remote, built for a phone and following its light or dark setting. `/remote?id=hallway` picks a display; with no `id` it controls the first one in the config. From top to bottom it has the display's name with a connection pill (Connected, Reconnecting, or Offline after 10 seconds without the WebSocket), a Screen card with an on/off toggle (the rest fades to half opacity while the screen is off), tiles for Agenda, Month, Week and Night, a month picker (shown only in Month view: arrows and a dropdown covering 12 months either side, with "Back to this month" while another month is pinned), and a plain "More" section with brightness and Refresh calendars. It stays live over the same WebSocket as the display. If the config sets `remote.pin`, the page asks for the PIN once, keeps it in the phone's `localStorage` and sends it with every command. "Add to Home Screen" (Share menu on iOS, menu on Android) installs it as a full-screen app for that display, using the manifest and icon the server provides
- `/settings`: settings (stub)
- `/api/health`: returns `{ "status": "ok", "uptime": <seconds>, "db": "ok" }`, or a 503 with `{ "status": "error", "db": "error" }` if the database doesn't answer
- `GET /api/events?from=…&to=…`: the events that overlap the range `[from, to)`, each with its people (name, initial, colour). `from` and `to` are a date such as `2026-10-01` (midnight at the start of that day in the display time zone) or an ISO 8601 time with `Z` or an offset. The range may be at most 366 days; anything else is a 400 with a short reason
- `POST /api/refresh`: syncs every calendar now and answers `{ "calendars": [{ "calendarId", "status": "updated" | "not-modified" | "error", "error"? }] }` once all have finished. The error is a short message that never contains a feed URL. With `remote.pin` set in the config it needs the PIN in an `X-Wallcal-Pin` header: 401 without it or with a wrong one, and 429 after 10 wrong tries in 5 minutes from one address
- `GET /api/displays`: every display's settings from the config (`id`, `name`, `theme`, `month_style`, `week_start` and the config's `timezone`), which the display page uses for its theme and time zone
- `GET /api/displays/:id/state`: the display's current state (`view`, `month`, `screen`, `photo_source`, `brightness`, `overlay`), or a 404 for an id that isn't in the config
- `POST /api/displays/:id/commands`: applies one command, such as `{ "type": "set_view", "view": "agenda" }`, and answers with the new state. The types are `set_view`, `next_view`, `set_month` (`YYYY-MM`, `current`, `prev` or `next`), `set_screen`, `set_brightness`, `set_photo_source`, `set_overlay` (`{ "text", "icon"?, "ttl"? }` in seconds, or `null` to clear), `photo_next` and `refresh`. A bad command is a 400 with a short reason. With `remote.pin` set it needs the `X-Wallcal-Pin` header, as `POST /api/refresh` does
- `GET /api/remote`: `{ "pin_required": true | false }`, whether the routes above need a PIN. It never returns the PIN
- `POST /api/remote/pin`: answers 204 if the `X-Wallcal-Pin` header holds the right PIN (or none is set), and 401 or 429 as above. The remote page uses it to check a PIN as it is typed in
- `GET /remote.webmanifest?id=<display>`: the web app manifest for "Add to Home Screen" (`<display name> remote`, opening `/remote?id=<display>`). `id` defaults to the first display; an unknown one is a 404. Its icons are in `calendar-app/public/icons/`, and `node scripts/render-icons.mjs` redraws them
- `/_ws?display=<id>&role=display|remote`: a WebSocket that sends the display's whole state when it connects, then `state.updated` and `events.updated` as they happen (and `photo.next` to the display). Commands are sent with the POST above, not over the socket

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

Events are kept for a rolling window of whole months around the current one: 12 months back and 12 ahead unless `sync.months_back` and `sync.months_ahead` say otherwise. Recurring events are expanded into single events inside it. The month picker on the remote reaches 12 months either side, so a smaller window leaves the months beyond it empty. Calendar sources are synced by the library in `calendar-app/server/sources/` (ICS so far).

Each calendar is polled on its own interval (`poll_seconds`, 120 for ICS by default), and the first polls are spread over a few seconds at start-up. A feed that fails keeps its last good events and is tried again after twice the interval, then four times, and so on up to an hour; the first success after that goes back to the normal interval. The reason for the last failure is stored in `sync_status` and logged, without the feed's URL, which is a secret. `POST /api/refresh` forces an immediate poll of every calendar.

Who an event is for (its people) and the title shown on the wall are worked out when it is stored, from the names in its title and description and the calendar's keyword rules, as described in [architecture §3.3](docs/architecture.md). If the people or rules in the config change, the stored events are re-resolved at the next start without fetching anything, and a calendar that has been removed from the config is deleted along with its events.

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

The visual tests (`display.spec.ts` for the shell, `agenda.spec.ts` for the agenda view and `month.spec.ts` for the month view) are Playwright screenshots at 2560×1440 with a frozen clock and fixture events, in both themes. `remote.spec.ts` does the same for the phone remote at 390×844, in the phone's light and dark settings, with the screen off, and with a pinned month, and checks that a tap sends the right command. They run against the built app, so build first:

```sh
pnpm build
pnpm test:visual          # compare with the baselines in test/visual/*-snapshots
pnpm test:visual:update   # refresh the baselines after a change to how the display looks
```

Playwright is pinned to an exact version in `package.json` because the baselines are only valid for the Chromium that goes with it. Make them with that Chromium (CI installs the same one with `playwright install chromium`) and look at each changed PNG before committing it. A failed run leaves a report in `playwright-report/` and the actual and diff images in `test-results/`; both are git-ignored, and CI uploads them. The `display` job in CI runs these tests.

`pnpm lint:fix` fixes what ESLint can. After `pnpm build`, `node .output/server/index.mjs` runs the production server.

## Running with Docker

The home server runs the app from a container built from [`calendar-app/Dockerfile`](calendar-app/Dockerfile). It needs Docker with the Compose plugin. From the repo root:

```sh
mkdir config data
cp config.example.yaml config/config.yaml        # then edit it
cp secrets.example.yaml config/secrets.yaml      # then edit it
sudo chown 1000:1000 data                        # the container runs as uid 1000, not root
docker compose up -d --build
```

Check <http://localhost:8080/api/health> (use the server's address from another machine). It should return `{"status":"ok", ...,"db":"ok"}`. `docker compose ps` also shows `healthy` once the app is up. Logs are in `docker compose logs -f calendar-app`. After a config change, run `docker compose restart calendar-app`.

- `./config` is mounted read-only at `/config`. `./data` is mounted at `/data` and holds the database and, later, photos and special day art.
- `docker compose --profile mqtt up -d` also starts a Mosquitto broker on port 1883, with its settings in `mosquitto/config/mosquitto.conf`. It allows anonymous connections, so keep it on your home network (the file explains how to add a password). Leave the profile off if you use the Home Assistant Mosquitto add-on.
- To update, `git pull` then `docker compose up -d --build`.
- Back up `./data` and `./config`. Special days and their art are stored only in `./data`.
