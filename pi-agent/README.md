# Pi agent

A small Python service that runs on the Raspberry Pi next to the kiosk and talks to the same MQTT broker as the Wall Display app. It is the Pi's side of the contract in [`contracts/mqtt.json`](../contracts/mqtt.json).

What it does so far:

- Publishes `pi/availability`: `online` while it runs, and `offline` from the broker's last will if it dies, or from the agent itself on a clean stop.
- Publishes Home Assistant discovery configs for a "Wall Calendar Pi" device, with three diagnostic entities: CPU temperature, uptime and panel power.
- Publishes the CPU temperature and uptime every minute.
- Turns the panel on and off when the app asks (`pi/screen/set`), and publishes what the panel is doing (`pi/screen/state`). See [Screen power](#screen-power).

The button, the presence sensor and the light sensor come later in Milestone 3 (PRs 3.3 to 3.6). Their config switches are already in the file, but turning one on only logs that it isn't built yet.

The agent only talks to the broker. It holds no state of its own, and the app works the same without it. With the default `black` screen back end it does nothing to the panel at all.

## Install on the Pi

You need the kiosk Pi from [`kiosk/README.md`](../kiosk/README.md) (or any Raspberry Pi OS Bookworm or later), and the Wall Display broker reachable from it. Get this folder onto the Pi, the same way as for the kiosk, then:

```sh
sudo ./wall-display/pi-agent/install.sh
sudo nano /etc/wallcal-agent/config.yaml
sudo systemctl restart wallcal-agent
```

`install.sh`:

1. Installs `python3-venv`, `cec-utils` (for the `cec` screen back end) and `wlopm` (for the `output` one). If `wlopm` isn't available on your release, it warns and carries on: the agent doesn't need it unless you choose `output` with the `wlopm` tool.
2. Creates a `wallcal-agent` system user and group with no login. It is added to the `gpio`, `i2c`, `dialout` and `video` groups where they exist: the first three are for the sensors, and `video` gives access to `/dev/cec*` for the `cec` back end.
3. Installs the agent into a venv at `/opt/wallcal-agent/venv`.
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
| `sensors.button`, `sensors.presence`, `sensors.light` | `false` | Not built yet. |
| `screen.backend` | `black` | How the panel is turned on and off: `black`, `cec` or `output`. See [Screen power](#screen-power). |
| `screen.cec.device` | `0` | The `cec` back end: the CEC logical address to switch, 0 to 15. 0 is the TV. |
| `screen.output.tool` | `wlopm` | The `output` back end: `wlopm` or `wlr-randr`. |
| `screen.output.name` | `HDMI-A-1` | The `output` back end: the output's name, one word such as `HDMI-A-1` or `DP-1`. |
| `screen.output.wayland_display` | `/run/user/1000/wayland-0` | The `output` back end: the kiosk's Wayland socket, as an absolute path. |
| `screen.command_timeout_seconds` | `10` | How long `cec-client`, `wlopm` or `wlr-randr` may take before it is given up on. 1 to 60. |
| `screen.poll_seconds` | `60` | How often the real panel state is read, and published if it changed. `0` never checks; otherwise at least 5. |

The settings for a back end you haven't chosen are still checked, so a mistake in them shows up now and not on the day you switch.

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

It subscribes to one topic, `pi/screen/set` (QoS 1), which the app publishes retained, `on` or `off`. See [Screen power](#screen-power).

The discovery configs go to `<discovery_prefix>/sensor/wallcal_pi_<display id>/<cpu_temperature|uptime>/config` and `<discovery_prefix>/binary_sensor/wallcal_pi_<display id>/panel_power/config`, retained. Home Assistant creates `sensor.wall_calendar_pi_cpu_temperature`, `sensor.wall_calendar_pi_uptime` and `binary_sensor.wall_calendar_pi_panel_power`. All three go unavailable while the agent is offline, and the two sensors also if they stop being reported for three intervals (the panel power doesn't expire, because it only changes when someone asks). When Home Assistant restarts and announces `online` on `<discovery_prefix>/status`, the agent publishes the configs again. See [docs/home-assistant.md](../docs/home-assistant.md).

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

The tests use a fake MQTT client and fake hardware, and a fake command runner for the screen back ends, so nothing runs `cec-client` or `wlopm`. Some of them hold the agent to [`contracts/mqtt.json`](../contracts/mqtt.json), the same file the app's tests use: every topic the agent publishes must be in it, from the Pi, with the same retain flag, and every payload must match its schema, and every `pi/screen/set` example is applied while every invalid one is ignored. A new `pi/` topic in the contract fails a test until the agent handles it, or the test names the PR that will. `tests/test_install.py` runs `install.sh` against a scratch folder, so it needs no root.

To run the agent against a broker on your machine, without any Pi hardware:

```sh
cp config.example.yaml /tmp/wallcal-agent.yaml   # set mqtt.host to localhost
.venv/bin/wallcal-agent --config /tmp/wallcal-agent.yaml --fake-hardware --log-level debug
```

`--fake-hardware` reports made-up readings (the uptime counts up from when the agent started) and uses a pretend panel that starts on and follows `pi/screen/set`, whatever `screen.backend` says. `python -m wallcal_agent` does the same as the `wallcal-agent` command, and `--version` prints the version.

The code is in `src/wallcal_agent/`. The hardware sits behind small interfaces in `hardware/`, with a real Linux implementation and a fake one, so that later sensors can be added the same way. The screen back ends are in `hardware/screen.py`.
