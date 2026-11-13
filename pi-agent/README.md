# Pi agent

A small Python service that runs on the Raspberry Pi next to the kiosk and talks to the same MQTT broker as the Wall Display app. It is the Pi's side of the contract in [`contracts/mqtt.json`](../contracts/mqtt.json).

What it does so far:

- Publishes `pi/availability`: `online` while it runs, and `offline` from the broker's last will if it dies, or from the agent itself on a clean stop.
- Publishes Home Assistant discovery configs for a "Wall Calendar Pi" device, with three diagnostic entities (CPU temperature, uptime and panel power) and, when the button, the presence sensor and the light sensor are on, a Button event entity, a Presence binary sensor and an Illuminance sensor.
- Publishes the CPU temperature and uptime every minute.
- Turns the panel on and off when the app asks (`pi/screen/set`), and publishes what the panel is doing (`pi/screen/state`). See [Screen power](#screen-power).
- Reads a push button on a GPIO pin, tells single, double and long presses apart, and publishes each one to `pi/button`. See [Button](#button).
- Reads an LD2410 mmWave sensor, either from its OUT pin on a GPIO or from its serial data, and publishes whether someone is there to `pi/presence` (retained). See [Presence](#presence).
- Reads a VEML7700 or BH1750 ambient light sensor over I²C and publishes the room's brightness in lux to `pi/illuminance`, when it changes meaningfully and at least every 30 seconds. See [Light sensor](#light-sensor).
- If the app goes away, turns the screen off when nobody is there and on again when someone comes, until the app is back. See [Offline fallback](#offline-fallback).

The agent only talks to the broker. It holds no state of its own, and the app works the same without it. With the default `black` screen back end it does nothing to the panel at all.

## Install on the Pi

You need the kiosk Pi from [`kiosk/README.md`](../kiosk/README.md) (or any Raspberry Pi OS Bookworm or later), and the Wall Display broker reachable from it. Get this folder onto the Pi, the same way as for the kiosk, then:

```sh
sudo ./wall-display/pi-agent/install.sh
sudo nano /etc/wallcal-agent/config.yaml
sudo systemctl restart wallcal-agent
```

`install.sh`:

1. Installs `python3-venv`, `python3-lgpio` (what reads the button's GPIO), `cec-utils` (for the `cec` screen back end) and `wlopm` (for the `output` one). If `wlopm` isn't available on your release, it warns and carries on: the agent doesn't need it unless you choose `output` with the `wlopm` tool.
2. Creates a `wallcal-agent` system user and group with no login. It is added to the `gpio`, `i2c`, `dialout` and `video` groups where they exist: `gpio` is for the button and the presence sensor's OUT pin, `dialout` is for the presence sensor's serial port, `i2c` is for the light sensor's `/dev/i2c-1`, and `video` gives access to `/dev/cec*` for the `cec` back end.
3. Installs the agent into a venv at `/opt/wallcal-agent/venv`. The venv can see the system's Python packages, because `python3-lgpio` only comes from apt. An older venv made without that is switched over.
4. Copies `config.example.yaml` to `/etc/wallcal-agent/config.yaml`, only if there is no config yet. The file is `0640`, owned by `root:wallcal-agent`, because it holds the MQTT password.
5. Installs `wallcal-agent.service`, enables it, and restarts it.

The first run does not start the service, because the example config doesn't point at your broker. Edit the config, then restart it. Running `install.sh` again is safe: it upgrades the agent, keeps your config and restarts the service. To pick up a new version, pull the repo and run it again.

The service has `Restart=always`, so systemd brings it back (after 5 seconds) if it exits. Even when the broker is down it keeps running and reconnects in the background.

## Config

The file is `/etc/wallcal-agent/config.yaml`. [`config.example.yaml`](config.example.yaml) is the starting point. A key that isn't listed here is an error, so a typo doesn't go unnoticed.

| Key | Default | |
|---|---|---|
| `display_id` | none, required | Which display this Pi belongs to: the `id` from the app's config (`displays[].id`). Lower case letters, digits and `-`. |
| `mqtt.host` | none, required | The broker. |
| `mqtt.port` | `1883` | |
| `mqtt.username`, `mqtt.password` | none | A password needs a username. |
| `mqtt.tls` | `false` | `true` connects with TLS, using the system's CA store. |
| `mqtt.client_id` | `wallcal-pi-<display_id>` | 1 to 64 letters, digits, `-` and `_`. Two clients with the same id knock each other off the broker. |
| `mqtt.discovery` | `true` | Publish the Home Assistant discovery configs. |
| `mqtt.discovery_prefix` | `homeassistant` | Change it if Home Assistant's MQTT integration uses another prefix. |
| `diagnostics_interval_seconds` | `60` | How often CPU temperature and uptime are published. At least 5. |
| `sensors.button` | `false` | `true` if a push button is wired to this Pi. See [Button](#button). |
| `sensors.presence` | `false` | `true` if an LD2410 mmWave sensor is wired to this Pi. See [Presence](#presence). |
| `sensors.light` | `false` | `true` if a VEML7700 or BH1750 light sensor is wired to this Pi. See [Light sensor](#light-sensor). |
| `button.pin` | `17` | The button's BCM GPIO number (not the pin's place on the header), a whole number from 0 to 27. |
| `button.bounce_ms` | `30` | A change on the input only counts once it has stayed that way this long, so contact bounce isn't read as presses. 0 to 200. |
| `button.double_press_ms` | `400` | The longest gap from letting go of the first press to pressing again that still makes a double press. 100 to 2000. |
| `button.long_press_ms` | `1000` | Held down this long is a long press. 300 to 10000. |
| `presence.source` | `gpio` | How the sensor is read: `gpio` (its OUT pin as a plain input) or `uart` (its serial data frames). |
| `presence.pin` | `27` | The OUT pin's BCM GPIO number, 0 to 27, for the `gpio` source. GPIO27 is physical pin 13. It can't be the button's pin when both sensors are on. |
| `presence.hold_ms` | `500` | A change only counts once it has held this long, so a flicker isn't published. 0 to 10000. |
| `presence.uart.device` | `/dev/serial0` | The serial port, as an absolute path, for the `uart` source. |
| `presence.uart.baud` | `256000` | The sensor's speed, for the `uart` source: one of 9600, 19200, 38400, 57600, 115200, 230400, 256000 (the factory setting) or 460800. |
| `light.chip` | `veml7700` | Which sensor: `veml7700` or `bh1750`. |
| `light.bus` | `1` | The I²C bus, so `/dev/i2c-<bus>`, a whole number from 0 to 31. Bus 1 is the one on the header's pins 3 and 5. |
| `light.address` | the chip's own | The chip's I²C address. The VEML7700 only has `0x10`. The BH1750 is `0x23`, or `0x5c` with its ADDR pin wired high. Written as in the datasheet, `0x23`. |
| `light.sample_ms` | `1000` | How often the sensor is read. Most readings are not published. 200 to 60000. |
| `light.change_percent` | `10` | A reading is published when it differs from the last one published by at least this share of it. 1 to 100. |
| `light.change_lux` | `0.5` | ...and by at least this many lux, so flicker in a dark room isn't a change. A number, 0 to 1000. |
| `light.report_seconds` | `30` | A reading is published at least this often even when nothing has changed. 5 to 3600. |
| `fallback.enabled` | `true` | Whether the agent looks after the screen on its own while the app is away. It needs `sensors.presence`. See [Offline fallback](#offline-fallback). |
| `fallback.timeout_minutes` | `5` | How long the app must be offline, or the broker unreachable, before the agent takes over. 1 to 1440. |
| `fallback.off_after_minutes` | `10` | With nobody there this long while the agent is in charge, it turns the screen off. 1 to 1440. |
| `screen.backend` | `black` | How the panel is turned on and off: `black`, `cec` or `output`. See [Screen power](#screen-power). |
| `screen.cec.device` | `0` | The `cec` back end: the CEC logical address to switch, 0 to 15. 0 is the TV. |
| `screen.output.tool` | `wlopm` | The `output` back end: `wlopm` or `wlr-randr`. |
| `screen.output.name` | `HDMI-A-1` | The `output` back end: the output's name, one word such as `HDMI-A-1` or `DP-1`. |
| `screen.output.wayland_display` | `/run/user/1000/wayland-0` | The `output` back end: the kiosk's Wayland socket, as an absolute path. |
| `screen.command_timeout_seconds` | `10` | How long `cec-client`, `wlopm` or `wlr-randr` may take before it is given up on. 1 to 60. |
| `screen.poll_seconds` | `60` | How often the real panel state is read, and published if it changed. `0` never checks; otherwise at least 5. |

The settings for a back end you haven't chosen are still checked, and so are the `button`, `presence`, `light` and `fallback` settings while their sensors or the fallback are off, so a mistake in them shows up now and not on the day you switch.

A config that is wrong makes the agent print what is wrong, naming the key (such as `mqtt.port: must be 1 to 65535`), and exit with status 2. systemd then restarts it every 5 seconds until the file is fixed. The password is never logged.

## Screen power

The app publishes the screen it wants (`on` or `off`) to `pi/screen/set`, retained, and the agent follows it. Which way it does that is `screen.backend`:

| Back end | What it does | What it needs |
|---|---|---|
| `black` (default) | Nothing to the panel. The display page already goes pure black when the screen is `off`, so the wall looks dark, but the panel stays lit. | Nothing. It always works. |
| `cec` | Runs `cec-client` to send the monitor `on` or `standby` over HDMI CEC, so the panel really switches off. | `cec-utils` (the installer adds it). The `wallcal-agent` user in the `video` group, for `/dev/cec*` (the installer does this). CEC (Anynet+, Bravia Sync, SimpLink and so on) switched on in the monitor's menu, and a monitor that supports it. |
| `output` | Runs `wlopm` (or `wlr-randr`) against the kiosk's compositor to switch its HDMI output off and on, so the panel loses its signal and goes to sleep by itself. | `wlopm` (the installer adds it where it can) or `wlr-randr`, and a kiosk that lets the service user reach the compositor's Wayland socket. |

Notes for each:

- **`cec`**: `cec.device` is the CEC address of the monitor, 0 for a TV. Some panels ignore `standby` or never wake from it, so try it by hand first (below).
- **`output`**: the service has no desktop session of its own, so each command is told where to connect with `WAYLAND_DISPLAY` and `XDG_RUNTIME_DIR`, taken from `output.wayland_display`. The kiosk's user keeps `/run/user/<uid>` private, so the kiosk launcher (`kiosk/bin/wallcal-kiosk`) gives the `wallcal-agent` user access to that folder and the socket when it starts the compositor. That is why the unit has `ProtectHome=read-only` and not `yes`, which would hide `/run/user`. The output's name is the one `wlopm` lists. The default `wayland_display` assumes the kiosk user is the first user (uid 1000).
- **`black`**: there is nothing to set up. Use it until you know the other two work on your monitor.

Whichever back end is chosen, the page still goes black when the screen is `off`, so a Pi whose agent is down, or a panel that ignores the command, still looks off.

How it behaves:

- Nothing touches the panel until a request arrives. A clean stop leaves the panel as it is. The request is retained on the broker, so the agent applies the last one when it starts and each time it reconnects.
- The commands run on a worker thread, so a slow `cec-client` never stops the agent talking to the broker. If requests arrive faster than the panel can follow, only the newest is applied.
- After each request the agent reads the panel back and publishes what it says to `pi/screen/state`. If the panel can't be read back but the command worked, it publishes what was asked for. If both fail it publishes nothing, and logs one warning (a repeat of the same failure goes to debug level, so it doesn't fill the journal).
- The agent also publishes the state when it connects, and every `screen.poll_seconds` it reads the panel again and publishes only a change, which catches someone using the monitor's own remote.
- A request that isn't exactly `on` or `off` is logged and ignored. An empty one (a cleared retained message) is ignored quietly.

Try a back end by hand on the Pi, as the `wallcal-agent` user, before choosing it:

```sh
# cec: ask the monitor, then switch it
echo 'pow 0' | sudo -u wallcal-agent cec-client -s -d 1        # "power status: on" or "standby"
echo 'standby 0' | sudo -u wallcal-agent cec-client -s -d 1
echo 'on 0' | sudo -u wallcal-agent cec-client -s -d 1

# output: list the outputs, then switch one
sudo -u wallcal-agent env WAYLAND_DISPLAY=/run/user/1000/wayland-0 XDG_RUNTIME_DIR=/run/user/1000 wlopm
sudo -u wallcal-agent env WAYLAND_DISPLAY=/run/user/1000/wayland-0 XDG_RUNTIME_DIR=/run/user/1000 wlopm --off HDMI-A-1
sudo -u wallcal-agent env WAYLAND_DISPLAY=/run/user/1000/wayland-0 XDG_RUNTIME_DIR=/run/user/1000 wlopm --on HDMI-A-1
```

Then watch it work by publishing a request:

```sh
mosquitto_pub -h <broker> -t 'wallcal/<display id>/pi/screen/set' -r -q 1 -m off
```

## Button

A push button on a GPIO pin gives the wall three gestures to play with. The agent publishes each one to `pi/button`, and the app and Home Assistant decide what it does.

Wire the button between the GPIO and a ground (GND) pin. By default that is GPIO17, which is physical pin 11, next to ground on pin 9. The agent switches on the Pi's own pull-up resistor, so the input sits high until the button pulls it low, and no resistor is needed. Then set `sensors.button: true` (and `button.pin` if you used another pin) in the config and restart the agent.

The gestures:

| Gesture | What you do | When it is published |
|---|---|---|
| `single` | Press and let go. | Once `button.double_press_ms` (400 ms) has passed with no second press, because until then it might be the start of a double. |
| `double` | Press, let go, and press again within `button.double_press_ms` of letting go. | As soon as the second press is made. Holding that second press, or letting go of it, adds nothing. |
| `long` | Hold the button for `button.long_press_ms` (1 s). | While it is still held, so the wall answers without waiting for you to let go. Letting go afterwards adds nothing. |

A press that is let go before `long_press_ms` is a short press, however slowly the contacts settled. `button.bounce_ms` (30 ms) is how long the input has to stay put before a change counts, so a button that chatters as it closes still gives one press. A button that is already held down when the agent starts does nothing until it has been let go and pressed again.

What each gesture does is not the agent's business. The app looks the gesture up in its own `button:` config (`next_view`, `toggle_photo`, `ha`, and so on) and acts on it, and Home Assistant always gets the Button `event` entity, so it sees every press whatever the app does with it. See [docs/home-assistant.md](../docs/home-assistant.md).

How it behaves:

- A press is dropped, not saved, if the broker can't be reached when it happens. A "long press" arriving minutes late would do something nobody asked for.
- Each gesture is logged at `info` level, such as `Button: double press`.
- If the GPIO can't be opened (the pin is in use, the service user has no access to the GPIO, or this isn't a Pi), the agent logs one warning, `Could not open the button on GPIO17: ...; carrying on without it`, and runs on without the button. It doesn't exit, which would only have systemd restart it every 5 seconds. The Home Assistant entity is still announced, because that follows the config.

Watch the presses with the Mosquitto tools while you try it:

```sh
mosquitto_sub -h <broker> -t 'wallcal/<display id>/pi/button' -v
```

## Presence

An LD2410 mmWave radar sensor tells the wall whether anyone is in front of it, even if they are sitting still. The agent publishes `ON` or `OFF` to `pi/presence`, retained, and the app's auto presence policy turns the screen on when someone arrives and off after a while with nobody there. Home Assistant gets a Presence entity too. Set `sensors.presence: true` in the config and restart the agent.

There are two ways to read the sensor, set by `presence.source`.

**`gpio` (the default)** reads the sensor's OUT pin as a plain input. The sensor drives it high while it sees someone, and the Pi's pull-down holds it low otherwise, so a loose wire reads "nobody". Wire:

| LD2410 | Pi |
|---|---|
| VCC | 5 V (pin 2 or 4) |
| GND | GND (pin 6) |
| OUT | GPIO27 (pin 13), or the pin in `presence.pin` |

**`uart`** reads the sensor's data frames, which come about ten times a second and say whether it sees someone moving or still, and how far away. Use it if you want to go beyond yes and no later; the pin is simpler. Wire:

| LD2410 | Pi |
|---|---|
| VCC | 5 V |
| GND | GND |
| TX | GPIO15 (RXD, pin 10) |
| RX | GPIO14 (TXD, pin 8) |

The Pi's serial port is off by default and the serial console is on, so run `sudo raspi-config`, then Interface Options, Serial Port: answer **No** to "login shell over serial" and **Yes** to "serial port hardware", and reboot. `presence.uart.device` is `/dev/serial0` (the Pi's own UART, whichever one that is on your model); a USB serial adapter is `/dev/ttyUSB0`. The sensor ships at 256000 baud, which is the default for `presence.uart.baud`. The service user is in the `dialout` group, which is what lets it open the port. The sensor's engineering reports are accepted but only the "someone is there" part is used, and the agent never sends the sensor commands, so its settings (distance gates, sensitivity) stay as they are. Change those with the maker's app. To see the energy at each gate while you walk about, which is what you tune those settings by, run `hw-probe mmwave --uart` (see [tools/hw-probe](../tools/hw-probe/README.md)).

How it behaves:

- A change only counts once it has held for `presence.hold_ms` (500 ms), counted from when it first happened. A flicker shorter than that is dropped. The first reading counts too, once it has held, so the agent publishes the state at start-up and not only a change.
- Presence is a state, not an event, so nothing is dropped while the broker is away: the agent remembers the latest state and publishes it, retained, when the connection comes back, and again on every connect. The retained message is how the app learns the current state when it starts.
- A clean stop leaves the retained value alone. If the Pi vanishes, the app and Home Assistant see the agent go `offline`, and the Presence entity goes unavailable with it.
- Each change is logged at `info` level, such as `Presence: someone is there` or `Presence: nobody`.
- If the GPIO or the serial port can't be opened (the pin is in use, the service user has no access, the port is missing or turned off), the agent logs one warning, such as `Could not open the presence sensor on GPIO27: ...; carrying on without it`, and runs on without it.
- With `uart`, a port that fails later (a cable pulled, a USB adapter reset) is a warning once, and the agent closes it and tries again every few seconds. If the port is open but no frame arrives for 10 seconds, it warns once (`No frames from the LD2410 ...`, which means the wiring or the baud rate is wrong) and logs when frames return. The last state stands meanwhile.

Watch it with the Mosquitto tools while you walk up to the wall:

```sh
mosquitto_sub -h <broker> -t 'wallcal/<display id>/pi/presence' -v
```

## Light sensor

A VEML7700 or a BH1750 ambient light sensor tells the wall how bright the room is. The agent publishes the reading in lux to `pi/illuminance`, and the app's auto brightness policy can dim the display with it. Home Assistant gets an Illuminance entity too. Both chips are small breakout boards on the Pi's I²C pins, and the agent reads them with the `smbus2` library. Set `sensors.light: true` in the config (and `light.chip: bh1750` if that is the one you have) and restart the agent.

Wire either chip:

| Sensor | Pi |
|---|---|
| VIN (or VCC) | 3.3 V (pin 1) |
| GND | GND (pin 6) |
| SDA | GPIO2 (pin 3) |
| SCL | GPIO3 (pin 5) |

I²C is off by default on Raspberry Pi OS, so run `sudo raspi-config`, then Interface Options, I2C, and answer **Yes**. The installer does not do that for you, because it changes the Pi's boot settings. Afterwards `/dev/i2c-1` should exist. To check the wiring, `sudo apt install i2c-tools` and run `i2cdetect -y 1`: a VEML7700 shows as `10` and a BH1750 as `23` (or `5c` with its ADDR pin high; set `light.address` to match). The service user is in the `i2c` group, which is what lets it open the bus.

How it behaves:

- The sensor is read every `light.sample_ms` (1 s), but most readings are the same room again, so a reading is published only when it has changed meaningfully, or `light.report_seconds` (30 s) after the last one published, so a subscriber is never more than that out of date. A change is meaningful when it is at least `light.change_percent` (10%) of the last published value and at least `light.change_lux` (0.5 lx), so a bright room has to move a good deal and flicker in a dark one doesn't count. The payload is the lux as text with at most two decimal places, such as `0`, `12.5` or `430`.
- A reading is a measurement, not a state, so it is not retained: a stale one replayed to a subscriber that connects later would be worse than none. Nothing is saved while the broker is away. Every connect starts afresh, so the new connection hears the light at the next sample.
- The VEML7700 has two ranges and the agent moves between them as the light changes: a fine one for rooms (up to about 1100 lx) and a coarse one for daylight (up to about 35 klx, with the chip's non-linearity corrected). It is never a reading from the wrong range: after a move the agent waits for a fresh one. The BH1750 reads up to about 27 klx in its 0.5 lx mode.
- If the bus can't be opened or the chip doesn't answer (I²C is off, the wiring is loose, the service user has no access), the agent logs one warning, such as `Could not read the light sensor: /dev/i2c-1 is not there; is I2C switched on in raspi-config?; will keep trying`, and carries on without it. It keeps trying every sample, opening the bus and setting the chip up again each time, so a sensor that is plugged in later is found. A repeat of the same failure goes to debug level, and `The light sensor is reading again` is logged once when it recovers. The Home Assistant entity is still announced, because that follows the config, and goes unavailable if nothing is published for three report intervals.

Watch it with the Mosquitto tools while you cover the sensor with your hand:

```sh
mosquitto_sub -h <broker> -t 'wallcal/<display id>/pi/illuminance' -v
```

## Offline fallback

The app's presence policy turns the screen on and off, but it runs on the home server. If the server is down, the wall would stay as it was, lit all night. So the agent has a small rule of its own for that case. It needs the presence sensor (`sensors.presence`), because without it there is nothing to go on. With `fallback.enabled: false` the agent never does this.

The agent hears whether the app is up from the app's `availability` topic, which the app publishes retained, with a last will, so it goes `offline` if the app dies. The app counts as **down** unless the agent is connected to the broker and the last thing it heard there was `online`. So an `offline` message, a broker that can't be reached, and nothing heard yet all count the same. A message that is neither `online` nor `offline` is logged and counts as down too.

The rules:

1. Once the app has been down for `fallback.timeout_minutes` (5) without a break, the agent takes over. If the app comes back sooner, nothing happens and the wait starts again next time. A Pi that boots while the server is down counts from the moment the agent starts, so it takes over after the same wait.
2. While the agent is in charge, someone arriving turns the panel on. It acts when presence goes from nobody to someone. If someone is already there when it takes over, the screen is left as the app left it.
3. While the agent is in charge, nobody there for `fallback.off_after_minutes` (10) turns the panel off, once. The wait counts from when presence went to nobody, or from when the agent took over, whichever is later, so a Pi that has been empty all along turns the screen off 10 minutes after it takes over, not 15. Someone arriving cancels the wait, and if they leave again a new one starts.
4. If someone turns the screen on by hand while nobody is there (a live `pi/screen/set` of `on`, such as one sent with `mosquitto_pub`), the wait starts again from then, so it still goes off later.
5. The moment the app is up again, the agent hands back and does nothing more. It applies the newest `pi/screen/set` it has heard, ignored or not, so the panel goes back to what the app wants. That matters when it was the Pi that lost the broker and the app never went away: an app that has just started publishes the screen state again anyway.

The app's retained `pi/screen/set` is ignored while the agent is in charge. It is only the app's last word from before it went away, and the broker replays it on every reconnect, so obeying it would undo what the fallback just did. It is applied at the hand-back instead. A live request is still applied. When the agent is not in charge the screen works as in [Screen power](#screen-power), retained request included.

With the `black` back end the agent's switch does nothing to the panel, so the fallback has no visible effect: the page that would have gone black is served by the app, which is down. Use `cec` or `output` to make it count.

How it behaves:

- The agent subscribes to `availability` (QoS 1) on every connect, only when the fallback is in use: enabled, and the presence sensor opened. At start it logs `Offline fallback: on (takes over after 5 min without the app; screen off after 10 min with nobody there)`, or `Offline fallback: off` (with the reason, if it needs the sensor).
- Taking over is a warning (`The app has been away for 5 minutes; the agent is looking after the screen until it is back`) and handing back is `info`, as are the panel switches it makes (`Offline fallback: nobody for 10 minutes, turning the panel off`).
- The panel is switched through the same worker as a `pi/screen/set`, so a slow `cec-client` still never holds anything up, and `pi/screen/state` is published as usual.

To try it, stop the app and watch the journal. With the stack from the repo's compose file:

```sh
docker compose stop calendar-app
journalctl -u wallcal-agent -f
```

The app's last will puts `availability` to `offline` at once, and after `fallback.timeout_minutes` the agent logs that it is in charge. Walk away from the wall and wait for the screen to go off, then walk up to it. Start the app again to see it hand back. Setting both times to 1 makes this quick.

## Logs

```sh
journalctl -u wallcal-agent -f
systemctl status wallcal-agent
```

Add `--log-level debug` to `ExecStart` (with `sudo systemctl edit --full wallcal-agent`) for more detail. The agent logs the first failed connection to the broker, and then keeps retrying quietly, with a wait that grows up to a minute.

## What it publishes

Everything is under `wallcal/<display id>/`, as text. The contract has the schemas.

| Topic | Retained | Payload |
|---|---|---|
| `pi/availability` | yes | `online` or `offline` (the last will) |
| `pi/cpu_temperature` | no | °C to one decimal place, such as `48.3`. Left out when the temperature can't be read. |
| `pi/uptime` | no | Seconds since the Pi booted, a whole number. |
| `pi/screen/state` | yes | `on` or `off`: what the panel is doing, as far as the agent can tell. Left out when it can't tell. |
| `pi/button` | no | `single`, `double` or `long`: one message for each press of the button, only when `sensors.button` is on. Not retained, so a press is never replayed to someone who connects later. |
| `pi/presence` | yes | `ON` when the mmWave sensor sees someone, `OFF` when it doesn't, only when `sensors.presence` is on. Published on every confirmed change and on every connect, and retained, because it is a state: a subscriber that connects later learns it at once. |
| `pi/illuminance` | no | The room's light in lux, at most two decimal places such as `12.5`, only when `sensors.light` is on. Published when it changes meaningfully and at least every `light.report_seconds`. Not retained: a stale reading is worse than none. |

It subscribes to `pi/screen/set` (QoS 1), which the app publishes retained, `on` or `off`. See [Screen power](#screen-power). When the offline fallback is in use it also subscribes to the app's own `availability` (QoS 1), which the app publishes retained, `online` or `offline`, and which the agent only reads. See [Offline fallback](#offline-fallback).

The discovery configs go to `<discovery_prefix>/sensor/wallcal_pi_<display id>/<cpu_temperature|uptime>/config`, `<discovery_prefix>/binary_sensor/wallcal_pi_<display id>/panel_power/config`, `<discovery_prefix>/event/wallcal_pi_<display id>/button/config`, `<discovery_prefix>/binary_sensor/wallcal_pi_<display id>/presence/config` and `<discovery_prefix>/sensor/wallcal_pi_<display id>/illuminance/config`, retained. Home Assistant creates `sensor.wall_calendar_pi_cpu_temperature`, `sensor.wall_calendar_pi_uptime`, `binary_sensor.wall_calendar_pi_panel_power`, `event.wall_calendar_pi_button`, `binary_sensor.wall_calendar_pi_presence` and `sensor.wall_calendar_pi_illuminance`. All of them go unavailable while the agent is offline, and the sensors also if they stop being reported for three intervals (the diagnostics' interval, or `light.report_seconds` for the illuminance; the panel power doesn't expire, because it only changes when someone asks, the button is an event, not a reading, and presence is a retained state that can stay the same for days). The first three are diagnostic entities; the button, presence and illuminance are not, because they are the ones you would put on a dashboard or use in an automation. The button's event types are `single`, `double` and `long`, Presence is an `occupancy` binary sensor (`ON` is detected), and Illuminance is an `illuminance` sensor in `lx`. When `sensors.button`, `sensors.presence` or `sensors.light` is off, the agent publishes an empty retained config to that entity's topic, which removes the entity if it was there from an earlier run. When Home Assistant restarts and announces `online` on `<discovery_prefix>/status`, the agent publishes the configs again. See [docs/home-assistant.md](../docs/home-assistant.md).

Watch it with the Mosquitto tools:

```sh
mosquitto_sub -h <broker> -t 'wallcal/<display id>/pi/#' -v
```

## Development

You need Python 3.11 or newer. Nothing here needs a Pi or a broker.

```sh
cd pi-agent
python3.11 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/ruff check .
.venv/bin/ruff format .
.venv/bin/pytest
shellcheck install.sh
```

The tests use a fake MQTT client and fake hardware, and a fake command runner for the screen back ends, so nothing runs `cec-client` or `wlopm`. Some of them hold the agent to [`contracts/mqtt.json`](../contracts/mqtt.json), the same file the app's tests use: every topic the agent publishes must be in it, from the Pi, with the same retain flag, and every payload must match its schema, and every `pi/screen/set` example is applied while every invalid one is ignored, and the button's gestures and presence's `ON` and `OFF` are the contract's, and the illuminance payloads match the contract's pattern. A new `pi/` topic in the contract fails a test until the agent handles it, or the test names the PR that will. `tests/test_install.py` runs `install.sh` against a scratch folder, so it needs no root.

The button is tested in layers. `button.py` is the gesture classifier: it has no threads and no clock of its own, so `tests/test_button.py` plays presses at exact times (noise, bounce, doubles, a long press, a triple press). The agent tests use a `FakeButton` whose `press()` and `release()` stand in for the GPIO library's callback, an injected clock, and no worker thread: a test presses the button, moves the clock and calls `run_button_work()`, as the screen tests call `run_screen_work()`. A few tests run the real worker thread with the shortest timings the config allows. `hardware/gpio.py` is tested against gpiozero's own `MockFactory`, driving a mock pin low and high, so that part needs no Pi either.

Presence is tested the same way, in layers. `presence.py` is the filter: pure, with no clock of its own, so `tests/test_presence.py` plays readings at exact times (flickers, a late tick, a zero hold). `hardware/ld2410.py` has a pure frame parser, tested in `tests/test_ld2410.py` with byte strings (frames split at every place, garbage, a false header, command replies, a capped buffer), and a reader thread, tested against a fake serial port handed in through a port factory, so no serial device is needed. The agent tests use a `FakePresence` and `run_presence_work()`, as for the button, and `hardware/gpio.py`'s `GpioPresence` runs on gpiozero's mock pins.

The light sensor is tested the same way. `light.py` is the reporter that decides which readings are published: pure, with no clock of its own, so `tests/test_light.py` plays readings at exact times (changes just under, at and over each threshold, the heartbeat, a reset, a clock that steps back). `hardware/light.py` has the VEML7700's and the BH1750's conversions as pure functions, and the two chips run against a fake I²C bus handed in through a bus factory, so `tests/test_light_hardware.py` checks the registers written, the auto-range up and down, the error messages, and the bus being opened again after a failure with no Pi and no sleeping. The agent tests use a `FakeLight` and `run_light_work()`, as for the others.

To run the agent against a broker on your machine, without any Pi hardware:

```sh
cp config.example.yaml /tmp/wallcal-agent.yaml   # set mqtt.host to localhost
.venv/bin/wallcal-agent --config /tmp/wallcal-agent.yaml --fake-hardware --log-level debug
```

`--fake-hardware` reports made-up readings (the uptime counts up from when the agent started) and uses a pretend panel that starts on and follows `pi/screen/set`, whatever `screen.backend` says. With `sensors.button` on it uses a button that is never pressed, with `sensors.presence` on a presence sensor that sees nobody, and with `sensors.light` on a light sensor that always reads 150 lux. To try presence without a sensor, publish it yourself: `mosquitto_pub -h localhost -t 'wallcal/<display id>/pi/presence' -r -q 1 -m ON`. To try the light without a sensor, publish a reading yourself: `mosquitto_pub -h localhost -t 'wallcal/<display id>/pi/illuminance' -q 1 -m 12.5`. To try a gesture without wiring anything, publish it yourself: `mosquitto_pub -h localhost -t 'wallcal/<display id>/pi/button' -q 1 -m double`. `python -m wallcal_agent` does the same as the `wallcal-agent` command, and `--version` prints the version.

The code is in `src/wallcal_agent/`. The hardware sits behind small interfaces in `hardware/`, with a real Linux implementation and a fake one, so that new sensors can be added the same way. The screen back ends are in `hardware/screen.py`, the button's and the presence pin's GPIO are in `hardware/gpio.py`, the LD2410's serial reader and frame parser are in `hardware/ld2410.py`, the light sensor chips are in `hardware/light.py`, the gesture classifier is `button.py`, the presence filter is `presence.py` and the light reporter is `light.py`. `tools/hw-probe`'s sensor probes import the hardware classes, the gesture detector, the presence filter and the light reporter straight from here, so keep them importable without PyYAML or the hardware libraries (`tests/test_hardware_imports.py` checks this).
