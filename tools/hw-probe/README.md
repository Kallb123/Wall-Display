# hw-probe

`hw-probe` answers the hardware questions from architecture §12 on the real Pi and monitor, without the calendar app. It needs no server, MQTT or config, and nothing from pip: just the Pi's own Python (3.11 on Bookworm) and a few apt packages. Each probe prints a pass/fail summary and adds a section to a markdown report, which you commit as [`docs/hardware-findings.md`](../../docs/hardware-findings.md).

| Command | What it finds out |
|---|---|
| `hw-probe screen` | Whether the monitor can be switched off and on over HDMI-CEC, whether it reports its power state, whether switching the Pi's HDMI output off puts it into standby, how long each takes to wake, and whether DDC/CI brightness works. It ends with the screen back end to use as the Pi agent's default. |
| `hw-probe render` | How smoothly Chromium draws a dense month grid and a crossfading photo pair at 2560×1440 with the kiosk's own flags, how much memory it uses, and whether the Organic fonts and OKLCH `color-mix()` colours render. Run it on a Pi 4 and a Pi 5 to compare them. |

## Getting it onto the Pi

Clone the repo on the Pi:

```sh
git clone --depth 1 https://github.com/kallb123/wall-display.git
cd wall-display/tools/hw-probe
```

or copy the folder from your computer. Bring `kiosk/chromium-flags.conf` too if the kiosk isn't installed, so `render` can use the kiosk's flags:

```sh
ssh <username>@wallcal-pi.local mkdir -p wall-display/tools wall-display/kiosk
scp -r tools/hw-probe <username>@wallcal-pi.local:wall-display/tools/
scp kiosk/chromium-flags.conf <username>@wallcal-pi.local:wall-display/kiosk/
```

Install what the probes drive. Raspberry Pi OS Bookworm calls Chromium `chromium-browser`, and newer images call it `chromium`:

```sh
sudo apt install cec-utils ddcutil wlr-randr wlopm labwc chromium-browser
```

Then give your user access to the CEC and I²C devices, and log out and back in:

```sh
sudo usermod -aG video,i2c "$USER"
```

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

## The report

Each run adds a section at the end of `hardware-findings.md` in the current folder (change it with `--report PATH`, or leave it out with `--no-report`). A section holds the Pi's model, OS, kernel and memory, then each check and its result, then any tables. Copy the file to `docs/hardware-findings.md` in the repo and commit it. Or, from a clone on the Pi, write to it directly:

```sh
./hw-probe screen --report ../../docs/hardware-findings.md
```

The exit status is 0 when no check failed, 1 when one did, 2 for a bad option, and 130 when stopped with Ctrl-C (which writes no report).

## Development

The probes use only the standard library. The tests need pytest, and lint uses Ruff (the version pinned in CI):

```sh
cd tools/hw-probe
pip install pytest ruff==0.17.3
ruff check . && ruff format --check .
pytest
```

The tests fake every command, so they run anywhere. One test opens the benchmark page in headless Chromium and checks what it posts back. It looks for a browser in `$HW_PROBE_TEST_CHROMIUM`, Playwright's download folder, `google-chrome` or `chromium`, and is skipped if none is found.

The fonts in `hw_probe/render/fonts/` are the Latin subsets from `@fontsource/caprasimo` and `@fontsource/figtree` (the packages the app bundles), under the SIL Open Font License (`OFL-*.txt` beside them). The page's colours are copied from `calendar-app/app/assets/tokens.css` and the light theme in `calendar-app/app/utils/themes.ts`. If those change, update the page too.
