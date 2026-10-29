# Raspberry Pi kiosk

This folder turns a Raspberry Pi running Raspberry Pi OS Lite into a wall display. The Pi only shows the `/display` page from the Wall Display server. It holds no secrets and no config beyond the display URL, so you can reflash it at any time.

`setup.sh` installs a Wayland compositor (`labwc` by default), Chromium and a few small scripts. At boot:

1. The Pi logs the kiosk user in on the console (`tty1`) without a password.
2. The login hook in the user's `~/.profile` starts `wallcal-kiosk-session`.
3. That starts `labwc`, which starts `wallcal-kiosk`.
4. `wallcal-kiosk` waits until the server answers, then starts Chromium in `--kiosk` mode on the display URL. If Chromium exits, it starts it again.

If `labwc` exits, the login ends and `getty` logs the user in again, which starts the kiosk again.

## Reflashing a Pi

You need a Pi 4 or 5, a microSD card, an HDMI display and the Wall Display server running (see the root [README](../README.md)).

1. Open Raspberry Pi Imager and choose your Pi model.
2. Choose **Raspberry Pi OS Lite (64-bit)**, Bookworm or later. It is under "Raspberry Pi OS (other)".
3. Choose the SD card, then edit the OS customisation settings:
   - Hostname, for example `wallcal-pi`.
   - Username and password.
   - Wi-Fi, if you are not using Ethernet.
   - Locale and time zone.
   - Under Services, enable SSH and paste your public key.
4. Write the card, put it in the Pi and power it on. The first boot takes a few minutes.
5. Log in from your computer and update the Pi:

   ```sh
   ssh <username>@wallcal-pi.local
   sudo apt update && sudo apt full-upgrade -y
   ```

6. Get this folder onto the Pi. Either clone the repo:

   ```sh
   git clone --depth 1 https://github.com/kallb123/wall-display.git
   ```

   or copy just this folder from your computer, from the repo root:

   ```sh
   ssh <username>@wallcal-pi.local mkdir -p wall-display
   scp -r kiosk <username>@wallcal-pi.local:wall-display/
   ```

7. Run the setup script with your display URL. Keep the quotes: the `?` and any `&` in the URL mean something to the shell.

   ```sh
   sudo ./wall-display/kiosk/setup.sh --url 'http://<server>:8080/display?id=hallway'
   ```

8. Reboot. The display should appear within a minute.

   ```sh
   sudo reboot
   ```

Use the server's name or IP address for `<server>` and the display's `id` from your config. The server must be reachable from the Pi.

## Options

```sh
sudo ./setup.sh --url URL [--user NAME] [--compositor labwc|cage] [--mode WxH[@R]|auto]
```

| Option | Meaning |
|---|---|
| `--url URL` | The display URL. It must start with `http://` or `https://`. Required the first time. |
| `--user NAME` | The user who is logged in and runs the kiosk. Default: the user who ran `sudo`. It can't be `root`. |
| `--compositor labwc\|cage` | Default `labwc`. `cage` is a fallback if `labwc` gives you trouble. |
| `--mode WxH[@R]\|auto` | The HDMI mode to ask for, such as `2560x1440` or `2560x1440@60`. `auto` keeps the monitor's preferred mode. Default `2560x1440`. |

The display page is a 2560×1440 stage that scales to fit. On a 4K panel, asking for 1440p keeps Chromium responsive on the Pi and the monitor scales it up.

`./setup.sh --help` prints the usage. A bad option or value stops the script with exit status 2 before it changes anything.

## Changing settings later

Run `setup.sh` again with only the option you want to change. Options you leave out keep their current values. Re-running is safe: with the same options it rewrites the same files.

```sh
sudo ./wall-display/kiosk/setup.sh --mode auto
```

You can also edit `/etc/wallcal-kiosk/kiosk.conf`, which has three keys: `WALLCAL_URL`, `WALLCAL_COMPOSITOR` and `WALLCAL_MODE`. Either way, apply the change with `sudo reboot` or `sudo systemctl restart getty@tty1`.

