# Pi agent

A small Python service that runs on the Raspberry Pi next to the kiosk and talks to the same MQTT broker as the Wall Display app. It is the Pi's side of the contract in [`contracts/mqtt.json`](../contracts/mqtt.json).

What it does so far:

- Publishes `pi/availability`: `online` while it runs, and `offline` from the broker's last will if it dies, or from the agent itself on a clean stop.
- Publishes Home Assistant discovery configs for a "Wall Calendar Pi" device, with two diagnostic sensors: CPU temperature and uptime.
- Publishes those two values every minute.

The button, the presence sensor, the light sensor and the panel power control come later in Milestone 3 (PRs 3.2 to 3.6). Their config switches are already in the file, but turning one on only logs that it isn't built yet.

The agent only talks to the broker. It holds no state of its own, and the app works the same without it.

## Install on the Pi

You need the kiosk Pi from [`kiosk/README.md`](../kiosk/README.md) (or any Raspberry Pi OS Bookworm or later), and the Wall Display broker reachable from it. Get this folder onto the Pi, the same way as for the kiosk, then:

```sh
sudo ./wall-display/pi-agent/install.sh
sudo nano /etc/wallcal-agent/config.yaml
sudo systemctl restart wallcal-agent
```

`install.sh`:

1. Installs `python3-venv`.
2. Creates a `wallcal-agent` system user and group with no login. It is added to the `gpio`, `i2c` and `dialout` groups where they exist, ready for the sensors.
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

A config that is wrong makes the agent print what is wrong, naming the key (such as `mqtt.port: must be 1 to 65535`), and exit with status 2. systemd then restarts it every 5 seconds until the file is fixed. The password is never logged.

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

The discovery configs go to `<discovery_prefix>/sensor/wallcal_pi_<display id>/<cpu_temperature|uptime>/config`, retained. Home Assistant creates `sensor.wall_calendar_pi_cpu_temperature` and `sensor.wall_calendar_pi_uptime`, and they go unavailable while the agent is offline, or if it stops reporting for three intervals. When Home Assistant restarts and announces `online` on `<discovery_prefix>/status`, the agent publishes the configs again. See [docs/home-assistant.md](../docs/home-assistant.md).

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

The tests use a fake MQTT client and fake hardware. Some of them hold the agent to [`contracts/mqtt.json`](../contracts/mqtt.json), the same file the app's tests use: every topic the agent publishes must be in it, from the Pi, with the same retain flag, and every payload must match its schema. A new `pi/` topic in the contract fails a test until the agent handles it, or the test names the PR that will. `tests/test_install.py` runs `install.sh` against a scratch folder, so it needs no root.

To run the agent against a broker on your machine, without any Pi hardware:

```sh
cp config.example.yaml /tmp/wallcal-agent.yaml   # set mqtt.host to localhost
.venv/bin/wallcal-agent --config /tmp/wallcal-agent.yaml --fake-hardware --log-level debug
```

`--fake-hardware` reports made-up readings (the uptime counts up from when the agent started). `python -m wallcal_agent` does the same as the `wallcal-agent` command, and `--version` prints the version.

The code is in `src/wallcal_agent/`. The hardware sits behind small interfaces in `hardware/`, with a real Linux implementation and a fake one, so that later sensors can be added the same way.
