# Home Assistant

The app talks to Home Assistant (HA) over MQTT. It publishes MQTT discovery configs, so HA creates a "Wall Calendar" device for each display with no YAML. The device has a view select, a screen switch, a brightness slider, a message box and more, which you can use on dashboards and in automations. The design is in [architecture §7.4](architecture.md).

You need:

- An MQTT broker that both the app and HA connect to (see Broker setup below).
- An `mqtt` block in `config/config.yaml`.

Optional: a `homeassistant` block with a long-lived access token lets the app read calendars from HA (`homeassistant` calendar sources) a weather entity ([Weather](#weather) below) and the next alarm for the night view ([Next alarm](#next-alarm) below). That uses HA's REST API and has nothing to do with MQTT. It is described in the README and in [`config.example.yaml`](../config.example.yaml).

## Broker setup

Pick one broker. Both options use the same `mqtt` block in the app's config. Only the URL and login differ.

| | Mosquitto from this repo | HA Mosquitto add-on |
|---|---|---|
| Runs on | The home server, next to the app | The HA machine |
| Login | None by default, optional password file | Required |
| Button and presence while HA is down | Keep working | Stop |
| Extra setup | Point HA's MQTT integration at it | Add a user for the app |

Choose the first if you want the wall's button and presence to keep working when HA is down ([architecture §10](architecture.md)). Choose the add-on if you already run it and don't want another container.

### Option A: Mosquitto on the home server

Start the broker with the compose `mqtt` profile:

```sh
docker compose --profile mqtt up -d
```

In `config/config.yaml`:

```yaml
mqtt:
  url: mqtt://mosquitto:1883   # the compose service name
```

Then restart the app (`docker compose restart calendar-app`).

In HA, go to Settings → Devices & services → Add integration → MQTT. Set the broker to the server's IP address and the port to 1883. Leave the username and password empty.

The broker allows anonymous connections, so keep port 1883 on your home network. [`mosquitto/config/mosquitto.conf`](../mosquitto/config/mosquitto.conf) explains how to switch to a password file. If you do, the app, HA and the Pi agent all need the login. Add it to the app's config:

```yaml
mqtt:
  url: mqtt://mosquitto:1883
  username: wallcal
  password: !secret mqtt_password
```

and put `mqtt_password` in `config/secrets.yaml`.

### Option B: the HA Mosquitto add-on

Install the Mosquitto broker add-on and start it. HA discovers it and offers to set up the MQTT integration (Settings → Devices & services). Accept.

The add-on refuses anonymous logins, so the app needs an account:

- Either create an HA user (Settings → People → Users), for example `wallcal`. It can be a local-only, non-admin user. The add-on accepts HA users.
- Or add a login in the add-on's `logins` option.

In `config/config.yaml`:

```yaml
mqtt:
  url: mqtt://homeassistant.local:1883   # or HA's IP address
  username: wallcal
  password: !secret mqtt_password
```

and in `config/secrets.yaml`:

```yaml
mqtt_password: the-password-you-set
```

Leave the compose `mqtt` profile off. Restart the app.

### Check it works

Watch the topics. With option A:

```sh
docker compose exec mosquitto mosquitto_sub -t 'wallcal/#' -v
```

With option B, run `mosquitto_sub` from any machine that has it, adding `-h <host> -u <user> -P <password>`. You should see `wallcal/<display id>/availability online` and the retained `…/state` topics. To see the discovery configs:

```sh
mosquitto_sub -t 'homeassistant/+/wallcal_hallway/#' -v
```

Other places to look:

- The header of `/settings` shows the MQTT and HA status. Its Displays tab shows each display's MQTT link.
- `docker compose logs -f calendar-app` shows connection errors. The app keeps retrying in the background, waiting longer each time, up to a minute.

## The device

Each display becomes one HA device. It is called "Wall Calendar" when the config has one display, and "Wall Calendar Hallway" (the display's name) when it has several.

The entities use names relative to the device, so HA normally generates the IDs below. With several displays the device name is part of the ID, for example `select.wall_calendar_hallway_view`. If an ID differs from the table (you renamed it, or a clash added `_2`), look it up under Settings → Devices & services → MQTT → the device.

| Name | Entity ID | What it does |
|---|---|---|
| View | `select.wall_calendar_view` | `month`, `week`, `agenda`, `photo`, `night` or `next`. |
| Month shown | `sensor.wall_calendar_month_shown` | The month the month view shows, as `YYYY-MM`. |
| Previous month, Next month, This month | `button.wall_calendar_previous_month`, `button.wall_calendar_next_month`, `button.wall_calendar_this_month` | Change the month shown. |
| Screen | `switch.wall_calendar_screen` | Screen on or off. |
| Photo source | `select.wall_calendar_photo_source` | Which source the photo frame uses: `immich`, `google` or `local` (the local folder). Config category. A source that isn't set up in the config is still listed, because HA can't hide options; choosing one makes the wall use the first source that is set up instead (Immich, then the folder). `google` is accepted but not built yet, so it is never set up. |
| Brightness | `number.wall_calendar_brightness` | A 0–100 % slider. It dims the page with an overlay. It is not the panel's backlight. |
| Auto presence | `switch.wall_calendar_auto_presence` | Turns the built-in presence policy on or off. Config category. Turn it off when a Home Assistant automation takes over the screen, so the two don't fight (see [Presence, driven by an automation](#presence-driven-by-an-automation-needs-the-pi-agent)). |
| Auto brightness | `switch.wall_calendar_auto_brightness` | Turns the built-in brightness policy on or off. Config category. Turn it off when a Home Assistant automation sets the brightness, so the two don't fight (see [Brightness, driven by an automation](#brightness-driven-by-an-automation-needs-the-pi-agent)). |
| Schedule <name> | `switch.wall_calendar_schedule_morning_agenda` | One for each schedule in the display's config, for a schedule named "Morning agenda". Turns that schedule on or off. Config category. The entity ID follows the schedule's name, and the object ID the app publishes follows its `id` (`schedule_daytime_photos` for `daytime-photos`). Turning a schedule off leaves the wall as it is. Removing a schedule from the config leaves its switch in HA until you delete it there (see [Schedules, driven by automations](#schedules-driven-by-automations)). |
| Message | `text.wall_calendar_message` | Shows a banner on the wall (up to 200 characters). Text only: no icon, and no time limit, so it stays until cleared. Clear the box to remove it. The box empties by itself when the message runs out or is cleared elsewhere. |
| Next photo | `button.wall_calendar_next_photo` | Shows the next photo at once and starts the wait for the one after it again, so a skip is never followed straight away by a scheduled change. Does nothing visible unless the wall is on the `photo` view. |
| Refresh calendars | `button.wall_calendar_refresh_calendars` | Syncs every calendar now. |
| Last sync | `sensor.wall_calendar_last_sync` | When a sync last succeeded (a timestamp, diagnostic). Unknown until the first successful sync. |
| Special day | `sensor.wall_calendar_special_day` | The name of today's special day, or empty when there is none. If two fall on one date, it is the one that comes first by precedence (a one-off before a yearly one, then the most recently edited). Unknown until the app has worked out today's special days. |

All of them show as unavailable while the app is offline. They follow the app's `availability` topic and its last will.

To show a message with an icon or a time limit, publish to the overlay topic yourself. See the bins reminder variant below.

### The Pi device

The Pi agent (see [`pi-agent/`](../pi-agent/README.md)) publishes a second device, "Wall Calendar Pi", the same way. It is only there when the agent runs on the Pi and has `mqtt.discovery` on.

| Name | Entity ID | What it does |
|---|---|---|
| CPU temperature | `sensor.wall_calendar_pi_cpu_temperature` | The Pi's CPU temperature in °C. Diagnostic. |
| Uptime | `sensor.wall_calendar_pi_uptime` | Seconds since the Pi booted. Diagnostic. |
| Button | `event.wall_calendar_pi_button` | Fires `single`, `double` or `long` for every press of the physical button, whatever the app does with it (see `button:` in the app's config). Only there when `sensors.button` is on in the agent's config; turning it off removes the entity. |
| Presence | `binary_sensor.wall_calendar_pi_presence` | On while the mmWave sensor sees someone (device class occupancy). A change only counts once it has held for `presence.hold_ms` (half a second by default), so a flicker doesn't show. Only there when `sensors.presence` is on in the agent's config; turning it off removes the entity. The app's built-in policy uses the same reading (see `policies.auto_presence`). |
| Illuminance | `sensor.wall_calendar_pi_illuminance` | The light in the room in lx (device class illuminance). It is sent when it changes meaningfully (by 10 % and at least 0.5 lx by default) and at least every `light.report_seconds` (30 by default). Only there when `sensors.light` is on in the agent's config; turning it off removes the entity. The app's built-in policy uses the same reading (see `policies.auto_brightness`). |
| Panel power | `binary_sensor.wall_calendar_pi_panel_power` | Whether the panel is on, as the agent last found it. With the `cec` back end that is what the monitor reports, so it also follows the monitor's own remote; with `output` it is whether the Pi's HDMI output is on; with `black` it is the state the agent was last asked for. Diagnostic. |

All of them show as unavailable while the agent is offline (they follow `wallcal/<display id>/pi/availability`). The two diagnostic sensors also go unavailable if the agent stops reporting for three times its diagnostics interval, and so does the illuminance sensor, for three times `light.report_seconds` (90 seconds by default).

To turn the screen on or off, use the app's `switch.wall_calendar_screen`, not the Pi: the app passes it on to the agent on `pi/screen/set`. The panel power sensor is there to check that the panel really followed.

### How discovery behaves

- The configs are retained, so it makes no difference whether the app or HA starts first.
- When HA starts, it publishes `online` on `homeassistant/status` (the MQTT integration's birth message, on by default). The app answers by publishing the configs again.
- The `/settings` Displays tab has a "Republish discovery" button for the same job. It sends `POST /api/settings/discovery`, which needs the PIN if one is set.
- If HA's MQTT integration uses a different discovery prefix, set `mqtt.discovery_prefix`. `discovery: false` turns discovery off.
- The topics are `homeassistant/<component>/wallcal_<display id>/<object id>/config`.

## Weather

The wall can show the weather from one of HA's `weather` entities: the current conditions under today's date in the month view, the forecast for each day in the side panel, and a line for today and tomorrow in the agenda. Leave the `weather` block out and none of that is drawn.

```yaml
homeassistant:
  url: http://homeassistant.local:8123
  token: !secret ha_token

weather:
  entity_id: weather.home
  poll_seconds: 600   # default 600; at least 60
```

- **Which entity.** Any `weather.*` entity from a weather integration, such as Met Office, Met.no, OpenWeatherMap or Pirate Weather. Settings → Devices & services → Entities lists them. The `homeassistant` block must be there too, with a long-lived access token (profile → Security), or the config is refused at start-up.
- **It needs daily forecasts.** The app asks the entity for its daily forecast with the `weather.get_forecasts` action, which HA 2023.12 and later has. An entity that only offers hourly or twice-daily forecasts is refused by HA (HTTP 400), and the app logs `Home Assistant could not give a daily forecast for "weather.home" (HTTP 400)`. Try the action under Developer tools → Actions to see what your entity gives.
- **How often.** Every `poll_seconds`, 10 minutes by default; the first poll comes a few seconds after the app starts. A failing HA is retried after twice the interval, then four times, up to an hour, and the last good weather is kept meanwhile. A failure is logged once, not at every poll, and never contains the URL or the token. The **Refresh calendars** button, the `refresh` command and `POST /api/refresh` fetch the weather again too.
- **What shows when.** The current temperature and condition are hidden once they are three hours old, so a wall that has lost the app doesn't claim it is sunny. Forecast days are hidden when HA gave none for that date. A condition the app has no name for (anything outside HA's list) shows no icon.
- **Dates and temperatures.** A forecast day is placed on the date it falls on in the config's `timezone`, not UTC. Temperatures are rounded to whole degrees and shown with `°` only: the unit is whatever the entity reports, which follows HA's unit system.
- **To look at it.** `GET /api/weather` answers `{ "weather": … }` with what the displays hold, or `{ "weather": null }` before the first poll or with no `weather` block.

## Next alarm

The night view (the very dim clock) can show the time of your next alarm under the clock, so you can see from bed that it is set. It is a per-display choice, `night_text`, and it needs an `alarm` block that says which HA entity holds the alarm. Leave the block out, or leave `night_text` at `none` or `first_event`, and no alarm is read.

```yaml
homeassistant:
  url: http://homeassistant.local:8123
  token: !secret ha_token

alarm:
  entity_id: sensor.pixel_8_next_alarm
  poll_seconds: 300   # default 300; at least 30

displays:
  - id: bedroom
    name: Bedroom
    night_text: next_alarm   # none (default) | first_event | next_alarm
```

- **Which entity.** Either of these:
  - The phone's **next alarm sensor** from the HA companion app (Settings → Companion app → Manage sensors → Next alarm). It is a sensor called something like `sensor.pixel_8_next_alarm` whose state is the alarm's time, with a timestamp device class. On Android it is enabled in the app's sensor settings; the state is `unknown` or `unavailable` when no alarm is set.
  - An **`input_datetime`** helper that has both a date and a time, such as `input_datetime.next_alarm`, if an automation of yours keeps it up to date. One with only a time has no day, so it counts as no alarm.
- **Only these two kinds.** The entity id must start with `sensor.` or `input_datetime.`, and the `homeassistant` block must be there too, or the config is refused at start-up. So is a display with `night_text: next_alarm` and no `alarm` block.
- **What shows.** The wall shows an alarm that is still to come and within the next 24 hours, with "Today" or "Tomorrow" in front of the time. An alarm that has passed, or is further away, is left out. With no alarm the line is left out.
- **How often.** Every `poll_seconds`, 5 minutes by default, so an alarm you set on your phone appears on the wall within about that long. A failing HA is retried after twice the interval, then four times, up to an hour, and the last good answer is kept meanwhile. A failure is logged once, with a `[alarm]` prefix, and never contains the URL or the token. The **Refresh calendars** button, the `refresh` command and `POST /api/refresh` read the alarm again too.

## Example automations

These use HA's current syntax (`triggers:`, `trigger:`, `actions:`, `action:`), which needs HA 2024.10 or later. They are a list, ready for `automations.yaml`. To use one in the automation editor instead, choose Edit in YAML and paste it as a single automation, without the leading `- `.

The entity IDs are the ones from the table above.

```yaml
# Morning agenda
- alias: Wall calendar – morning agenda
  triggers:
    - trigger: time
      at: "06:30:00"
  actions:
    - action: select.select_option
      target:
        entity_id: select.wall_calendar_view
      data:
        option: agenda

# Back to the month view
- alias: Wall calendar – back to month view
  triggers:
    - trigger: time
      at: "09:00:00"
  actions:
    - action: select.select_option
      target:
        entity_id: select.wall_calendar_view
      data:
        option: month

# Screen off when everyone leaves
- alias: Wall calendar – off when away
  triggers:
    - trigger: state
      entity_id: zone.home
      to: "0"
  actions:
    - action: switch.turn_off
      target:
        entity_id: switch.wall_calendar_screen

# Bin reminder banner
- alias: Wall calendar – bins reminder
  triggers:
    - trigger: calendar
      event: start
      entity_id: calendar.bin_collection
      offset: "-6:00:00"
  actions:
    - action: text.set_value
      target:
        entity_id: text.wall_calendar_message
      data:
        value: "Bins out tonight: {{ trigger.calendar_event.summary }}"
```

The first automation sets the agenda at 06:30 and the second goes back to the month at 09:00. Adjust the times to suit.

### Photo frame

Setting the View select to `photo` puts the wall on the photo frame, and any other view takes it off. While the wall is on it, the app changes the photo every `photos.interval_seconds` (60 by default), whichever source it is using, and **Next photo** changes it at once and starts that wait again. The Photo source select picks where the photos come from. Both need a `photos` block in the app's config (see the README); without one the photo view just says it has no photos.

For example, the photo frame in the evening, when nobody is cooking and the calendar isn't needed, and the month view back in the morning:

```yaml
- alias: Wall calendar – photo frame in the evening
  triggers:
    - trigger: time
      at: "19:30:00"
  conditions:
    - condition: state
      entity_id: switch.wall_calendar_screen
      state: "on"
  actions:
    - action: select.select_option
      target:
        entity_id: select.wall_calendar_photo_source
      data:
        option: immich
    - action: select.select_option
      target:
        entity_id: select.wall_calendar_view
      data:
        option: photo

- alias: Wall calendar – calendar in the morning
  triggers:
    - trigger: time
      at: "06:30:00"
  actions:
    - action: select.select_option
      target:
        entity_id: select.wall_calendar_view
      data:
        option: agenda
```

To skip a photo from a dashboard or a voice command, press `button.wall_calendar_next_photo` (`button.press`). The physical button can do the same, or switch between the photo frame and the last calendar view, with `button.single`, `button.double` or `button.long` set to `next_photo` or `toggle_photo` in the app's config. A gesture set to `ha` is left to an automation of your own, as in the long press example below.

The bins reminder uses the `calendar.bin_collection` entity from your own HA. Change the entity to whichever calendar you use. The trigger fires six hours before the event starts.

### Bins reminder with an icon and a time limit

The message box can't set an icon or a time limit. To get those, publish JSON straight to the overlay topic with the `mqtt.publish` action:

```yaml
- alias: Wall calendar – bins reminder with icon
  triggers:
    - trigger: calendar
      event: start
      entity_id: calendar.bin_collection
      offset: "-6:00:00"
  actions:
    - action: mqtt.publish
      data:
        topic: wallcal/hallway/overlay/set
        payload: >-
          {{ {'text': 'Bins out tonight: ' ~ trigger.calendar_event.summary,
              'icon': 'trash',
              'ttl': 43200} | to_json }}
```

Use one of the two bins automations, not both. The topic is `wallcal/<display id>/overlay/set`. The fields:

| Field | Meaning |
|---|---|
| `text` | 1–200 characters. Required. |
| `icon` | Up to 50 characters. Optional. |
| `ttl` | Seconds until the message goes, 1–604800 (a week). Left out, it stays until cleared. |

Here `ttl` is 43200 (12 hours), so the banner is gone by the next morning. An empty payload clears the message.

Never set `retain` on this action. The app ignores a retained message on any `…/set` topic, so that the broker doesn't replay it at every reconnect.

Icon names are `trash`, `bell`, `info`, `alert`, `heart`, `gift`, `cake`, `car`, `utensils`, `cart`, `sun`, `umbrella`, `package`, `home`, `party`, `star`, `calendar`, `clock`, `school`, `plane`, `paw`, `phone` and `key`. HA-style names such as `mdi:trash-can` are mapped to these where there is an equivalent. Anything the app doesn't know shows a speech-bubble icon.

### Alert when calendars stop syncing

The app keeps the last good events when a feed fails ([architecture §10](architecture.md)), so the wall looks fine while the data goes stale. This automation tells you when no sync has succeeded for an hour:

```yaml
- alias: Wall calendar – sync stopped
  triggers:
    - trigger: template
      value_template: >-
        {% set last = states('sensor.wall_calendar_last_sync') | as_datetime(none) %}
        {{ last is not none and now() - last > timedelta(hours=1) }}
  actions:
    - action: notify.notify
      data:
        title: Wall calendar
        message: Calendars haven't synced for over an hour. Check the app's logs.
```

Replace `notify.notify` with your own notify service if you use one. The state is unknown until the first sync, and the template copes with that. `now()` makes HA re-check the template every minute. The automation fires once, when the condition becomes true.

### Dim in the evening

```yaml
- alias: Wall calendar – evening dim
  triggers:
    - trigger: time
      at: "21:00:00"
  actions:
    - action: number.set_value
      target:
        entity_id: number.wall_calendar_brightness
      data:
        value: 40
```

### Long press (needs the Pi agent)

This one needs the Pi agent with the button on (`sensors.button` in its config). It uses the Pi's button entity and a scene of your own.

```yaml
- alias: Wall calendar – long press
  # An event entity's state is the timestamp of the last press, so trigger on any
  # state change and check the event type (an attribute trigger would miss repeat long presses).
  triggers:
    - trigger: state
      entity_id: event.wall_calendar_pi_button
  conditions:
    - condition: state
      entity_id: event.wall_calendar_pi_button
      attribute: event_type
      state: long
  actions:
    - action: scene.turn_on
      target:
        entity_id: scene.leaving_home
```

The `event` entity fires for every press, whatever the app does with it. Set `button.long: ha` in the app's config so the app leaves the long press alone and only this automation acts on it.

### Presence, driven by an automation (needs the Pi agent)

The app has its own presence policy (`policies.auto_presence`): presence turns the screen on, and nobody for ten minutes turns it off. To replace it with your own rules, such as only when someone is home, turn the **Auto presence** switch off first, then drive the screen from the Pi's presence sensor. This needs the Pi agent with the presence sensor on (`sensors.presence` in its config).

```yaml
- alias: Wall calendar – screen on when someone is there
  triggers:
    - trigger: state
      entity_id: binary_sensor.wall_calendar_pi_presence
      to: "on"
  actions:
    - action: switch.turn_on
      target:
        entity_id: switch.wall_calendar_screen

- alias: Wall calendar – screen off after 20 minutes of nobody
  triggers:
    - trigger: state
      entity_id: binary_sensor.wall_calendar_pi_presence
      to: "off"
      for: "00:20:00"
  actions:
    - action: switch.turn_off
      target:
        entity_id: switch.wall_calendar_screen
```

The `for:` makes the screen wait 20 minutes after the last movement before it goes off. Add conditions of your own, such as a `person` being home or the time of day. If the Pi agent goes offline the sensor becomes unavailable, which neither trigger matches, so the screen stays as it was.

Leaving the Auto presence switch on as well means both act, and the app turns the screen off after its own wait, which may not be the one you chose.

### Brightness, driven by an automation (needs the Pi agent)

The app has its own brightness policy (`policies.auto_brightness`): it follows the room's light along a curve, smooths the readings, and can switch to the night view or turn the screen off when the room is dark. To replace it with your own rules, turn the **Auto brightness** switch off first, then set the brightness from the Pi's illuminance sensor. This needs the Pi agent with the light sensor on (`sensors.light` in its config).

```yaml
- alias: Wall calendar – brightness follows the room
  triggers:
    - trigger: state
      entity_id: sensor.wall_calendar_pi_illuminance
  conditions:
    - condition: template
      value_template: "{{ has_value('sensor.wall_calendar_pi_illuminance') }}"
  actions:
    - action: number.set_value
      target:
        entity_id: number.wall_calendar_brightness
      data:
        value: >-
          {% set lux = states('sensor.wall_calendar_pi_illuminance') | float(0) %}
          {{ [30 + lux * 0.35, 100] | min | round(0) }}
```

This runs a straight line from 30 % in the dark to 100 % at 200 lx. Change the numbers to suit the room. Unlike the built-in policy it doesn't smooth the readings, so a passing shadow dims the wall for a moment. A `filter` sensor (the Filter integration) with the `lowpass` filter on the illuminance sensor gives a smoother one to use instead. If the Pi agent goes offline the sensor becomes unavailable, the condition stops the automation, and the brightness stays as it was.

Leaving the Auto brightness switch on as well means both act, and the app puts its own value back at the next reading.

### Schedules, driven by automations

The app has its own schedules (`schedules` under a display, see `config.example.yaml`): a view such as the agenda from 06:30 to 09:00, put on the wall at the start and taken off at the end. Each schedule has a switch, so an automation can turn one off when it shouldn't run, for example while the house is empty or on holiday.

```yaml
- alias: Wall calendar – morning agenda follows the holiday switch
  triggers:
    - trigger: state
      entity_id: input_boolean.on_holiday
  actions:
    - action: "switch.turn_{{ 'off' if is_state('input_boolean.on_holiday', 'on') else 'on' }}"
      target:
        entity_id: switch.wall_calendar_schedule_morning_agenda
```

Turning a schedule off leaves the wall as it is, and turning it on does nothing until its next start. The switch is also the `set_schedule` command on the HTTP API.

To replace the built-in schedules with your own, remove them from the config (or turn their switches off) and use time-triggered automations that set the view:

```yaml
- alias: Wall calendar – agenda in the morning
  triggers:
    - trigger: time
      at: "06:30:00"
  conditions:
    - condition: time
      weekday: [mon, tue, wed, thu, fri]
  actions:
    - action: select.select_option
      target:
        entity_id: select.wall_calendar_view
      data:
        option: agenda
```

An automation sets the view and nothing more. It doesn't go back to the view from before, so add a second one at 09:00 for that. The built-in schedule remembers that view for you.

## Dashboard

### Entities card

```yaml
type: entities
title: Wall calendar
entities:
  - entity: switch.wall_calendar_screen
  - entity: select.wall_calendar_view
  - entity: select.wall_calendar_photo_source
  - entity: button.wall_calendar_next_photo
  - entity: sensor.wall_calendar_month_shown
  - type: buttons
    entities:
      - entity: button.wall_calendar_previous_month
        name: Previous
      - entity: button.wall_calendar_this_month
        name: This month
      - entity: button.wall_calendar_next_month
        name: Next
  - entity: number.wall_calendar_brightness
  - entity: text.wall_calendar_message
  - entity: button.wall_calendar_refresh_calendars
  - entity: sensor.wall_calendar_last_sync
```

To add it: Edit dashboard → Add card → Manual, and paste the YAML.

### The remote page in a Webpage card

The phone remote can sit on a dashboard as a Webpage card:

```yaml
type: iframe
url: http://192.168.1.10:8080/remote?id=hallway
aspect_ratio: 200%
```

Use the server's address and the display's `id`. The page is built for a phone, so a tall `aspect_ratio` suits it. Adjust it until nothing scrolls.

To add it in the UI: Edit dashboard → Add card → Webpage, then enter the URL.

To give the remote its own place in the sidebar instead, go to Settings → Dashboards → Add dashboard → Webpage, and enter the same URL.

If `remote.pin` is set, the remote asks for it once and keeps it in that browser's `localStorage`. The HA companion app counts as its own browser, so it asks once too.

### Caveats

- **HTTPS.** If you open HA over HTTPS (Nabu Casa, or a reverse proxy), the browser blocks an `http://` page inside it as mixed content, and the card stays blank. Either serve the app over HTTPS as well, through a proxy of the same kind, or use the Entities card.
- **Local network only.** The app isn't exposed to the internet and shouldn't be. Away from home the Webpage card stays blank. For access away from home, use HA's own remote access with the entities above, not the Webpage card.
- The app sends no `X-Frame-Options` or `frame-ancestors` header, so HA is allowed to frame it.

## Troubleshooting

| Problem | What to check |
|---|---|
| No device appears | `discovery` is not `false` in the config. The broker is the same one HA's MQTT integration uses. HA's discovery prefix matches `mqtt.discovery_prefix`. The `mosquitto_sub -t 'homeassistant/+/wallcal_hallway/#' -v` command shows configs. Try "Republish discovery" on the `/settings` Displays tab. |
| Entities are unavailable | The app is offline or can't reach the broker. Check the MQTT status in the `/settings` header and `docker compose logs -f calendar-app`. Wrong URL, username or password show up there. |
| A command does nothing | The display id in a topic must match the config exactly. A retained message on a `…/set` topic is ignored, so check `retain` is off. A payload that doesn't fit the topic is ignored and logged. The PIN does not apply to MQTT. |
| A device from an old display id is still there | Renaming a display id leaves the old device behind. Delete it in HA, and clear its retained configs: `mosquitto_pub -r -n -t homeassistant/<component>/wallcal_<id>/<object>/config` for each entity. |
| "Month shown" goes back by itself | A month picked on the remote or from HA reverts to the current month after `month_return_minutes` (15 by default, set per display). |
| No weather on the wall | The config has a `weather` block (and a `homeassistant` block). `GET /api/weather` is not `null`; if it is, `docker compose logs calendar-app` has a `[weather]` line with the reason. HA refusing the token, no such entity, or an entity with no daily forecast are the usual ones. |
| No alarm on the night view | The display has `night_text: next_alarm`, and the config has an `alarm` block (and a `homeassistant` block). The entity's state in Developer tools → States is a time, not `unknown`; the time is within the next 24 hours. If it is, `docker compose logs calendar-app` has an `[alarm]` line with the reason, such as HA refusing the token or no such entity. |
| The Webpage card is blank | See the caveats above: HTTPS, or you are away from home. |

To remove the device on purpose, delete it in HA and set `discovery: false`, or the app will bring it back at its next start. Or clear each retained config as in the table.
