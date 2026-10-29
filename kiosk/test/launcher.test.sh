#!/usr/bin/env bash
# Tests for bin/wallcal-kiosk, bin/wallcal-kiosk-session and the shipped Chromium
# flags and policy. Needs no root, network, Chromium or compositor: every external
# program is a fake script in a temp directory.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
kiosk=$(dirname "$here")
launcher=$kiosk/bin/wallcal-kiosk
session=$kiosk/bin/wallcal-kiosk-session

tmp=$(mktemp -d)
bg_pids=()
cleanup() {
  local p
  for p in ${bg_pids[@]+"${bg_pids[@]}"}; do
    kill -KILL "$p" 2>/dev/null || true
  done
  # A fake chromium that outlived its launcher would still hold its pid file.
  for p in "$tmp"/*.pid; do
    if [[ -f $p ]]; then
      kill -KILL "$(<"$p")" 2>/dev/null || true
    fi
  done
  rm -rf "$tmp"
}
trap cleanup EXIT

passed=0
failed=0
ok() {
  printf 'ok - %s\n' "$1"
  passed=$((passed + 1))
}
not_ok() {
  printf 'not ok - %s\n' "$1"
  failed=$((failed + 1))
}
assert_eq() { # name expected actual
  if [[ $2 == "$3" ]]; then
    ok "$1"
  else
    not_ok "$1"
    printf '  expected: %s\n  actual:   %s\n' "$2" "$3"
  fi
}
assert_contains() { # name haystack needle
  if [[ $2 == *"$3"* ]]; then
    ok "$1"
  else
    not_ok "$1"
    printf '  expected to find: %s\n  in: %s\n' "$3" "$2"
  fi
}
assert_true() { # name command...
  local name=$1
  shift
  if "$@"; then ok "$name"; else not_ok "$name"; fi
}
assert_false() { # name command...
  local name=$1
  shift
  if "$@"; then not_ok "$name"; else ok "$name"; fi
}

# Run a command, capturing stdout, stderr and the exit status without tripping set -e.
OUT='' ERR='' RC=0
run() {
  RC=0
  OUT=$("$@" 2>"$tmp/stderr") || RC=$?
  ERR=$(<"$tmp/stderr")
}

alive() { kill -0 "$1" 2>/dev/null; }

# Poll until a file has at least N lines, for at most S seconds.
wait_for_lines() { # file n seconds
  local i
  for ((i = 0; i < $3 * 10; i++)); do
    if [[ -f $1 ]] && (($(wc -l <"$1") >= $2)); then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

# Send TERM to a background launcher and wait for it. Sets STOP_RC; kills it if it ignores TERM.
stop_launcher() { # pid
  local i
  STOP_RC=0
  kill -TERM "$1" 2>/dev/null || true
  for ((i = 0; i < 50; i++)); do
    kill -0 "$1" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$1" 2>/dev/null; then
    kill -KILL "$1" 2>/dev/null || true
    STOP_RC=137
  fi
  wait "$1" 2>/dev/null || STOP_RC=$?
}

# --- Fixtures ---------------------------------------------------------------

# Never leak the developer's own session or kiosk settings into the tests.
unset WAYLAND_DISPLAY WALLCAL_URL WALLCAL_MODE WALLCAL_COMPOSITOR WALLCAL_CHROMIUM
export HOME=$tmp/home
export XDG_DATA_HOME=$tmp/data
export XDG_STATE_HOME=$tmp/state
export WALLCAL_KIOSK_CONF=$tmp/kiosk.conf
export WALLCAL_KIOSK_FLAGS=$tmp/flags.conf
export WALLCAL_KIOSK_LOCAL_FLAGS=$tmp/flags.local.conf
mkdir -p "$HOME"

url='http://srv:8080/display?id=hallway&x=1'
printf 'WALLCAL_URL=%q\nWALLCAL_COMPOSITOR=labwc\nWALLCAL_MODE=auto\n' "$url" >"$WALLCAL_KIOSK_CONF"
{
  printf '# a comment\n\n'
  printf '  --kiosk  \n'
  printf '   # an indented comment\n'
  printf '\t--foo=bar baz\t\n'
  printf '   \n'
  printf -- '--crlf\r\n'
  printf -- '--no-newline-at-end'
} >"$WALLCAL_KIOSK_FLAGS"
printf '# local\n--local-flag\n' >"$WALLCAL_KIOSK_LOCAL_FLAGS"

fakebin=$tmp/fakebin
mkdir -p "$fakebin"
# Install a fake program from stdin; the body is given as a quoted heredoc.
write_fake() { # name
  cat >"$fakebin/$1"
  chmod 755 "$fakebin/$1"
}
write_fake chromium <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
write_fake logger <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${FAKE_LOGGER_LOG:-/dev/null}"
FAKE
export FAKE_LOGGER_LOG=$tmp/logger.log
export WALLCAL_CHROMIUM=$fakebin/chromium

# Run the launcher with only the fakes on PATH, so nothing real can be picked up.
# --print-command needs no external programs.
launcher_alone() { env PATH="$fakebin" "$BASH" "$launcher" "$@"; }

# --- 1. --print-command -----------------------------------------------------

run launcher_alone --print-command
expected=$(printf '%s\n' "$fakebin/chromium" --kiosk '--foo=bar baz' --crlf --no-newline-at-end \
  --local-flag "--user-data-dir=$tmp/data/wallcal-kiosk/chromium" "$url")
assert_eq "print-command: browser, trimmed flags in order, local flags, profile, URL" "$expected" "$OUT"
assert_eq "print-command: exits 0" 0 "$RC"
assert_eq "print-command: URL is the last line, exactly" "$url" "${OUT##*$'\n'}"
assert_false "print-command: does not create the state directory" test -e "$XDG_STATE_HOME"

run env HOME="$tmp/otherhome" XDG_DATA_HOME= PATH="$fakebin" "$BASH" "$launcher" --print-command
assert_contains "print-command: profile falls back to HOME/.local/share" "$OUT" \
  "--user-data-dir=$tmp/otherhome/.local/share/wallcal-kiosk/chromium"

# --- 2. flags files ---------------------------------------------------------

mv "$WALLCAL_KIOSK_LOCAL_FLAGS" "$tmp/local.bak"
run launcher_alone --print-command
assert_eq "missing local flags file is fine" 0 "$RC"
assert_false "missing local flags file: no local flag" grep -qx -- '--local-flag' <<<"$OUT"
mv "$tmp/local.bak" "$WALLCAL_KIOSK_LOCAL_FLAGS"

run env WALLCAL_KIOSK_FLAGS="$tmp/nope.conf" PATH="$fakebin" "$BASH" "$launcher" --print-command
assert_true "missing main flags file fails" test "$RC" -ne 0
assert_contains "missing main flags file: error names the file" "$ERR" "nope.conf"

# --- 3. conf ----------------------------------------------------------------

run env WALLCAL_KIOSK_CONF="$tmp/nope.conf" PATH="$fakebin" "$BASH" "$launcher" --print-command
assert_true "missing conf fails" test "$RC" -ne 0

printf "WALLCAL_URL=''\n" >"$tmp/empty.conf"
run env WALLCAL_KIOSK_CONF="$tmp/empty.conf" PATH="$fakebin" "$BASH" "$launcher" --print-command
assert_true "empty WALLCAL_URL fails" test "$RC" -ne 0
assert_contains "empty WALLCAL_URL: error mentions it" "$ERR" "WALLCAL_URL"

printf 'WALLCAL_COMPOSITOR=labwc\n' >"$tmp/nourl.conf"
run env WALLCAL_KIOSK_CONF="$tmp/nourl.conf" PATH="$fakebin" "$BASH" "$launcher" --print-command
assert_true "conf without WALLCAL_URL fails" test "$RC" -ne 0

# The usage text needs cat, so give these two the real PATH as well.
run env PATH="$fakebin:$PATH" "$BASH" "$launcher" --bogus
assert_eq "unknown option exits 2" 2 "$RC"
run env PATH="$fakebin:$PATH" "$BASH" "$launcher" --help
assert_eq "--help exits 0" 0 "$RC"
assert_contains "--help prints usage" "$OUT" "Usage: wallcal-kiosk"

# --- 4. finding the browser -------------------------------------------------

only_browser=$tmp/only-browser
mkdir -p "$only_browser" "$tmp/empty"
printf '#!/bin/sh\nexit 0\n' >"$only_browser/chromium-browser"
chmod 755 "$only_browser/chromium-browser"
run env -u WALLCAL_CHROMIUM PATH="$only_browser" "$BASH" "$launcher" --print-command
assert_eq "chromium-browser is used when chromium is absent" "$only_browser/chromium-browser" "${OUT%%$'\n'*}"

cp "$only_browser/chromium-browser" "$only_browser/chromium"
run env -u WALLCAL_CHROMIUM PATH="$only_browser" "$BASH" "$launcher" --print-command
assert_eq "chromium is preferred over chromium-browser" "$only_browser/chromium" "${OUT%%$'\n'*}"

run env -u WALLCAL_CHROMIUM PATH="$tmp/empty" "$BASH" "$launcher" --print-command
assert_true "no browser at all fails" test "$RC" -ne 0
assert_contains "no browser: error says so" "$ERR" "chromium"

# --- 5. the shipped flags file ----------------------------------------------

run env WALLCAL_KIOSK_FLAGS="$kiosk/chromium-flags.conf" WALLCAL_KIOSK_LOCAL_FLAGS="$tmp/none" \
  PATH="$fakebin" "$BASH" "$launcher" --print-command
assert_eq "shipped flags: parse cleanly" 0 "$RC"
mapfile -t lines <<<"$OUT"
flags=("${lines[@]:1:${#lines[@]}-2}") # drop the browser and the URL
assert_true "shipped flags: has --kiosk" grep -qx -- '--kiosk' <<<"$OUT"
assert_true "shipped flags: has --no-first-run" grep -qx -- '--no-first-run' <<<"$OUT"
df=$(grep -c -- '^--disable-features=' <<<"$OUT" || true)
assert_eq "shipped flags: exactly one --disable-features" 1 "$df"
assert_contains "shipped flags: --disable-features includes Translate" "$(grep -- '^--disable-features=' <<<"$OUT")" "Translate"
ef=$(grep -c -- '^--enable-features=' <<<"$OUT" || true)
assert_true "shipped flags: at most one --enable-features" test "$ef" -le 1
bad=0
for f in "${flags[@]}"; do
  if [[ $f != --* ]]; then
    bad=$((bad + 1))
    printf '  not a flag: %s\n' "$f"
  fi
done
assert_eq "shipped flags: every line is a --flag" 0 "$bad"

# --- 6. the policy ----------------------------------------------------------

if command -v jq >/dev/null 2>&1; then
  assert_true "policy: valid JSON with TranslateEnabled false" jq -e '.TranslateEnabled == false' "$kiosk/chromium-policy.json" >/dev/null
else
  assert_true "policy: valid JSON with TranslateEnabled false" \
    python3 -I -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["TranslateEnabled"] is False else 1)' "$kiosk/chromium-policy.json"
fi

# --- 7. session script ------------------------------------------------------

compbin=$tmp/compbin
mkdir -p "$compbin"
for c in cage labwc; do
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" >"%s/%s.args"\n' "$tmp" "$c" >"$compbin/$c"
  chmod 755 "$compbin/$c"
done
fake_launcher=/fake/path/wallcal-kiosk

session_run() { # conf-file [env assignments...]; the compositor fakes are first on PATH
  local conf=$1
  shift
  env PATH="$compbin:$PATH" WALLCAL_KIOSK_CONF="$conf" WALLCAL_KIOSK_LAUNCHER="$fake_launcher" \
    WALLCAL_KIOSK_RETRY_DELAY=0 "$@" "$BASH" "$session"
}

printf 'WALLCAL_COMPOSITOR=cage\n' >"$tmp/cage.conf"
run session_run "$tmp/cage.conf"
assert_eq "session: cage exits 0 from the fake" 0 "$RC"
assert_eq "session: cage is run as 'cage -s -- <launcher>'" "-s
--
$fake_launcher" "$(<"$tmp/cage.args")"
assert_true "session: writes session.log" test -s "$XDG_STATE_HOME/wallcal-kiosk/session.log"

printf 'WALLCAL_COMPOSITOR=labwc\n' >"$tmp/labwc.conf"
run session_run "$tmp/labwc.conf"
assert_eq "session: labwc is run as 'labwc -s <launcher>'" "-s
$fake_launcher" "$(<"$tmp/labwc.args")"
assert_true "session: previous log kept as session.log.1" test -f "$XDG_STATE_HOME/wallcal-kiosk/session.log.1"

rm -f "$tmp/labwc.args"
run session_run "$tmp/does-not-exist.conf"
assert_eq "session: missing conf defaults to labwc" "-s
$fake_launcher" "$(<"$tmp/labwc.args")"
assert_contains "session: missing conf is logged" "$(<"$XDG_STATE_HOME/wallcal-kiosk/session.log")" "cannot read"

printf 'WALLCAL_COMPOSITOR=sway\n' >"$tmp/sway.conf"
run session_run "$tmp/sway.conf"
assert_eq "session: unknown compositor exits 1" 1 "$RC"
assert_contains "session: unknown compositor is logged" "$(<"$XDG_STATE_HOME/wallcal-kiosk/session.log")" "unknown compositor 'sway'"

# Only the programs the script itself needs, so a real labwc on this machine is not found.
tools=$tmp/tools
mkdir -p "$tools"
for t in mkdir mv sleep; do
  ln -s "$(command -v "$t")" "$tools/$t"
done
run env PATH="$tools" WALLCAL_KIOSK_CONF="$tmp/labwc.conf" WALLCAL_KIOSK_LAUNCHER="$fake_launcher" \
  WALLCAL_KIOSK_RETRY_DELAY=0 "$BASH" "$session"
assert_eq "session: missing compositor binary exits 1" 1 "$RC"
assert_contains "session: missing binary is logged" "$(<"$XDG_STATE_HOME/wallcal-kiosk/session.log")" "labwc is not installed"

# --- 8. launcher: running, restarting, stopping -----------------------------

write_fake curl <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_CURL_CALLS"
n=$(wc -l <"$FAKE_CURL_CALLS")
if ((n <= ${FAKE_CURL_FAILS:-0})); then
  echo "curl: (7) Failed to connect" >&2
  exit 7
fi
FAKE
write_fake wlr-randr <<'FAKE'
#!/usr/bin/env bash
if [[ ${1:-} == --output ]]; then
  printf '%s\n' "$*" >"$FAKE_WLR_ARGS"
  exit "${FAKE_WLR_RC:-0}"
fi
printf 'HDMI-A-1 "Fake Monitor"\n  Modes:\n    2560x1440 px, 59.95 Hz\n'
FAKE
# Chromium fake: note how many curl calls came before it, say who it is, then exit or linger.
write_fake chromium <<'FAKE'
#!/usr/bin/env bash
printf 'start curl_calls=%s\n' "$(wc -l <"$FAKE_CURL_CALLS")" >>"$FAKE_STARTS"
echo "fake chromium output $FAKE_TAG"
if [[ -n ${FAKE_LINGER:-} ]]; then
  echo $$ >"$FAKE_PID_FILE"
  exec sleep 60
fi
exit 3
FAKE

export FAKE_CURL_CALLS=$tmp/curl.calls
export FAKE_STARTS=$tmp/starts
export FAKE_WLR_ARGS=$tmp/wlr.args
export FAKE_PID_FILE=$tmp/chromium.pid
prefs_dir=$XDG_DATA_HOME/wallcal-kiosk/chromium/Default
mkdir -p "$prefs_dir"
printf '{"profile":{"exit_type":"Crashed","exited_cleanly":false}}' >"$prefs_dir/Preferences"
printf 'WALLCAL_URL=%q\nWALLCAL_MODE=2560x1440\n' "$url" >"$WALLCAL_KIOSK_CONF"
state=$XDG_STATE_HOME/wallcal-kiosk

# Smoke test: the first two curl calls fail, then Chromium exits at once every time.
env PATH="$fakebin:$PATH" WAYLAND_DISPLAY=wayland-test FAKE_TAG=smoke FAKE_CURL_FAILS=2 \
  WALLCAL_KIOSK_BACKOFF_START=1 WALLCAL_KIOSK_WAIT_INTERVAL=0 \
  "$BASH" "$launcher" 2>"$tmp/smoke.err" &
pid=$!
bg_pids+=("$pid")
assert_true "restart loop: chromium started at least twice" wait_for_lines "$FAKE_STARTS" 2 10
stop_launcher "$pid"
assert_eq "restart loop: exits 0 on TERM" 0 "$STOP_RC"
assert_eq "restart loop: waited for the server before the first start" "start curl_calls=3" "$(head -n1 "$FAKE_STARTS")"
assert_true "restart loop: curl was given the display URL" grep -qF -- "$url" "$FAKE_CURL_CALLS"
assert_true "restart loop: chromium.log exists" test -f "$state/chromium.log"
assert_contains "restart loop: chromium output is in chromium.log" "$(<"$state/chromium.log")" "fake chromium output smoke"
assert_contains "restart loop: exit status is logged" "$(<"$tmp/smoke.err")" "chromium exited with status 3"
assert_contains "restart loop: first server failure is logged" "$(<"$tmp/smoke.err")" "server not reachable yet"
assert_eq "restart loop: logged through logger with the tag" 1 "$(grep -c -m1 -- 'chromium exited with status 3' "$FAKE_LOGGER_LOG")"
assert_eq "restart loop: wlr-randr asked for the mode on the first output" "--output HDMI-A-1 --mode 2560x1440" "$(<"$FAKE_WLR_ARGS")"
assert_contains "restart loop: crash flags cleared (exit_type)" "$(<"$prefs_dir/Preferences")" '"exit_type":"Normal"'
assert_contains "restart loop: crash flags cleared (exited_cleanly)" "$(<"$prefs_dir/Preferences")" '"exited_cleanly":true'

# TERM test: a long-running Chromium must be stopped with the launcher, and a failing
# wlr-randr must not stop the launcher. Also checks the log rotation.
rm -f "$FAKE_STARTS" "$FAKE_WLR_ARGS" "$FAKE_PID_FILE"
env PATH="$fakebin:$PATH" WAYLAND_DISPLAY=wayland-test FAKE_TAG=term FAKE_LINGER=1 FAKE_WLR_RC=1 \
  WALLCAL_KIOSK_WAIT_INTERVAL=0 \
  "$BASH" "$launcher" 2>"$tmp/term.err" &
pid=$!
bg_pids+=("$pid")
assert_true "stop: chromium started despite wlr-randr failing" wait_for_lines "$FAKE_PID_FILE" 1 10
chromium_pid=$(<"$FAKE_PID_FILE")
assert_true "stop: chromium is running" alive "$chromium_pid"
stop_launcher "$pid"
assert_eq "stop: launcher exits 0 on TERM" 0 "$STOP_RC"
assert_false "stop: chromium was stopped with it" alive "$chromium_pid"
assert_contains "stop: mode failure was logged" "$(<"$tmp/term.err")" "could not set HDMI-A-1"
assert_contains "log rotation: previous run's log kept as chromium.log.1" "$(<"$state/chromium.log.1")" "fake chromium output smoke"
assert_contains "log rotation: this run's log is chromium.log" "$(<"$state/chromium.log")" "fake chromium output term"

printf '\n%d passed, %d failed\n' "$passed" "$failed"
((failed == 0))
