#!/usr/bin/env bash
# Installs the wall-display kiosk on a Raspberry Pi: auto-login on tty1, labwc (or cage)
# and Chromium in kiosk mode. Run it with sudo on the Pi. See kiosk/README.md.
#
# Hidden test hook (not in --help): --target DIR prefixes every path with DIR and skips
# everything that needs root or a real system (root check, apt, usermod, chown, systemctl).
# The home directory is then always DIR/home/USER.
set -euo pipefail

SRC_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

DEFAULT_COMPOSITOR=labwc
DEFAULT_MODE=2560x1440
HOOK_BEGIN='# >>> wallcal-kiosk >>>'
HOOK_END='# <<< wallcal-kiosk <<<'

URL=''
KIOSK_USER=''
COMPOSITOR=''
MODE=''
TARGET=''
WORK=''

usage() {
  cat <<'EOF'
Usage:
  sudo ./setup.sh --url URL [--user NAME] [--compositor labwc|cage] [--mode WxH[@R]|auto]
  ./setup.sh --help

Options:
  --url URL          Display page to show, e.g. 'http://homeserver:8080/display?id=hallway'.
                     Required on the first run; later runs keep the saved value.
  --user NAME        Account that is logged in on tty1 and runs the kiosk.
                     Default: the user who ran sudo.
  --compositor NAME  labwc (default) or cage.
  --mode MODE        HDMI mode, WIDTHxHEIGHT or WIDTHxHEIGHT@RATE (default 2560x1440),
                     or 'auto' to keep the monitor's preferred mode.

Options left out keep the values saved in /etc/wallcal-kiosk/kiosk.conf.
Quote the URL: it usually contains ? and &.
EOF
}

step() { printf '==> %s\n' "$1"; }
warn() { printf 'setup.sh: warning: %s\n' "$1" >&2; }
fail() { printf 'setup.sh: %s\n' "$1" >&2; exit 1; }
usage_error() {
  printf "setup.sh: %s\nTry './setup.sh --help' for usage.\n" "$1" >&2
  exit 2
}

# True when running against a scratch directory instead of the real system.
in_target() { [[ -n $TARGET ]]; }

# Runs a command that changes the real system; a no-op in --target mode.
run_system() {
  if in_target; then return 0; fi
  "$@"
}

# Maps a system path to where it really goes (the same path, or under --target).
path() { printf '%s%s' "$TARGET" "$1"; }

user_home() {
  if in_target; then
    printf '/home/%s' "$KIOSK_USER"
  else
    getent passwd "$KIOSK_USER" | cut -d: -f6
  fi
}

# Writes stdin to a file with the given mode, creating parent directories.
write_file() { install -D -m "$1" /dev/stdin "$2"; }

parse_args() {
  while (($#)); do
    case $1 in
      -h|--help) usage; exit 0 ;;
      --url|--user|--compositor|--mode|--target)
        (($# >= 2)) || usage_error "$1 needs a value"
        case $1 in
          --url) URL=$2 ;;
          --user) KIOSK_USER=$2 ;;
          --compositor) COMPOSITOR=$2 ;;
          --mode) MODE=$2 ;;
          --target) TARGET=${2%/}
            [[ -n $TARGET ]] || usage_error "--target must not be /" ;;
        esac
        shift 2 ;;
      *) usage_error "unknown option: $1" ;;
    esac
  done
}

# Value saved by a previous run, or nothing. Read in a subshell so it cannot leak variables.
saved_value() {
  local conf
  conf=$(path /etc/wallcal-kiosk/kiosk.conf)
  [[ -r $conf ]] || return 0
  # shellcheck disable=SC1090 # the config only exists at run time
  ( source "$conf" && printf '%s' "${!1:-}" ) || fail "cannot read $conf"
}

# Options left out keep the saved value, then the default.
resolve_settings() {
  : "${URL:=$(saved_value WALLCAL_URL)}"
  : "${COMPOSITOR:=$(saved_value WALLCAL_COMPOSITOR)}"
  : "${COMPOSITOR:=$DEFAULT_COMPOSITOR}"
  : "${MODE:=$(saved_value WALLCAL_MODE)}"
  : "${MODE:=$DEFAULT_MODE}"
  : "${KIOSK_USER:=${SUDO_USER:-}}"
}

