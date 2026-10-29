#!/usr/bin/env bash
# Tests for kiosk/setup.sh, run against a scratch tree with --target (no root, no network).
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REAL_KIOSK=$(cd "$HERE/.." && pwd)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
RC=0
URL='http://srv:8080/display?id=hallway&x=1'
CMDLINE='console=tty1 root=PARTUUID=abc rootwait'

ok() { PASS=$((PASS + 1)); echo "ok - $1"; }
not_ok() { FAIL=$((FAIL + 1)); echo "not ok - $1"; [[ -z ${2:-} ]] || echo "    $2"; }

assert_eq() { # name expected actual
  if [[ $2 == "$3" ]]; then ok "$1"; else not_ok "$1" "expected [$2], got [$3]"; fi
}
assert_true() { # name command...
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then ok "$name"; else not_ok "$name" "failed: $*"; fi
}
assert_contains() { # name file text
  if grep -qF -- "$3" "$2"; then ok "$1"; else not_ok "$1" "no [$3] in $2"; fi
}

# A copy of the real kiosk dir, with stand-ins for any file the other PR parts haven't supplied.
K=$WORK/kiosk
make_kiosk_copy() {
  local f
  mkdir -p "$K/bin"
  cp "$REAL_KIOSK/setup.sh" "$K/setup.sh"
  for f in bin/wallcal-kiosk bin/wallcal-kiosk-session chromium-flags.conf chromium-policy.json; do
    if [[ -f $REAL_KIOSK/$f ]]; then
      cp -p "$REAL_KIOSK/$f" "$K/$f"
    elif [[ $f == *.json ]]; then
      echo '{"TranslateEnabled": false}' >"$K/$f"
    elif [[ $f == bin/* ]]; then
      printf '#!/bin/sh\nexit 0\n' >"$K/$f"
      chmod 755 "$K/$f"
    else
      echo '--kiosk' >"$K/$f"
    fi
  done
}

# Runs setup.sh, capturing status and output in RC, $WORK/out and $WORK/err.
setup() {
  RC=0
  "$K/setup.sh" "$@" >"$WORK/out" 2>"$WORK/err" || RC=$?
}

# Makes a fresh target dir in $T, with the kiosk user's home.
T=''
new_target() {
  T=$(mktemp -d "$WORK/target.XXXXXX")
  mkdir -p "$T/home/kiosk"
}
with_cmdline() { mkdir -p "$T/boot/firmware"; printf '%s\n' "$1" >"$T/boot/firmware/cmdline.txt"; }
with_profile() { printf '%s' "$1" >"$T/home/kiosk/${2:-.profile}"; }

# Reads one key from a kiosk.conf the way the launcher does.
conf_value() { # target key
  (
    # shellcheck disable=SC1090,SC1091 # generated at run time
    source "$1/etc/wallcal-kiosk/kiosk.conf"
    printf '%s' "${!2}"
  )
}

# Checksums and modes of every file, so two runs can be compared.
tree_state() {
  (cd "$1" && find . -type f -exec sha256sum {} + | sort && find . -type f -printf '%m %p\n' | sort)
}

count_lines() { grep -cF -- "$2" "$1" || true; }

make_kiosk_copy

# 1. No --url
new_target
setup --target "$T" --user kiosk
assert_eq "no --url exits 2" 2 "$RC"
assert_contains "no --url error mentions --url" "$WORK/err" "--url"

# 2. Bad arguments
for bad in 'ftp://x' 'http://a b' 'notaurl' 'http://'; do
  setup --target "$T" --user kiosk --url "$bad"
  assert_eq "bad URL [$bad] exits 2" 2 "$RC"
done
setup --target "$T" --user kiosk --url "$URL" --compositor sway
assert_eq "bad compositor exits 2" 2 "$RC"
for bad in 1920 1920x 'x1080' '1920x1080@' 'big'; do
  setup --target "$T" --user kiosk --url "$URL" --mode "$bad"
  assert_eq "bad mode [$bad] exits 2" 2 "$RC"
done
setup --target "$T" --user kiosk --url "$URL" --frobnicate
assert_eq "unknown option exits 2" 2 "$RC"
setup --target "$T" --user kiosk --url
assert_eq "option without a value exits 2" 2 "$RC"
setup --target "$T" --user root --url "$URL"
assert_eq "--user root exits 2" 2 "$RC"
RC=0
env -u SUDO_USER "$K/setup.sh" --target "$T" --url "$URL" >/dev/null 2>&1 || RC=$?
assert_eq "no --user and no SUDO_USER exits 2" 2 "$RC"
assert_true "nothing written after validation failures" test ! -e "$T/etc"

# 3. --help
setup --help
assert_eq "--help exits 0" 0 "$RC"
assert_contains "--help prints usage" "$WORK/out" "Usage:"

# 4. Fresh run
new_target
with_cmdline "$CMDLINE"
with_profile $'# my profile\nexport FOO=1\n'
setup --target "$T" --url "$URL" --user kiosk
assert_eq "fresh run exits 0" 0 "$RC"
assert_contains "progress lines start with ==>" "$WORK/out" "==> "
assert_eq "kiosk.conf URL round-trips" "$URL" "$(conf_value "$T" WALLCAL_URL)"
assert_eq "kiosk.conf compositor defaults to labwc" labwc "$(conf_value "$T" WALLCAL_COMPOSITOR)"
assert_eq "kiosk.conf mode defaults to 2560x1440" 2560x1440 "$(conf_value "$T" WALLCAL_MODE)"
assert_true "launcher installed and executable" test -x "$T/usr/local/bin/wallcal-kiosk"
assert_true "session script installed and executable" test -x "$T/usr/local/bin/wallcal-kiosk-session"
assert_true "flags file installed" cmp "$K/chromium-flags.conf" "$T/etc/wallcal-kiosk/chromium-flags.conf"
for dir in chromium chromium-browser; do
  pol=$T/etc/$dir/policies/managed/wallcal-kiosk.json
  assert_true "policy installed for $dir" cmp "$K/chromium-policy.json" "$pol"
  assert_true "policy for $dir is valid JSON" python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$pol"
done
dropin=$T/etc/systemd/system/getty@tty1.service.d/wallcal-autologin.conf
assert_contains "drop-in has the auto-login user" "$dropin" "--autologin kiosk --noclear %I \$TERM"
assert_true "drop-in clears ExecStart first" grep -qx 'ExecStart=' "$dropin"
profile=$T/home/kiosk/.profile
assert_eq ".profile keeps its original content" $'# my profile\nexport FOO=1' "$(head -n 2 "$profile")"
assert_eq ".profile has one block start" 1 "$(count_lines "$profile" '# >>> wallcal-kiosk >>>')"
assert_eq ".profile has one block end" 1 "$(count_lines "$profile" '# <<< wallcal-kiosk <<<')"
assert_contains ".profile block execs the session" "$profile" "exec /usr/local/bin/wallcal-kiosk-session"
assert_true ".profile block is valid sh" sh -n "$profile"
cmdline=$T/boot/firmware/cmdline.txt
assert_eq "cmdline has one consoleblank=0" 1 "$(grep -o 'consoleblank=0' "$cmdline" | wc -l)"
assert_eq "cmdline is one line" 1 "$(wc -l <"$cmdline")"
assert_eq "cmdline keeps the other arguments" "$CMDLINE consoleblank=0" "$(cat "$cmdline")"

# 5. Idempotence
before=$(tree_state "$T")
setup --target "$T" --url "$URL" --user kiosk
assert_eq "re-run exits 0" 0 "$RC"
assert_eq "re-run leaves every file byte-identical" "$before" "$(tree_state "$T")"

# 6. Re-run without --url keeps it; other options change
setup --target "$T" --user kiosk --compositor cage --mode auto
assert_eq "re-run with new options exits 0" 0 "$RC"
assert_eq "URL kept when --url left out" "$URL" "$(conf_value "$T" WALLCAL_URL)"
assert_eq "compositor changed to cage" cage "$(conf_value "$T" WALLCAL_COMPOSITOR)"
assert_eq "mode changed to auto" auto "$(conf_value "$T" WALLCAL_MODE)"
setup --target "$T" --user kiosk --compositor labwc
setup --target "$T" --user kiosk --mode 1920x1080
assert_eq "compositor kept when only --mode is given" labwc "$(conf_value "$T" WALLCAL_COMPOSITOR)"
assert_eq "mode saved from the re-run" 1920x1080 "$(conf_value "$T" WALLCAL_MODE)"
assert_eq "re-runs still leave one block" 1 "$(count_lines "$profile" '# >>> wallcal-kiosk >>>')"

# 7. consoleblank=600 is replaced, not duplicated
new_target
with_cmdline "console=tty1 consoleblank=600 rootwait"
with_profile ''
setup --target "$T" --url "$URL" --user kiosk
assert_eq "consoleblank=600 becomes consoleblank=0" "console=tty1 consoleblank=0 rootwait" "$(cat "$T/boot/firmware/cmdline.txt")"

# 7b. cmdline fallback location, and no trailing newline in the original
new_target
mkdir -p "$T/boot"
printf '%s' "$CMDLINE" >"$T/boot/cmdline.txt"
setup --target "$T" --url "$URL" --user kiosk
assert_eq "falls back to /boot/cmdline.txt" "$CMDLINE consoleblank=0" "$(cat "$T/boot/cmdline.txt")"

# 8. Existing .bash_profile takes the block
new_target
with_cmdline "$CMDLINE"
with_profile 'profile content
' .profile
with_profile 'bash_profile content' .bash_profile
setup --target "$T" --url "$URL" --user kiosk
assert_eq ".profile untouched when .bash_profile exists" $'profile content' "$(cat "$T/home/kiosk/.profile")"
assert_eq ".bash_profile has the block" 1 "$(count_lines "$T/home/kiosk/.bash_profile" '# >>> wallcal-kiosk >>>')"
assert_eq ".bash_profile keeps its content" "bash_profile content" "$(head -n 1 "$T/home/kiosk/.bash_profile")"

# 8b. Missing .profile is created
new_target
with_cmdline "$CMDLINE"
setup --target "$T" --url "$URL" --user kiosk
assert_eq "missing .profile is created with one block" 1 "$(count_lines "$T/home/kiosk/.profile" '# >>> wallcal-kiosk >>>')"

# 9. No cmdline file
new_target
setup --target "$T" --url "$URL" --user kiosk
assert_eq "no cmdline file still exits 0" 0 "$RC"
assert_contains "no cmdline file warns on stderr" "$WORK/err" "setup.sh: warning: "

# 10. Awkward URL
new_target
with_cmdline "$CMDLINE"
awkward="http://h/display?id=a'b\$c;d"
setup --target "$T" --url "$awkward" --user kiosk
assert_eq "URL with quote, dollar and semicolon round-trips" "$awkward" "$(conf_value "$T" WALLCAL_URL)"

# 11. SUDO_USER is the default user
new_target
with_cmdline "$CMDLINE"
RC=0
SUDO_USER=kiosk "$K/setup.sh" --target "$T" --url "$URL" >/dev/null 2>&1 || RC=$?
assert_eq "--user defaults to SUDO_USER" 0 "$RC"
assert_contains "drop-in uses SUDO_USER" "$T/etc/systemd/system/getty@tty1.service.d/wallcal-autologin.conf" "--autologin kiosk"

# 12. A missing source file is named
new_target
rm "$K/chromium-policy.json"
setup --target "$T" --url "$URL" --user kiosk
assert_eq "missing source file exits 1" 1 "$RC"
assert_contains "missing source file is named" "$WORK/err" "chromium-policy.json"

echo "# $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
