# Wall Display

A self-hosted smart wall calendar, similar to a Skylight calendar but running on your own server. It's a Nuxt app on the home server, a Chromium kiosk on a Raspberry Pi, and Home Assistant integration over MQTT.

- [Architecture](docs/architecture.md)
- [Home Assistant](docs/home-assistant.md)
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

- `/display`: the wall display. A 2560×1440 stage scaled to fit the window, showing the view the server chose (placeholders for now) in the theme set for the display in config. `/display?id=hallway` picks a display; with no `id` it shows the first one in the config (or the last one it showed, if the server can't be reached). It keeps the last-known state and events in `localStorage`, so a reload while the server is down still shows the wall, and a small "Offline" badge appears once the WebSocket has been down for 3 seconds. `brightness` dims it with a black overlay and `screen: off` makes it black. A message set with `set_overlay` shows as a large banner at the bottom of every view, the photo frame included, with its icon (a Lucide icon, named as the remote or Home Assistant gives it, such as `trash` or `mdi:bell`), under the dimming so screen off still blacks it out. It goes when it is cleared, and when its time is up even if the server can't be reached
- `/remote`: the phone remote, built for a phone and following its light or dark setting. `/remote?id=hallway` picks a display; with no `id` it controls the first one in the config. From top to bottom it has the display's name with a connection pill (Connected, Reconnecting, or Offline after 10 seconds without the WebSocket), a Screen card with an on/off toggle (the rest fades to half opacity while the screen is off), tiles for Agenda, Month, Week and Night, a month picker (shown only in Month view: arrows and a dropdown covering 12 months either side, with "Back to this month" while another month is pinned), a Message section (what is on the wall now and when it ends, with Clear, and a form for a new message: text, an icon and how long it stays, from 30 minutes to until cleared) and a plain "More" section with brightness and Refresh calendars. It stays live over the same WebSocket as the display. If the config sets `remote.pin`, the page asks for the PIN once, keeps it in the phone's `localStorage` and sends it with every command. "Add to Home Screen" (Share menu on iOS, menu on Android) installs it as a full-screen app for that display, using the manifest and icon the server provides
- `/settings`: settings (stub)
- `/api/health`: returns `{ "status": "ok", "uptime": <seconds>, "db": "ok" }`, or a 503 with `{ "status": "error", "db": "error" }` if the database doesn't answer
- `GET /api/events?from=…&to=…`: the events that overlap the range `[from, to)`, each with its people (name, initial, colour). `from` and `to` are a date such as `2026-10-01` (midnight at the start of that day in the display time zone) or an ISO 8601 time with `Z` or an offset. The range may be at most 366 days; anything else is a 400 with a short reason
- `GET /api/weather`: the weather the displays are showing, `{ "weather": { "current": { "condition", "temperature" }, "daily": [{ "date", "condition", "high", "low" }], "temperature_unit", "updated_at" } }`, or `{ "weather": null }` when there is no `weather` block in the config or Home Assistant has not answered yet. It never holds the Home Assistant URL or token
- `POST /api/refresh`: syncs every calendar now and answers `{ "calendars": [{ "calendarId", "status": "updated" | "not-modified" | "error", "error"? }] }` once all have finished (it fetches the weather again too, which is not part of the answer). The error is a short message that never contains a feed URL. With `remote.pin` set in the config it needs the PIN in an `X-Wallcal-Pin` header (see the PIN note below)
- `GET /api/special-days` and `POST /api/special-days`: the special days (name, date, whether it repeats yearly or happens once, `scene_id`, `who`, `since_year`, and its own lead window, palette, greeting and takeover), and a way to add one, which answers 201 with the new day. `lead`, `takeover` and `palette` can be `null`, or left out, to use the scene's. `who` fills `{who}` in the greeting, and `since_year` (yearly days only, from 1900) fills `{years}` and `{nth}` and hides the day in that year and before. A bad body is a 400 with a short reason, and so is a `scene_id` that is not a scene, a `{…}` that is not one of `{who}`, `{years}` and `{nth}`, and a greeting the day can't fill (such as `{nth}` with no `since_year`), which names the day. Special days are stored in SQLite, not in the config
- `GET /api/special-days/resolved`: what the displays are drawing, `{ "special_days": { "today", "from", "to", "tiles", "current", "takeover", "tomorrow_art" } | null }`: the tile decorations for the months a display can show, today's special day and the one taking over, if any, and `tomorrow_art`, the art files tomorrow's answer will need (so the wall can load them in the evening). It is `null` until the server has worked them out. A change is sent to every display as `special_days.updated`
- `GET /api/special-days/preview?special_day=<id>` or `?scene=<id>`: the same answer as `/resolved`, worked out as if the date that day next falls on were today (a one-off day on its own date, even if that has passed). A scene is shown through the first day that uses it, or as a one-off day today with its placeholders as typed if none does. It covers that date's month grid and the takeover is that day's own. Exactly one of the two parameters is needed (otherwise 400), and an unknown day or scene is a 404. It is what the wall fetches during `preview_special_day`, and needs no PIN
- `GET /api/special-days/:id`, `PUT /api/special-days/:id` and `DELETE /api/special-days/:id`: read, replace or delete one special day, or a 404 for an unknown id. Delete answers 204. With `remote.pin` set, every write here needs the `X-Wallcal-Pin` header, as `POST /api/refresh` does
- `GET /api/special-day-scenes` and `POST /api/special-day-scenes`: the scenes, by name, and a way to add one (201). A scene is a look that days share: `lead` (and `lead_days`), `takeover`, `greeting` and `palette`, plus the art file names, which an edit never changes. A scene is a whole look, so none of those is `null` (`lead_days` apart, which is set only when the lead is `days`)
- `GET /api/special-day-scenes/:id`, `PUT /api/special-day-scenes/:id` and `DELETE /api/special-day-scenes/:id`: read, replace or delete one scene, or a 404 for an unknown id. A `PUT` with a greeting that some day on the scene couldn't fill is a 400 naming every such day (`data.days` is their `id` and `name`). Delete answers 204. A scene in use is a 409 that names its days, unless the request has `?detach=true`, which first gives each day the scene's values for the parts of the look it left empty, so the wall doesn't change. Editing a scene changes the wall for the days using it, and is sent as `special_days.updated`
- `POST /api/special-days/:id/duplicate` and `POST /api/special-day-scenes/:id/duplicate`: copy a day or a scene as "Copy of …", art files included, and answer 201 with the copy
- `POST /api/special-days/:id/save-as-scene`: makes a scene from the look the day has and moves the day onto it, clearing its own look. The body is optional: `{ "name": "…" }` names the scene, which is otherwise named after the day. Answers 201 with `{ "scene", "day" }`. The day's `updated_at` is not changed
- `POST` and `DELETE` on `/api/special-days/:id/art/:slot` (`tile`, `full` or `extra`) and `/api/special-day-scenes/:id/art/:slot` (`tile` or `full`; scenes have no `extra`): set or clear one piece of art. `POST` is `multipart/form-data` with the picture in a field named `file`, and answers 200 with the day or scene. `DELETE` clears the slot, so a day goes back to its scene's art, and also answers 200 with the row. Tile art is PNG, WebP or SVG up to 2 MB, fitted inside 512×512. Full art is any image the server can read (JPEG, PNG, WebP, GIF, AVIF, TIFF, SVG and so on) up to 20 MB, cropped to fill 2560×1440. Extra art is PNG, WebP or SVG with a transparent background up to 20 MB, cropped the same way as full art so the two line up, and an opaque image is refused. The type is read from the file itself, not from its name or `Content-Type`. SVGs are cleaned, and one with a script, an event handler, a `foreignObject`, an external link or an embedded `data:` image is refused rather than stored. The errors are 400 for a missing `file` field, a damaged image or a refused SVG, 413 for a file over the limit, 415 for the wrong kind of file, 411 for a request with no `Content-Length` and 404 for an unknown day, scene or slot. Files are named after a hash of what is stored, kept in `special-days/` in the data directory, and removed once no day or scene uses them. With `remote.pin` set, every write here needs the `X-Wallcal-Pin` header
- `GET /special-days/:name`: an art file, by the name a day or scene gives in `tile_art`, `full_art` or `extra_art`. It is `image/webp` or `image/svg+xml` with `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff`, and SVGs also have `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`. A name of any other shape, or a file that isn't there, is a 404. It is not under `/api` and needs no PIN, because the displays load it as an ordinary image
- `GET /api/displays`: every display's settings from the config (`id`, `name`, `theme`, `month_style`, `week_start` and the config's `timezone`), which the display page uses for its theme and time zone
- `GET /api/displays/:id/state`: the display's current state (`view`, `month`, `month_set_at`, `screen`, `photo_source`, `brightness`, `auto_presence`, `auto_brightness`, `overlay`), or a 404 for an id that isn't in the config
- `POST /api/displays/:id/commands`: applies one command, such as `{ "type": "set_view", "view": "agenda" }`, and answers with the new state. The types are `set_view`, `next_view`, `set_month` (`YYYY-MM`, `current`, `prev` or `next`), `set_screen`, `set_brightness`, `set_photo_source`, `set_auto_presence` (`{ "auto_presence": true | false }`), `set_auto_brightness` (the same with `auto_brightness`), `set_overlay` (`{ "text", "icon"?, "ttl"? }` in seconds, or `null` to clear), `photo_next`, `refresh` and `preview_special_day` (`{ "id" }` for a special day or `{ "scene" }` for a scene, exactly one, and `"seconds"` from 5 to 600, default 60: the wall shows it as if it were today until `state.preview.until`, and the server then clears it by itself; it is not an MQTT command). A bad command is a 400 with a short reason, and a `preview_special_day` of a day or scene that doesn't exist is a 404. With `remote.pin` set it needs the `X-Wallcal-Pin` header, as `POST /api/refresh` does
- `GET /api/remote`: `{ "pin_required": true | false }`, whether writes need a PIN. It never returns the PIN
- `POST /api/remote/pin`: answers 204 if the `X-Wallcal-Pin` header holds the right PIN (or none is set), and 401 or 429 as above. The remote page uses it to check a PIN as it is typed in
- `GET /api/settings/calendars`: one entry per calendar, in config order, for the settings page: its default person, whether detection is on, source type, `poll_seconds`, the last attempt, last success and last error (a short message, never a feed URL), the stored event count, and `fallbacks`, the recent events (30 days either way, at most 20) that no name, alias or rule matched, so they fell back to the default person. A recurring event is one entry with an `occurrences` count. `fallbacks` is empty when `detect_people` is `false`
- `GET /api/settings/displays`: one entry per display: its settings, current state, the open WebSocket connections by role (`display` and `remote`), and the MQTT connection (`off`, `connecting`, `connected` or `disconnected`, with the last error, which holds no secret)
- `GET /api/settings/connections`: whether MQTT is set up (the broker as scheme, host and port only, whether discovery is on, and how many displays are connected) and whether Home Assistant answers with its token (`ok`, `error` with a short reason, or `off`, and when it was last checked). Home Assistant is asked at most once a minute, however often the page polls
- `POST /api/settings/discovery`: publishes the Home Assistant discovery configs again for every display that is connected to the broker, and answers `{ "republished": ["hallway"] }`. It is a 409 with a short `message` when there is no `mqtt` block or `discovery` is off