validate_settings() {
  local url_re='^https?://[^[:space:][:cntrl:]]+$'
  local mode_re='^[0-9]+x[0-9]+(@[0-9]+(\.[0-9]+)?)?$'
  local user_re='^[a-z_][a-z0-9_-]*$'

  [[ -n $URL ]] || usage_error "--url is required"
  [[ $URL =~ $url_re ]] || usage_error "--url must start with http:// or https:// and contain no spaces"
  [[ $COMPOSITOR == labwc || $COMPOSITOR == cage ]] || usage_error "--compositor must be labwc or cage"
  [[ $MODE == auto || $MODE =~ $mode_re ]] || usage_error "--mode must be auto, WIDTHxHEIGHT or WIDTHxHEIGHT@RATE"
  [[ -n $KIOSK_USER ]] || usage_error "--user is required (SUDO_USER is not set)"
  [[ $KIOSK_USER =~ $user_re ]] || usage_error "--user '$KIOSK_USER' is not a valid account name"
  [[ $KIOSK_USER != root ]] || usage_error "--user must not be root"

  if ! in_target; then
    id -u "$KIOSK_USER" >/dev/null 2>&1 || usage_error "user '$KIOSK_USER' does not exist"
    [[ $(id -u "$KIOSK_USER") -ne 0 ]] || usage_error "--user must not be root"
  fi
}