## Extra Chromium flags

The flags are in `/etc/wallcal-kiosk/chromium-flags.conf`, one per line, with `#` comment lines. `setup.sh` replaces that file every time it runs, so put your own flags in `/etc/wallcal-kiosk/chromium-flags.local.conf` instead. It uses the same format, is read after the main file and is never touched by `setup.sh`.

Chromium only honours the last `--enable-features` and the last `--disable-features` it is given. Each may appear once across both files, so to add a feature, edit the existing line in the main file or move that flag into the local file.

## Getting a console

The kiosk takes over `tty1`. SSH always works. To get a normal shell on the Pi's own keyboard instead:

```sh
sudo touch /etc/wallcal-kiosk/disabled
sudo systemctl restart getty@tty1
```

Delete that file and restart `getty@tty1` again to bring the kiosk back.

## Logs

| Log | Where |
|---|---|
| Launcher messages | `journalctl -t wallcal-kiosk` |
| Compositor | `~/.local/state/wallcal-kiosk/session.log` |
| Chromium | `~/.local/state/wallcal-kiosk/chromium.log` |

`~` is the kiosk user's home folder. Each file keeps the previous run's log as `session.log.1` and `chromium.log.1`.

## What setup.sh changes

| Path | What |
|---|---|
| `/etc/wallcal-kiosk/kiosk.conf` | The URL, compositor and mode. Rewritten each run. |
| `/etc/wallcal-kiosk/chromium-flags.conf` | The Chromium flags. Replaced each run. |
| `/etc/wallcal-kiosk/chromium-flags.local.conf` | Your extra flags. Never touched. |
| `/etc/wallcal-kiosk/disabled` | If it exists, `tty1` gives a normal shell. Never touched. |
| `/usr/local/bin/wallcal-kiosk` | The Chromium launcher and restart loop. |
| `/usr/local/bin/wallcal-kiosk-session` | Starts the compositor. |
| `/etc/chromium/policies/managed/wallcal-kiosk.json` and `/etc/chromium-browser/policies/managed/wallcal-kiosk.json` | Chromium policy that switches off translate, sign-in, password and similar prompts. Both paths, because Debian's `chromium` and Raspberry Pi OS's `chromium-browser` read different ones. |
| `/etc/systemd/system/getty@tty1.service.d/wallcal-autologin.conf` | Console auto-login. |
| `~/.profile`, or `~/.bash_profile` if it exists | A block between `# >>> wallcal-kiosk >>>` and `# <<< wallcal-kiosk <<<` that starts the kiosk on `tty1`. The rest of the file is left alone. |
| `/boot/firmware/cmdline.txt` (or `/boot/cmdline.txt`) | Adds `consoleblank=0`, which turns off the console screen blanker. |

It also installs the compositor, `wlr-randr`, `curl`, `fonts-noto-color-emoji` (Lite has no emoji font) and Chromium with `apt`, adds the user to the `video`, `render` and `input` groups, and sets the default boot target to `multi-user.target`.

## Troubleshooting

**Black screen.** The server is probably not reachable from the Pi. The launcher waits for it before starting Chromium and logs the failure, so check `journalctl -t wallcal-kiosk`. Try `curl -I 'http://<server>:8080/display'` from an SSH session. Once the page has loaded, the display shows an "Offline" badge if the connection drops later and keeps the last state it had.

**Wrong resolution.** Check `--mode`. Try `--mode auto` to use the monitor's preferred mode, or ask for a mode your monitor supports. The launcher sets the mode once, when it starts, and carries on if the monitor refuses it (the log says so).

**A mouse cursor shows.** The display page hides the cursor. If you see one, it is the compositor's, and only while a mouse is plugged in.

**Why `labwc`?** It is what Raspberry Pi OS itself uses, and `wlr-randr` works with it, which the launcher uses to set the mode and which later screen-off control will need. `cage` is a fallback.

**Anything else odd.** Look at `session.log` and `chromium.log`. If you can't find it, reflash. There is nothing on the Pi to lose.