None of the settings routes ever returns a secret: no feed URL, Home Assistant URL or token, MQTT username or password, or PIN.

**The PIN.** With `remote.pin` set, every write under `/api` needs it in an `X-Wallcal-Pin` header: any method but GET, HEAD or OPTIONS, for the routes above and for any added later. A missing or wrong PIN is a 401, and an address that sends 10 wrong ones in 5 minutes gets a 429 until the window ends. The check runs before the route, so an unknown display id or a bad body gets a 401 too, not a 404 or 400. Reading, and the `/_ws` WebSocket, stay open.
- `GET /remote.webmanifest?id=<display>`: the web app manifest for "Add to Home Screen" (`<display name> remote`, opening `/remote?id=<display>`). `id` defaults to the first display; an unknown one is a 404. Its icons are in `calendar-app/public/icons/`, and `node scripts/render-icons.mjs` redraws them
- `/_ws?display=<id>&role=display|remote`: a WebSocket that sends the display's whole state when it connects, then the weather (`weather.updated`, with `weather: null` when there is none), then `state.updated`, `events.updated` and `weather.updated` as they happen (and `photo.next` to the display). Commands are sent with the POST above, not over the socket

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

Events are kept for a rolling window of whole months around the current one: 12 months back and 12 ahead unless `sync.months_back` and `sync.months_ahead` say otherwise. Recurring events are expanded into single events inside it. The month picker on the remote reaches 12 months either side, so a smaller window leaves the months beyond it empty. Calendar sources are synced by the library in `calendar-app/server/sources/` (ICS and Home Assistant).