# Names every missing source file at once so a half-copied checkout is obvious.
check_sources() {
  local f missing=()
  for f in bin/wallcal-kiosk bin/wallcal-kiosk-session chromium-flags.conf chromium-policy.json; do
    [[ -f $SRC_DIR/$f ]] || missing+=("$f")
  done
  ((${#missing[@]} == 0)) || fail "missing ${missing[*]} in $SRC_DIR"
}

preflight() {
  if ! in_target; then
    [[ $EUID -eq 0 ]] || fail "run it with sudo"
    command -v apt-get >/dev/null || fail "apt-get not found; this script is for Raspberry Pi OS"
  fi
  check_sources
}

warn_if_unexpected_system() {
  in_target && return 0
  local codename
  grep -qa 'Raspberry Pi' /proc/device-tree/model 2>/dev/null ||
    warn "this does not look like a Raspberry Pi; carrying on"
  codename=$(sed -n 's/^VERSION_CODENAME=//p' /etc/os-release 2>/dev/null | tr -d '"')
  [[ $codename == bookworm || $codename == trixie ]] ||
    warn "untested OS release '${codename:-unknown}' (expected bookworm or trixie); carrying on"
}

# Raspberry Pi OS Bookworm ships 'chromium-browser'; Debian and newer images use 'chromium'.
chromium_package() {
  local candidate
  candidate=$(apt-cache policy chromium-browser 2>/dev/null | awk '/Candidate:/ {print $2}')
  if [[ -n $candidate && $candidate != '(none)' ]]; then
    echo chromium-browser
  else
    echo chromium
  fi
}

install_packages() {
  step "Installing packages"
  in_target && return 0
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    "$COMPOSITOR" wlr-randr curl fonts-noto-color-emoji "$(chromium_package)"
}

add_user_to_groups() {
  step "Giving $KIOSK_USER access to the GPU and input devices"
  run_system usermod -aG video,render,input "$KIOSK_USER"
}

write_conf() {
  {
    cat <<'EOF'
# Written by wall-display kiosk/setup.sh.
# Edit it, or re-run setup.sh with new options; then reboot or run
# 'sudo systemctl restart getty@tty1' to apply the change.
# WALLCAL_MODE is WIDTHxHEIGHT, WIDTHxHEIGHT@RATE or auto.
EOF
    printf '%s=%q\n' \
      WALLCAL_URL "$URL" \
      WALLCAL_COMPOSITOR "$COMPOSITOR" \
      WALLCAL_MODE "$MODE"
  } | write_file 0644 "$(path /etc/wallcal-kiosk/kiosk.conf)"
}

install_files() {
  step "Installing the launcher, Chromium flags, policy and config"
  local bin etc policy
  bin=$(path /usr/local/bin)
  etc=$(path /etc/wallcal-kiosk)
  install -d -m 0755 "$etc"
  install -D -m 0755 "$SRC_DIR/bin/wallcal-kiosk" "$bin/wallcal-kiosk"
  install -D -m 0755 "$SRC_DIR/bin/wallcal-kiosk-session" "$bin/wallcal-kiosk-session"
  install -D -m 0644 "$SRC_DIR/chromium-flags.conf" "$etc/chromium-flags.conf"
  # Debian's chromium and Raspberry Pi OS's chromium-browser read different directories.
  for policy in /etc/chromium /etc/chromium-browser; do
    install -D -m 0644 "$SRC_DIR/chromium-policy.json" "$(path "$policy")/policies/managed/wallcal-kiosk.json"
  done
  write_conf
}

# The file name sorts after raspi-config's autologin.conf, so this drop-in wins.
write_autologin() {
  step "Setting up console auto-login for $KIOSK_USER on tty1"
  write_file 0644 "$(path /etc/systemd/system/getty@tty1.service.d/wallcal-autologin.conf)" <<EOF
# Written by wall-display kiosk/setup.sh: log $KIOSK_USER in on tty1, where ~/.profile starts the kiosk.
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KIOSK_USER --noclear %I \$TERM
EOF
}

login_hook_block() {
  cat <<EOF
$HOOK_BEGIN
# Added by wall-display kiosk/setup.sh: start the kiosk on the auto-login console.
if [ "\$(tty)" = /dev/tty1 ] && [ -z "\${WAYLAND_DISPLAY:-}" ] && [ ! -e /etc/wallcal-kiosk/disabled ]; then
  exec /usr/local/bin/wallcal-kiosk-session
fi
$HOOK_END
EOF
}

# Bash reads .bash_profile instead of .profile when both exist, so use whichever is live.
login_hook_file() {
  local home
  home=$(path "$(user_home)")
  if [[ -e $home/.bash_profile ]]; then
    printf '%s' "$home/.bash_profile"
  else
    printf '%s' "$home/.profile"
  fi
}

write_login_hook() {
  local file tmp
  file=$(login_hook_file)
  step "Adding the kiosk start-up hook to $file"
  tmp=$WORK/login-hook

  if [[ ! -e $file ]]; then
    install -D -m 0644 /dev/null "$file"
    run_system chown "$KIOSK_USER:" "$file"
  fi
  # Drop any old block, keep everything else, then append a fresh one.
  # No blank separator line: it would pile up on every re-run.
  awk -v b="$HOOK_BEGIN" -v e="$HOOK_END" \
    '$0 == b {skip = 1; next} $0 == e {skip = 0; next} !skip' "$file" >"$tmp"
  login_hook_block >>"$tmp"
  cat "$tmp" >"$file" # not mv: keeps the owner and mode
}

cmdline_file() {
  local c
  for c in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
    if [[ -f $(path "$c") ]]; then
      path "$c"
      return 0
    fi
  done
  return 1
}

# The kernel console blanker is the only idle blanking left: labwc and cage have none.
disable_console_blanking() {
  step "Turning off console blanking"
  local file line word words=() out=() seen=0
  if ! file=$(cmdline_file); then
    warn "no cmdline.txt found; add consoleblank=0 to the kernel command line yourself"
    return 0
  fi
  IFS= read -r line <"$file" || true # the last line may lack a newline
  read -ra words <<<"$line"
  for word in "${words[@]}"; do
    if [[ $word == consoleblank=* ]]; then
      ((seen)) && continue
      word=consoleblank=0
      seen=1
    fi
    out+=("$word")
  done
  ((seen)) || out+=(consoleblank=0)
  echo "${out[*]}" >"$file"
}

set_boot_target() {
  step "Booting to the console, not a desktop"
  run_system systemctl set-default multi-user.target
  run_system systemctl daemon-reload
}

print_summary() {
  cat <<EOF

Kiosk installed.
  User:       $KIOSK_USER
  URL:        $URL
  Compositor: $COMPOSITOR
  Mode:       $MODE

Reboot to start the kiosk: sudo reboot
EOF
}

main() {
  parse_args "$@"
  resolve_settings
  validate_settings
  preflight
  warn_if_unexpected_system

  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"' EXIT

  install_packages
  add_user_to_groups
  install_files
  write_autologin
  write_login_hook
  disable_console_blanking
  set_boot_target
  print_summary
}

main "$@"
