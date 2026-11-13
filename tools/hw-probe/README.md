# hw-probe

`hw-probe` answers the hardware questions from architecture §12 on the real Pi and monitor, without the calendar app. It needs no server, MQTT or config, and nothing from pip: just the Pi's own Python (3.11 on Bookworm) and a few apt packages. The sensor probes (`button`, `mmwave` and `light`) run the Pi agent's own sensor code from [`pi-agent/src`](../../pi-agent/src), so the timings and thresholds you choose with them behave exactly as they will in the agent. Each probe prints a pass/fail summary and adds a section to a markdown report, which you commit as [`docs/hardware-findings.md`](../../docs/hardware-findings.md).

| Command | What it finds out |
|---|---|
| `hw-probe screen` | Whether the monitor can be switched off and on over HDMI-CEC, whether it reports its power state, whether switching the Pi's HDMI output off puts it into standby, how long each takes to wake, and whether DDC/CI brightness works. It ends with the screen back end to use as the Pi agent's default. |
| `hw-probe render` | How smoothly Chromium draws a dense month grid and a crossfading photo pair at 2560×1440 with the kiosk's own flags, how much memory it uses, and whether the Organic fonts and OKLCH `color-mix()` colours render. Run it on a Pi 4 and a Pi 5 to compare them. |
| `hw-probe button` | Whether the push button on GPIO17 reads single, double and long presses as you mean them, with live output as you press. It measures contact bounce, press lengths and double-press gaps, and suggests the agent's button timings. |
| `hw-probe mmwave` | What the LD2410 presence sensor's OUT pin says as you leave, walk in, sit still and leave again, and with `--uart` the energy in each of its distance gates. It shows noisy gates and the useful range for placing and tuning the sensor, and suggests the agent's `presence.hold_ms`. |
| `hw-probe light` | The VEML7700 or BH1750's lux readings: its noise, whether it responds to light, the levels in your room by day, evening and night, and how many readings the agent would publish. It suggests a darkness threshold for auto brightness, and can log readings over a whole night to a CSV file. |

## Getting it onto the Pi

Clone the repo on the Pi:

```sh
git clone --depth 1 https://github.com/kallb123/wall-display.git
cd wall-display/tools/hw-probe
```

or copy the folder from your computer. The sensor probes also need `pi-agent/src`, so copy that too if you don't clone (keep the layout: `wall-display/tools/hw-probe` and `wall-display/pi-agent/src`). Bring `kiosk/chromium-flags.conf` too if the kiosk isn't installed, so `render` can use the kiosk's flags:

```sh
ssh <username>@wallcal-pi.local mkdir -p wall-display/tools wall-display/kiosk
scp -r tools/hw-probe <username>@wallcal-pi.local:wall-display/tools/
scp kiosk/chromium-flags.conf <username>@wallcal-pi.local:wall-display/kiosk/
ssh <username>@wallcal-pi.local mkdir -p wall-display/pi-agent
scp -r pi-agent/src <username>@wallcal-pi.local:wall-display/pi-agent/
```

Install what the probes drive. Raspberry Pi OS Bookworm calls Chromium `chromium-browser`, and newer images call it `chromium`:

```sh
sudo apt install cec-utils ddcutil wlr-randr wlopm labwc chromium-browser
```

The sensor probes use the same Python libraries as the Pi agent, from apt rather than pip:

```sh
sudo apt install python3-gpiozero python3-lgpio python3-serial python3-smbus2
```

Then give your user access to the CEC, I²C, GPIO and serial devices, and log out and back in:

```sh
sudo usermod -aG video,i2c,gpio,dialout "$USER"
```

If the Pi agent is installed and running, stop it before a sensor probe (`sudo systemctl stop wallcal-agent`): it holds the button's and the presence sensor's pins and the serial port while it runs. Start it again afterwards.

DDC/CI needs the `i2c-dev` module. If `screen` says there are no `/dev/i2c-*` devices, run `sudo modprobe i2c-dev` and add a line `i2c-dev` to `/etc/modules-load.d/i2c-dev.conf` to keep it after a reboot.

Run the probes as yourself, not with `sudo`: the HDMI output steps and `render` need your own Wayland session, which `root` can't see.

## Screen probe

```sh
./hw-probe screen
```

