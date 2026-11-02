#!/usr/bin/env bash
# Installs the Wall Calendar Pi agent on a Raspberry Pi: a system user, a Python venv,
# a config file and a systemd service. Run it with sudo on the Pi. See pi-agent/README.md.
#
# Hidden test hook (not in --help): --target DIR prefixes every path with DIR and skips
# everything that needs root or a real system (root check, apt, useradd, usermod, chown,
# the venv and pip, systemctl).
set -euo pipefail

SRC_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

SERVICE_USER=wallcal-agent
VENV_DIR=/opt/wallcal-agent/venv
CONFIG_DIR=/etc/wallcal-agent
CONFIG_FILE=$CONFIG_DIR/config.yaml
UNIT_FILE=/etc/systemd/system/wallcal-agent.service
# Groups that give access to the hardware later milestones read. Only those that exist are used.
DEVICE_GROUPS=(gpio i2c dialout)

TARGET=''
CONFIG_CREATED=0

usage() {
  cat <<'EOF'
Usage:
  sudo ./install.sh
  ./install.sh --help

Installs the agent into /opt/wallcal-agent, creates /etc/wallcal-agent/config.yaml from
config.example.yaml if there is none, and enables the wallcal-agent service.

The first run leaves the service stopped, because the config needs your MQTT details.
Edit the file, then start it with 'sudo systemctl restart wallcal-agent'.
Later runs upgrade the agent, keep your config and restart the service.
EOF
}

step() { printf '==> %s\n' "$1"; }
warn() { printf 'install.sh: warning: %s\n' "$1" >&2; }
fail() { printf 'install.sh: %s\n' "$1" >&2; exit 1; }
usage_error() {
  printf "install.sh: %s\nTry './install.sh --help' for usage.\n" "$1" >&2
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

parse_args() {
  while (($#)); do
    case $1 in
      -h|--help) usage; exit 0 ;;
      --target)
        (($# >= 2)) || usage_error "$1 needs a value"
        TARGET=${2%/}
        [[ -n $TARGET ]] || usage_error "--target must not be /"
        shift 2 ;;
      *) usage_error "unknown option: $1" ;;
    esac
  done
}

# Names every missing source file at once so a half-copied checkout is obvious.
check_sources() {
  local f missing=()
  for f in pyproject.toml config.example.yaml systemd/wallcal-agent.service; do
    [[ -f $SRC_DIR/$f ]] || missing+=("$f")
  done
  ((${#missing[@]} == 0)) || fail "missing ${missing[*]} in $SRC_DIR"
}

preflight() {
  if ! in_target; then
    [[ $EUID -eq 0 ]] || fail "run it with sudo"
    command -v apt-get >/dev/null || fail "apt-get not found; this script is for Raspberry Pi OS"
    command -v systemctl >/dev/null || fail "systemctl not found; the agent runs as a systemd service"
  fi
  check_sources
}

warn_if_unexpected_system() {
  in_target && return 0
  grep -qa 'Raspberry Pi' /proc/device-tree/model 2>/dev/null ||
    warn "this does not look like a Raspberry Pi; carrying on"
}

install_packages() {
  step "Installing packages"
  in_target && return 0
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-venv
  python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' ||
    fail "the agent needs Python 3.11 or newer (Raspberry Pi OS Bookworm has it)"
}

create_user() {
  step "Creating the $SERVICE_USER user"
  in_target && return 0
  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --user-group --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
  local g
  for g in "${DEVICE_GROUPS[@]}"; do
    if getent group "$g" >/dev/null; then
      usermod -aG "$g" "$SERVICE_USER"
    fi
  done
}

# Not editable: the venv must keep working if the checkout is moved or deleted.
install_agent() {
  step "Installing the agent into $VENV_DIR"
  in_target && return 0
  [[ -x $VENV_DIR/bin/python ]] || python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --upgrade "$SRC_DIR"
}

# An existing config is never overwritten. Its owner and mode are still put right,
# in case it was restored from a backup, because the service cannot start without them.
install_config() {
  step "Installing the config file $CONFIG_FILE"
  local file
  file=$(path "$CONFIG_FILE")
  install -d -m 0755 "$(path "$CONFIG_DIR")"
  if [[ -e $file ]]; then
    echo "    keeping the existing file"
  else
    install -D -m 0640 "$SRC_DIR/config.example.yaml" "$file"
    CONFIG_CREATED=1
  fi
  chmod 0640 "$file"
  run_system chown "root:$SERVICE_USER" "$file"
}

install_service() {
  step "Installing the systemd service"
  install -D -m 0644 "$SRC_DIR/systemd/wallcal-agent.service" "$(path "$UNIT_FILE")"
  run_system systemctl daemon-reload
  run_system systemctl enable wallcal-agent
  # The example config points at a broker that doesn't exist, so don't start it until it is edited.
  if ((CONFIG_CREATED)); then
    return 0
  fi
  run_system systemctl restart wallcal-agent
}

print_summary() {
  if ((CONFIG_CREATED)); then
    cat <<EOF

Agent installed, but not started yet.
Edit $CONFIG_FILE (at least display_id and mqtt.host), then run:
  sudo systemctl restart wallcal-agent
EOF
  else
    cat <<EOF

Agent installed and restarted. Your config in $CONFIG_FILE was kept.
EOF
  fi
  cat <<'EOF'

Logs:   journalctl -u wallcal-agent -f
Status: systemctl status wallcal-agent
EOF
}

main() {
  parse_args "$@"
  preflight
  warn_if_unexpected_system
  install_packages
  create_user
  install_agent
  install_config
  install_service
  print_summary
}

main "$@"