Each calendar is polled on its own interval (`poll_seconds`, 120 for ICS by default), and the first polls are spread over a few seconds at start-up. A feed that fails keeps its last good events and is tried again after twice the interval, then four times, and so on up to an hour; the first success after that goes back to the normal interval. The reason for the last failure is stored in `sync_status` and logged, without the feed's URL, which is a secret. `POST /api/refresh` forces an immediate poll of every calendar.

A `homeassistant` calendar reads `GET /api/calendars/<entity_id>` over the same window, with the long-lived access token from the `homeassistant` block (create one under your profile in Home Assistant, in Security, Long-lived access tokens). It is polled every 300 seconds unless `poll_seconds` says otherwise. Home Assistant expands recurring events itself, and an all-day event stays all-day. Home Assistant has no ETag, so each poll reads the whole window, but only the rows that changed are written. A failure backs off and keeps the last good events, as with ICS, and the token is never logged or stored in `sync_status`.

A `weather` block names a Home Assistant `weather` entity, which is read through the same `homeassistant` block: its state for the current conditions and `POST /api/services/weather/get_forecasts?return_response` for the daily forecast, so the entity must support daily forecasts. It is polled every 600 seconds unless `poll_seconds` says otherwise (at least 60), with the same backoff as a calendar, and the last good weather is kept while Home Assistant fails. A change is sent to every display as `weather.updated`. Leave the block out and the views draw no weather. See [Weather in docs/home-assistant.md](docs/home-assistant.md#weather).

Who an event is for (its people) and the title shown on the wall are worked out when it is stored, from the names in its title and description and the calendar's keyword rules, as described in [architecture §3.3](docs/architecture.md). If the people or rules in the config change, the stored events are re-resolved at the next start without fetching anything, and a calendar that has been removed from the config is deleted along with its events.

### MQTT

With an `mqtt` block in the config, each display keeps its state on an MQTT broker and takes commands from it. [`contracts/mqtt.json`](contracts/mqtt.json) is the reference: every topic, its direction, whether it is retained, and a JSON Schema for its payload. Everything lives under `wallcal/<display id>/`, as text:

- The app publishes the state, retained: `view/state`, `month/state` (the month the month view shows, as `YYYY-MM`), `screen/state`, `photo_source/state`, `brightness/state`, `auto_presence/state` and `auto_brightness/state` (`ON` or `OFF`) and `overlay/state` (the text of the message shown over the display, or empty once it has expired or been cleared). A change is published when it happens, and everything is published again whenever the connection to the broker is made. `last_sync/state` is when the last calendar sync succeeded, as a UTC time like `2026-10-28T12:00:00.000Z`. It is not published until a calendar has synced. `special_day/state` is the name of today's special day, or empty when there is none, and changes at midnight in the display time zone.
- The app subscribes to `view/set`, `month/set`, `screen/set`, `photo_source/set`, `brightness/set`, `auto_presence/set`, `auto_brightness/set`, `overlay/set`, `photo/next` and `refresh`. A payload that doesn't fit its topic is ignored and logged. A retained message on one of these topics is ignored too, so it isn't replayed at every reconnect; publish an empty retained message there to remove it from the broker.
- `availability` is `online` while the app is connected. The broker publishes `offline` (the last will) if the app dies, and the app publishes it itself on a clean stop. The app opens one connection per display, named `<client_id>-<display id>`, so that each display has its own last will.

The topics that the Raspberry Pi will use (`pi/…`) are in the contract, but the app doesn't use them yet. The app runs the same without a broker, or while the broker is down: it keeps retrying in the background, with a growing wait of up to a minute, and logs the first failure rather than every attempt.

To watch it and to send a command, with the Mosquitto tools:

```sh
mosquitto_sub -h localhost -t 'wallcal/#' -v
mosquitto_pub -h localhost -t wallcal/hallway/view/set -m agenda
```

#### Home Assistant

The app also publishes MQTT discovery configs, so Home Assistant creates a "Wall Calendar" device for each display with no YAML. With more than one display the devices are named "Wall Calendar Hallway" and so on. The device has a view select, a "Month shown" sensor, previous, next and this month buttons, a screen switch, a photo source select, a brightness slider, auto presence and auto brightness switches, a message text box (it shows a banner on the wall; clear the box to remove it, and it empties by itself when the message runs out or is cleared elsewhere), next photo and refresh buttons, a "Last sync" sensor, and a "Special day" sensor (the name of today's special day, or empty).

The configs are retained, so it makes no difference whether the app or Home Assistant starts first. If Home Assistant restarts, it announces `online` on `homeassistant/status`, and the app publishes the configs again. The entities show as unavailable while the app is offline (they follow `availability`). If Home Assistant listens on a different discovery prefix, set `discovery_prefix` under `mqtt`. Set `discovery: false` to turn all of this off.

To remove a device, delete it in Home Assistant, and set `discovery: false` or the app will bring it back at the next start. Or publish an empty retained message on each `homeassistant/<type>/wallcal_<display id>/<entity>/config` topic.

[docs/home-assistant.md](docs/home-assistant.md) covers broker setup, example automations and a dashboard card.

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

The home server runs the app from the `ghcr.io/kallb123/wall-display/calendar-app` image, built from [`calendar-app/Dockerfile`](calendar-app/Dockerfile) for amd64 and arm64 by the [Publish images](.github/workflows/publish.yml) workflow. Every push to `main` publishes `:latest` and `:sha-<short sha>`; a `v1.2.3` tag publishes `:1.2.3` and `:1.2`. It needs Docker with the Compose plugin. From the repo root:

```sh
mkdir config data
cp config.example.yaml config/config.yaml        # then edit it
cp secrets.example.yaml config/secrets.yaml      # then edit it
sudo chown 1000:1000 data                        # the container runs as uid 1000, not root
docker compose up -d
```

Check <http://localhost:8080/api/health> (use the server's address from another machine). It should return `{"status":"ok", ...,"db":"ok"}`. `docker compose ps` also shows `healthy` once the app is up. Logs are in `docker compose logs -f calendar-app`. After a config change, run `docker compose restart calendar-app`.

- `./config` is mounted read-only at `/config`. `./data` is mounted at `/data` and holds the database and, later, photos and special day art.
- `docker compose --profile mqtt up -d` also starts a Mosquitto broker on port 1883, with its settings in `mosquitto/config/mosquitto.conf`. It allows anonymous connections, so keep it on your home network (the file explains how to add a password). Leave the profile off if you use the Home Assistant Mosquitto add-on.
- To update, `docker compose pull` then `docker compose up -d`. `git pull` first if `docker-compose.yml` or the examples changed. To hold a version, change `:latest` in `docker-compose.yml` to a release or `sha-` tag.
- GHCR makes a new package private. Either make it public (the package's settings on GitHub, under "Danger Zone") or run `docker login ghcr.io` on the server with a personal access token that has `read:packages`.
- To build the image from the checkout instead, `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.
- Back up `./data` and `./config`. Special days and their art are stored only in `./data`.

## Raspberry Pi kiosk

The wall display runs on a Raspberry Pi with Raspberry Pi OS Lite, showing the `/display` page in a Chromium kiosk. [`kiosk/setup.sh`](kiosk/setup.sh) sets that up: auto-login, a minimal Wayland compositor, Chromium with flags tuned for the Pi, no screen blanking, and a restart if Chromium exits. The Pi holds nothing but the display URL, so reflashing is the way to start again.

```sh
sudo ./kiosk/setup.sh --url 'http://<server>:8080/display?id=hallway'
```

[`kiosk/README.md`](kiosk/README.md) covers reflashing the Pi, the setup options, extra Chromium flags, logs and troubleshooting.