Sit where you can see the monitor. The probe sends a command, then asks what happened ("Did the monitor go to standby? [y/n]"). When it wakes the screen it says "Press Enter when the picture is back" and times how long you take, so press Enter as soon as you see the picture. It puts everything back as it found it, even if you press Ctrl-C part way: the monitor is woken, the output switched back on and the brightness restored.

It has three parts:

- **CEC**: finds the CEC adapter (`cec-client -l`) and scans the bus for the monitor. It asks for its power state, sends `standby`, then `on` and `as` (which makes the Pi the active source so the monitor switches back to its input). It also checks whether the power state the monitor reports follows what it really did.
- **HDMI output**: switches the Pi's HDMI output off in the compositor (`wlopm`, or `wlr-randr`). It waits `--off-seconds` and asks whether the monitor went into standby by itself rather than just showing "no signal". Then it switches the output back on and times the picture's return. This part needs a Wayland compositor running as your user. On a kiosk Pi, SSH in as the kiosk user while the kiosk is up.
- **DDC/CI**: finds the monitor with `ddcutil detect`, reads the brightness (VCP code 0x10), moves it by 30, reads it back, asks whether the picture changed, then restores it.

Without a person at the screen (`--no-prompt`, or input that isn't a terminal) the steps that need someone watching are skipped.

| Option | Meaning |
|---|---|
| `--only LIST`, `--skip LIST` | Run only, or leave out, some of `cec`, `output` and `ddc` (comma-separated). |
| `--cec-device N` | The monitor's CEC logical address. Default 0, the TV. |
| `--cec-port PATH` | The CEC adapter, such as `/dev/cec1`. The Pi 4 and 5 have one per HDMI port. Default: `cec-client`'s first. |
| `--output NAME` | The Wayland output to switch, such as `HDMI-A-1`. Default: the first enabled one. |
| `--wayland-display PATH` | The compositor's socket, such as `/run/user/1000/wayland-0`. Default: `$WAYLAND_DISPLAY`, then the first socket in `/run/user/<your uid>`. |
| `--off-seconds N` | How long the output stays off before the standby question. Default 15. |
| `--wake-timeout N` | How long to wait for the picture to come back. Default 60. |

The last line, `Recommended back end`, is the Pi agent's `screen.backend` to use (see [pi-agent/README.md](../../pi-agent/README.md)):

- `cec` if CEC standby and wake both worked.
- Otherwise `output` if switching the HDMI output off put the monitor into standby and it came back.
- Otherwise `black`, which always works.

If DDC/CI brightness works, so does the backlog's DDC/CI backlight item.

## Render probe

```sh
./hw-probe render
```

It serves a static benchmark page from this folder on `127.0.0.1` and opens it in Chromium with exactly the kiosk's flags. The flags come from `--flags`, else the installed `/etc/wallcal-kiosk/chromium-flags.conf` (plus your `.local.conf`), else the repo's `kiosk/chromium-flags.conf`. It also uses a throwaway profile. The page has a 2560×1440 stage, scaled to fit the screen like the display page. It:

1. Loads the bundled Caprasimo and Figtree fonts and checks that each one loaded.
2. Draws an OKLCH colour and a `color-mix(in oklch, …)` onto a canvas and checks the pixels. An sRGB mix would give a different grey, so this proves the mix happens in OKLCH.
3. Reads which GPU WebGL is using.
4. Draws four photo-like 2560×1440 JPEGs, or uses yours with `--photos DIR`.
5. Shows a dense October 2026 month in the Soft style for `--month-seconds`: side panel, ticking clock, 35 tiles of bars and timed rows, colour mixes, soft shadows and a veil.
6. Runs the photo frame for `--seconds`, as the app's photo view does: the next photo is decoded off screen, then faded in over the old one, with the slow drift on.

Throughout, it counts the frame time of every `requestAnimationFrame` and works out how many frames were dropped. While it runs, `hw-probe` samples the memory (PSS) of every Chromium process it started. The whole run takes about a minute and a half with the defaults.

For a clean baseline, nothing else should be drawing. On a kiosk Pi, switch the kiosk off and log in on the Pi's own keyboard:

```sh
sudo touch /etc/wallcal-kiosk/disabled
sudo systemctl restart getty@tty1
# then, on the Pi's console:
cd wall-display/tools/hw-probe && ./hw-probe render
```

With no compositor running, `render` starts its own: `cage` if it is installed, otherwise `labwc`. A compositor can only start from the Pi's console, not over SSH. Afterwards, bring the kiosk back with `sudo rm /etc/wallcal-kiosk/disabled && sudo systemctl restart getty@tty1`.

You can also run it over SSH as the kiosk user while the kiosk is up: it then opens in the kiosk's compositor. The kiosk's own Chromium keeps running alongside it, though, and the report says so (`Other Chromium`), so treat those numbers as worse than a clean run.

Use the same `--mode` on both Pis (the kiosk's `setup.sh` option, which the probe leaves alone), and run each one a few times: the first run after a boot is often slower.

| Option | Meaning |
|---|---|
| `--seconds N` | How long to measure the photo frame. Default 60. |
| `--month-seconds N` | How long to measure the month grid. Default 20. |
| `--warmup N` | Warm-up before measuring, also used to find the refresh rate. Default 5. |
| `--fade-seconds X` | The crossfade's length. Default 1.5, as in the app. |
| `--photo-interval N` | Seconds between photos. Default 6. |
| `--no-drift` | Turn off the slow pan and zoom on the photos (the display's `motion` setting). |
| `--photos DIR` | Use the `.jpg`, `.jpeg`, `.png` and `.webp` files in DIR (at least two) instead of the drawn ones. Use 2560×1440 photos to match what the server sends. |
| `--browser PATH` | The Chromium to run. Default: `chromium`, then `chromium-browser`. |
| `--flags FILE` | The Chromium flags file. Default: the kiosk's, as above. |
| `--compositor auto\|existing\|cage\|labwc` | `existing` uses a running compositor only. `cage` and `labwc` always start that one. `auto` (the default) uses a running one if there is one, otherwise starts one. |
| `--wayland-display PATH` | The running compositor's socket. Default: as for `screen`. |
| `--no-launch` | Don't start Chromium: print the page's URL and wait for any browser to run it. Handy for trying the page on a laptop. |

### Reading the results

- **GPU**: this should name the Pi's GPU (`V3D …`). SwiftShader or llvmpipe means Chromium is drawing in software and every other number will be poor.
- **Frame times**: one row each for the month grid, the photo frame between fades, and the crossfades themselves. A frame is dropped for each refresh that a frame time spans beyond the first, so at 60 Hz a 50 ms frame counts as two dropped. "% of refreshes" is the share of the screen's refreshes in that phase that showed no new frame.
- **Pass or fail**: the month grid passes with at most 1% of refreshes dropped, and the crossfades with at most 2%. These are rough lines for "smooth enough", not specs: the numbers are what matter when you compare the Pi 4 and the Pi 5. PR 4.2's check of the real photo frame is made against the crossfade row (see [kiosk/README.md](../../kiosk/README.md#checking-photo-frame-performance-on-the-pi)).
- **Memory**: the peak and final PSS of each kind of Chromium process (browser, GPU, renderer and so on), the page's JavaScript heap, and the lowest `MemAvailable` during the run. The CPU temperature before and after, and `vcgencmd get_throttled`, show whether the Pi slowed itself down to keep cool.

## Button probe

```sh
./hw-probe button
```

Run it on the Pi with the button wired between GPIO17 and ground. It runs the Pi agent's own code (its GPIO input and its gesture detector, from `pi-agent/src` in this repo), so the timings that feel right here are the timings the agent will use. Stop the agent first (`sudo systemctl stop wallcal-agent`), because it holds the button's pin while it runs. It needs the GPIO libraries from apt: `sudo apt install python3-gpiozero python3-lgpio`, and your user in the `gpio` group.

It does three things:

1. **Opens the pin** like the agent does (internal pull-up, so a press reads low). If that fails, the check says why, and gives the `apt` line when a library is missing.
2. **Guided steps**: it asks you to press once, double-press, and press and hold, waiting up to `--step-timeout` for each. A step passes if exactly the expected gesture came. If it did not, the detail says what came instead, with how long each press was held and the gap between them, which usually shows which timing to change. A step where nothing happens is skipped.
3. **Free watch**: for `--seconds`, or until you press Enter, press the button however you like. Every confirmed press (`down 112 ms`) and every gesture (`-> double`) is printed as it happens.

With no one at the terminal (`--no-prompt`, or input that isn't a terminal) the guided steps are skipped and only the free watch runs, so `--no-prompt --seconds 120` records whatever the button gets in two minutes.

| Option | Meaning |
|---|---|
| `--pin N` | The BCM GPIO number. Default 17. |
| `--bounce-ms MS` | The debounce time to run the detector with. Default 30. |
| `--double-ms MS` | The longest gap that still makes a double press. Default 400. |
| `--long-ms MS` | How long a press is held to count as long. Default 1000. |
| `--seconds N` | How long the free watch lasts. Default 60. 0 skips it. |
| `--step-timeout N` | How long to wait for each guided press. Default 15. |

The three timing options take the agent's own defaults and accept the ranges its config accepts (bounce 0 to 200, double 100 to 2000, long 300 to 10000). Try a setting by passing it here, for example `./hw-probe button --double-ms 600`, and see whether your presses are read as you meant them.

### Reading the results

All the edges from the guided steps and the free watch are analysed together, whatever settings were in use, so one run can tune all three timings. Two tables are printed (and written to the report):

- **Presses**: how many short presses, holds (presses of 0.6 s or more), gaps between presses (under 1 s) and bounces (a level shorter than 50 ms) were seen, with the shortest, median and longest of each.
- **Timings**: for each setting, the value used and a suggestion.
  - `bounce_ms`: twice the longest bounce seen, rounded up to 10 ms, and at least 10. A clean button gets 10. Needs at least three presses.
  - `double_press_ms`: one and a half times the longest gap between two presses that were meant as a double, rounded up to 50 ms. A longer window makes every single press wait that much longer before it is reported, so make the double presses you want to allow, and no slower.
  - `long_press_ms`: halfway between twice the longest short press and the shortest hold, so an ordinary press is never long. Needs short presses and at least one hold.

Where there is not enough to go on the table says so ("not enough presses", "no double presses recorded") instead of guessing. Do a few of each kind of press and run it again.

A note gives the block to use, with the settings that could not be suggested left as they were used. Put it in the Pi agent's `/etc/wallcal-agent/config.yaml` and restart the agent:

```yaml
button:
  pin: 17
  bounce_ms: 10
  double_press_ms: 300
  long_press_ms: 850
```

If the free watch shows no presses at all, the wiring is the first thing to check: the button goes between the GPIO and ground, with nothing else on the pin.

## mmWave probe

```sh
./hw-probe mmwave
./hw-probe mmwave --uart
```

Wire the LD2410's OUT pin to GPIO27 (physical pin 13) and read it as the agent does. For `--uart`, also connect the sensor's TX to GPIO15 (pin 10) and its RX to GPIO14 (pin 8), and in `sudo raspi-config` (Interface Options, Serial Port) turn the serial port on but the login console off. Stop the Pi agent first if it is running: it holds the same pin and port. Your user needs to be in the `gpio` group, and in `dialout` for the serial port. The probe reuses the agent's own code (`GpioPresence`, the LD2410 parser and `PresenceFilter` from `pi-agent/src`), so what it measures is what the agent will see.

Steps (each `--step-seconds` long, after you press Enter; skipped when no one is at the terminal):

1. **Empty room**: leave the sensor's view. Passes if the sensor read "nobody" for the second half of the step.
2. **Walking**: walk towards the display. Passes if the sensor saw you, and says how many seconds that took.
3. **Still**: sit or stand where you usually would. Passes if the sensor kept seeing you; otherwise it counts the dropouts and the longest one.
4. **Clear time**: leave again and press Enter as you go. Reports how long the sensor took to say "nobody" (compare it with the sensor's own no-one time).

Then a free watch runs until you press Enter or `--seconds` pass. It prints every change of the OUT pin with its time and, with `--uart`, one line a second with the moving and still targets (distance and energy).

With `--uart` the probe first waits for frames, then reads the sensor's firmware and settings and switches engineering mode on (that is what makes the sensor send the energy of every gate). While the sensor is in configuration mode it stops sending reports, which is expected. When the probe ends, even on Ctrl-C, it switches engineering mode off and leaves configuration mode again. It never changes the sensor's range or sensitivities. If engineering mode will not switch on, the probe carries on with basic frames, without the gate table.

| Option | Meaning |
|---|---|
| `--pin N` | BCM GPIO of the OUT pin. Default 27. |
| `--no-pin` | The OUT pin is not wired: use the serial frames for presence (needs `--uart`). |
| `--uart` | Also read the serial frames, for the gate energies. |
| `--device PATH` | The serial port. Default `/dev/serial0`. |
| `--baud N` | The serial speed, one of the agent's allowed rates. Default 256000. |
| `--hold-ms N` | The agent's `presence.hold_ms`, which flickers are counted against. Default 500. |
| `--step-seconds N` | How long each guided step lasts. Default 20. |
| `--seconds N` | How long the free watch lasts. Default 120. |

**Reading the results.** A flicker is a reading that flipped back sooner than `--hold-ms`: the agent's presence filter drops those, and the summary says how many confirmed changes the agent would have seen. If the Still step had dropouts longer than the hold, a note suggests a larger `presence.hold_ms`; put it in the agent's `/etc/wallcal-agent/config.yaml`:

```yaml
presence:
  hold_ms: 1500
```

A longer hold hides dropouts but delays turning the screen on and off by as much.

The **Gate energies** table (with `--uart`) has one row per distance gate, each 0.75 m deep at the sensor's factory resolution: the distance it covers, the moving and still thresholds the sensor is set to (the energy, 0 to 100, a gate must reach to count), and the highest energy seen in the empty room (moving / still), while walking (moving) and while sitting still (still). Read it like this:

- A gate whose empty-room energy reached its threshold is a noise source (a fan, a curtain, a reflection). The notes list them: raise that gate's threshold, or lower the maximum gate if it is farther than anyone needs to be seen.
- The notes also give the farthest gate where you were seen. If you were seen far beyond where people will be, lower the maximum gate; if the energy while walking or sitting stays below the thresholds, lower them for the gates where you were, or move the sensor nearer.

The sensor is tuned in the maker's HLKRadarTool app (over Bluetooth or a USB-serial adapter), not by this probe or the agent. Change a setting there, then run the probe again to see the effect.

## Light probe

```sh
./hw-probe light
```

Reads the light sensor (a VEML7700 or a BH1750) with the Pi agent's own sensor code, and asks the agent's own reporter which readings it would publish, so the settings you choose here behave the same in the agent. It finds the sensor, reads it at a steady interval, and tells you how noisy it is, whether it sees light at all, and where the line between "dark" and "evening" falls in your room.

**Before you start.** Switch I²C on (`sudo raspi-config`, Interface Options, I2C, then reboot) and wire the sensor: VIN to 3.3 V (pin 1), GND to GND (pin 6), SDA to GPIO2 (pin 3), SCL to GPIO3 (pin 5). `i2cdetect -y 1` (from the `i2c-tools` package) should show `10` for a VEML7700, or `23` (`5c` with the ADDR pin high) for a BH1750. You need the `smbus2` library (`sudo apt install python3-smbus2`) and to be in the `i2c` group. If something is missing, the probe says so and gives the command. Like the other sensor probes it needs the repo's `pi-agent/src` next to `tools/hw-probe`.

The steps:

1. **Sensor.** `/dev/i2c-<bus>` must exist. With `--chip auto` the probe tries the VEML7700 at 0x10, then the BH1750 at 0x23 and 0x5c, and the first that answers wins ("VEML7700 at 0x10 on bus 1, 143.2 lx"). If none does, it fails and lists each error.
2. **Noise.** Ten readings in steady light: their median and how far they spread.
3. **Guided steps** (only with someone at the terminal; otherwise they are skipped). Each one asks you to set the room up, waits for Enter, and reads for `--step-seconds`. In order: leave the room as it is (the baseline), cover the sensor with a finger, the lights as they are in the evening, the room dark as at night, and the room as bright as it gets. Covering the sensor passes "Responds to light" when the reading falls below half the baseline, or below 1 lx.
4. **Free watch.** Reads until you press Enter or `--seconds` have passed. With someone at the terminal every reading is printed, with "published" beside the ones the agent would send. Without anyone, only the published ones are printed (a day-long log would otherwise be a line a second).

Waving a hand over the sensor, switching a lamp, or opening the curtains during the free watch shows how the agent's change settings react.

| Option | Meaning |
|---|---|
| `--chip auto\|veml7700\|bh1750` | The chip. Default `auto`. |
| `--bus N` | The I²C bus, `/dev/i2c-N`. Default 1, the one on pins 3 and 5. |
| `--address ADDR` | The chip's address, such as `0x23`. Default: the chip's own (`auto` tries all of them). |
| `--interval-ms N` | Time between readings. Default 1000, the agent's `sample_ms`. |
| `--seconds N` | How long the free watch lasts. Default 60. |
| `--step-seconds N` | How long each guided step reads for. Default 5. |
| `--change-percent N`, `--change-lux N`, `--report-seconds N` | The agent's `light.change_percent`, `change_lux` and `report_seconds`, to count what it would publish. Defaults 10, 0.5 and 30. |
| `--csv PATH` | Adds every reading to this file as `iso_time,seconds,lux` (the header is written once, when the file is new). |

For a night's log, leave it running with nobody at the terminal:

```sh
./hw-probe light --no-prompt --seconds 43200 --csv night.csv --no-report
```

That is twelve hours of readings every second, saved as they are taken, so the file is there even if the run is cut short. Plot it, or look at the minimum and maximum: the darkest the room gets at night, and when the morning light arrives.

**Reading the results.**

- `Noise` is how much the sensor varies in steady light. The agent's `change_lux` should be clear of it (twice the spread or more); the probe notes a larger value if the one used is too small, so flicker in a dark room isn't sent as a change.
- `Would publish` is how many of the watch's readings the agent would send with your change settings. Most of them being published means the settings are passing noise on: raise `change_percent` or `change_lux`. A steady room should publish little more than the heartbeat (`report_seconds`).
- `Light levels` gives the readings, minimum, median and maximum for each guided condition and for the watch.
- `Darkness threshold` appears when both the dark and evening steps were measured. It is the geometric mean of their medians (the app reads lux on a log scale, as the eye does), rounded to a figure you would write in a config. A pitch-black room reads 0 lx, which the probe counts as 0.1.
- `Responds to light` failing means covering the sensor changed nothing: check the wiring, and that the sensor faces the room rather than the wall.

**Where the settings go.**

- On the Pi, the sensor and the change settings belong in `/etc/wallcal-agent/config.yaml`, under `light:`. The probe prints the block to copy, with the chip, bus, address, your interval as `sample_ms` (the agent reads no faster than every 200 ms) and the change settings. The `chip`, `bus` and `address` keys, the sensor's own, are in [pi-agent/config.example.yaml](../../pi-agent/config.example.yaml), and `sensors.light: true` turns it on.
- The darkness threshold goes in the app's `config.yaml` as `policies.auto_brightness.night_below_lux` (see [config.example.yaml](../../config.example.yaml)). Below it the room counts as dark and `night_action` applies. If you also set `night_above_lux` (where the room counts as light again), it must be above `night_below_lux`; left out, it is twice that. The `curve` in the same block is separate: it maps lux to brightness. The levels you measured for evening and bright light are a good guide for its points.

## The report

Each run adds a section at the end of `hardware-findings.md` in the current folder (change it with `--report PATH`, or leave it out with `--no-report`). A section holds the Pi's model, OS, kernel and memory, then each check and its result, then any tables. Copy the file to `docs/hardware-findings.md` in the repo and commit it. Or, from a clone on the Pi, write to it directly:

```sh
./hw-probe screen --report ../../docs/hardware-findings.md
```

The sensor probes' suggested settings are notes at the end of their sections, so they land in the report too.

The exit status is 0 when no check failed, 1 when one did, 2 for a bad option, and 130 when stopped with Ctrl-C (which writes no report).

## Development

The screen and render probes use only the standard library. The sensor probes import the Pi agent's code from `../../pi-agent/src` (see `hw_probe/agent_code.py`), which loads its hardware libraries only when a sensor is opened. The tests need pytest, PyYAML (to check that the probes' default timings match the agent's config defaults) and gpiozero (one button test drives gpiozero's mock pins through the agent's real GPIO code). Lint uses Ruff (the version pinned in CI):

```sh
cd tools/hw-probe
pip install pytest ruff==0.17.3 pyyaml gpiozero
ruff check . && ruff format --check .
pytest
```

The tests fake every command, GPIO pin, serial port and light sensor, so they run anywhere. One test opens the benchmark page in headless Chromium and checks what it posts back. It looks for a browser in `$HW_PROBE_TEST_CHROMIUM`, Playwright's download folder, `google-chrome` or `chromium`, and is skipped if none is found.

The fonts in `hw_probe/render/fonts/` are the Latin subsets from `@fontsource/caprasimo` and `@fontsource/figtree` (the packages the app bundles), under the SIL Open Font License (`OFL-*.txt` beside them). The page's colours are copied from `calendar-app/app/assets/tokens.css` and the light theme in `calendar-app/app/utils/themes.ts`. If those change, update the page too.
