"""`hw-probe screen`: can the monitor be switched off and on, and which of the three ways works?

The pi-agent can turn the panel off with `cec` (HDMI CEC, `cec-client`), `output` (the Wayland compositor's HDMI
output, `wlopm` or `wlr-randr`) or `black` (leave the panel alone). This probe tries each on the real monitor, asking
the person at the screen what they saw, and recommends the best one. It also reads and writes the monitor's
brightness over DDC/CI, to say whether the backlog's DDC/CI backlight item is possible.

Anything that changes the screen is put back in a `finally`, so Ctrl-C does not leave the monitor off.
"""

import argparse
import contextlib
import glob
import os
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from . import wayland
from .context import Context
from .report import Section, Status
from .runner import CommandMissing, CommandTimeout, Result

GROUPS = ("cec", "output", "ddc")

CEC_TIMEOUT = 20
DDC_TIMEOUT = 20
WAYLAND_TIMEOUT = 10

# How long to let the monitor settle after a command before looking at it, in seconds.
CEC_SETTLE = 5
OUTPUT_SETTLE = 2
DDC_SETTLE = 2

# How far the brightness test moves the value, and how close the read-back must be to count as set.
BRIGHTNESS_STEP = 30
BRIGHTNESS_TOLERANCE = 1

INSTALL_HINTS = {
    "cec-client": "cec-utils",
    "ddcutil": "ddcutil",
    "wlr-randr": "wlr-randr",
    "wlopm": "wlopm",
}

NEEDS_PERSON = "needs someone watching the screen"


def list_i2c_devices() -> list[str]:
    return sorted(glob.glob("/dev/i2c-*"))


def _groups(value: str) -> list[str]:
    names = [name.strip() for name in value.split(",") if name.strip()]
    unknown = [name for name in names if name not in GROUPS]
    if unknown or not names:
        raise argparse.ArgumentTypeError(f"choose from {', '.join(GROUPS)} (separated by commas)")
    return names


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--only", type=_groups, metavar="LIST", help="run only these parts: cec, output, ddc")
    parser.add_argument("--skip", type=_groups, metavar="LIST", help="leave these parts out: cec, output, ddc")
    parser.add_argument(
        "--cec-device", type=int, default=0, metavar="N", help="CEC logical address of the monitor (default: 0, the TV)"
    )
    parser.add_argument(
        "--cec-port", metavar="PATH", help="CEC adapter to use, such as /dev/cec1 (default: cec-client's first)"
    )
    parser.add_argument("--output", metavar="NAME", help="Wayland output to switch (default: the first enabled one)")
    parser.add_argument("--wayland-display", metavar="PATH", help="Wayland socket to use (default: look for it)")
    parser.add_argument(
        "--off-seconds",
        type=float,
        default=15,
        metavar="N",
        help="how long the output stays off before asking whether the monitor slept (default: 15)",
    )
    parser.add_argument(
        "--wake-timeout",
        type=float,
        default=60,
        metavar="N",
        help="how long to wait for the picture to come back, in seconds (default: 60)",
    )


class ToolError(Exception):
    """A command could not be run or did not finish. The message is fit for a check's detail."""


def parse_cec_adapters(text: str) -> tuple[int, list[str]]:
    """Reads `cec-client -l`: the adapter count and each `com port:`."""
    found = re.search(r"Found devices:\s*(\d+)", text)
    ports = re.findall(r"^\s*com port:\s*(\S+)", text, re.MULTILINE)
    return (int(found.group(1)) if found else len(ports)), ports


@dataclass
class CecDevice:
    address: int
    name: str
    fields: dict[str, str] = field(default_factory=dict)

    @property
    def vendor(self) -> str | None:
        return _known(self.fields.get("vendor"))

    @property
    def osd_name(self) -> str | None:
        return _known(self.fields.get("osd string"))


def _known(value: str | None) -> str | None:
    if value is None or value.strip().lower() in ("", "unknown"):
        return None
    return value.strip()


def parse_cec_scan(text: str) -> list[CecDevice]:
    """Reads the device blocks `scan` prints: `device #0: TV`, then `key: value` lines."""
    devices: list[CecDevice] = []
    for line in text.splitlines():
        header = re.match(r"^\s*device #(\d+):\s*(.*?)\s*$", line)
        if header:
            devices.append(CecDevice(int(header.group(1)), header.group(2)))
            continue
        key, separator, value = line.partition(":")
        if devices and separator and key.strip():
            devices[-1].fields.setdefault(key.strip().lower(), value.strip())
    return devices


# What `pow` prints after "power status:". The two transitions count as where the monitor is heading.
_CEC_POWER = {
    "on": "on",
    "standby": "standby",
    "in transition from standby to on": "on",
    "in transition from on to standby": "standby",
}


def parse_cec_power(text: str) -> str | None:
    """`on` or `standby` from `pow`'s output, None for unknown or no answer."""
    match = re.search(r"^\s*power status:\s*(.*?)\s*$", text, re.IGNORECASE | re.MULTILINE)
    return _CEC_POWER.get(match.group(1).lower()) if match else None


@dataclass
class DdcDisplay:
    valid: bool
    number: int | None = None
    bus: int | None = None
    vendor: str | None = None
    model: str | None = None
    reason: str = ""

    @property
    def name(self) -> str:
        return " ".join(part for part in (self.vendor, self.model) if part)


def parse_ddcutil_detect(text: str) -> list[DdcDisplay]:
    """Reads `ddcutil detect`: `Display N` and `Invalid display` blocks, their details indented."""
    displays: list[DdcDisplay] = []
    current: DdcDisplay | None = None
    for line in text.splitlines():
        if not line.strip():
            continue
        if not line[0].isspace():
            header = re.match(r"^(Display (\d+)|Invalid display|Phantom display)\s*$", line)
            current = None
            if header:
                valid = header.group(2) is not None
                current = DdcDisplay(valid, int(header.group(2)) if valid else None)
                displays.append(current)
            continue
        if current is None:
            continue
        text_line = line.strip()
        bus = re.match(r"I2C bus:\s*/dev/i2c-(\d+)", text_line)
        mfg = re.match(r"Mfg id:\s*(\S+)(?:\s*-\s*(.*))?", text_line)
        model = re.match(r"Model:\s*(.*)", text_line)
        if bus:
            current.bus = int(bus.group(1))
        elif mfg:
            company = (mfg.group(2) or "").strip().split()
            current.vendor = company[0] if company else mfg.group(1)
        elif model:
            current.model = model.group(1).strip() or None
        elif ":" not in text_line and not current.reason:
            current.reason = text_line
    return displays


def parse_brightness(text: str) -> tuple[int, int] | None:
    """The (current, maximum) from `ddcutil getvcp 10`."""
    match = re.search(r"current value\s*=\s*(\d+),\s*max value\s*=\s*(\d+)", text)
    return (int(match.group(1)), int(match.group(2))) if match else None


class ScreenProbe:
    def __init__(
        self,
        args: argparse.Namespace,
        ctx: Context,
        *,
        list_i2c: Callable[[], list[str]],
        environ: Mapping[str, str],
        uid: int,
        find_session: Callable[..., wayland.Session | None],
    ) -> None:
        self.args = args
        self.ctx = ctx
        self.section = Section("Screen probe")
        self._list_i2c = list_i2c
        self._environ = environ
        self._uid = uid
        self._find_session = find_session

    # Running things.

    def _run(
        self,
        argv: list[str],
        timeout: float,
        *,
        stdin: str | None = None,
        env: Mapping[str, str] | None = None,
    ) -> Result:
        try:
            return self.ctx.runner(argv, stdin=stdin, env=env, timeout=timeout)
        except CommandMissing as missing:
            program = argv[0]
            package = INSTALL_HINTS.get(program, program)
            raise ToolError(f"{missing.program} is not installed (sudo apt install {package})") from None
        except CommandTimeout as timed_out:
            raise ToolError(str(timed_out)) from None

    def _skip(self, names: list[str], reason: str) -> None:
        for name in names:
            self.section.add(name, Status.SKIP, reason)

    def _status(self, name: str) -> Status | None:
        return next((check.status for check in self.section.checks if check.name == name), None)

    def _passed(self, name: str) -> bool:
        return self._status(name) is Status.PASS

    # CEC.

    def _cec(self, command: str) -> Result:
        port = [self.args.cec_port] if self.args.cec_port else []
        return self._run(["cec-client", "-s", "-d", "1", *port], CEC_TIMEOUT, stdin=f"{command}\n")

    def _cec_power(self) -> str | None:
        return parse_cec_power(self._cec(f"pow {self.args.cec_device}").stdout)

    def run_cec(self) -> None:
        names = ["CEC monitor", "CEC power report", "CEC standby", "CEC wake", "CEC power follows"]
        try:
            listing = self._run(["cec-client", "-l"], CEC_TIMEOUT)
        except ToolError as error:
            self.section.add("CEC adapter", Status.FAIL, str(error))
            self._skip(names, "needs a CEC adapter")
            return
        count, ports = parse_cec_adapters(listing.stdout)
        if count == 0:
            self.section.add("CEC adapter", Status.FAIL, "no CEC adapter found; is the Pi's user in the video group?")
            self._skip(names, "needs a CEC adapter")
            return
        self.section.add("CEC adapter", Status.PASS, ", ".join(ports) if ports else f"{count} found")

        if self._cec_monitor() is None:
            self._skip(names[1:], "needs a CEC monitor that answers")
            return
        self._cec_power_report()
        self._cec_off_and_on()

    def _cec_monitor(self) -> CecDevice | None:
        address = self.args.cec_device
        try:
            scan = self._cec("scan")
        except ToolError as error:
            self.section.add("CEC monitor", Status.FAIL, str(error))
            return None
        device = next((item for item in parse_cec_scan(scan.stdout) if item.address == address), None)
        if device is None:
            self.section.add(
                "CEC monitor",
                Status.FAIL,
                f"no device at address {address} answered; turn on CEC (Samsung: Anynet+) in the monitor's menu, "
                "try the other HDMI port or --cec-port /dev/cec1",
            )
            return None
        parts = []
        if device.vendor:
            parts.append(f"vendor {device.vendor}")
            self.section.fact("CEC vendor", device.vendor)
        if device.osd_name:
            parts.append(f"name '{device.osd_name}'")
            self.section.fact("CEC name", device.osd_name)
        detail = ", ".join(parts)
        self.section.add("CEC monitor", Status.PASS, f"{device.name}: {detail}" if detail else device.name)
        return device

    def _cec_power_report(self) -> None:
        try:
            state = self._cec_power()
        except ToolError as error:
            self.section.add("CEC power report", Status.FAIL, str(error))
            return
        if state is None:
            self.section.add("CEC power report", Status.FAIL, "does not report its power state (answered 'unknown')")
        else:
            self.section.add("CEC power report", Status.PASS, f"reports {state}")

    def _cec_off_and_on(self) -> None:
        address = self.args.cec_device
        if not self.ctx.prompter.interactive:
            self._skip(["CEC standby", "CEC wake", "CEC power follows"], NEEDS_PERSON)
            return
        standby_sent = False
        woken = False
        while_off: str | None = None
        after_wake: str | None = None
        wake_ran = False
        try:
            try:
                self.ctx.say("Sending the monitor to standby over CEC.")
                result = self._cec(f"standby {address}")
                standby_sent = True
                if not result.ok:
                    raise ToolError(f"cec-client failed: {result.first_error_line()}")
                self.ctx.sleep(CEC_SETTLE)
                while_off = self._cec_power()
                answer = self.ctx.prompter.yes_no("Did the monitor go to standby? [y/n]")
                reported = while_off or "unknown"
                if answer is None:
                    self.section.add("CEC standby", Status.SKIP, "no answer was given")
                elif answer:
                    self.section.add("CEC standby", Status.PASS, f"the monitor went to standby; reported: {reported}")
                else:
                    self.section.add("CEC standby", Status.FAIL, f"the monitor stayed on; reported: {reported}")
            except ToolError as error:
                self.section.add("CEC standby", Status.FAIL, str(error))

            if not standby_sent:
                self._skip(["CEC wake", "CEC power follows"], "needs the standby step to have run")
                return
            try:
                self.ctx.say("Waking the monitor and making the Pi the active source.")
                self._cec(f"on {address}")
                woken = True
                self._cec("as")
                seconds = self.ctx.prompter.wait_enter(
                    f"Press Enter when the picture is back (waiting up to {self.args.wake_timeout:g} s)",
                    self.args.wake_timeout,
                )
                if seconds is None:
                    self.section.add("CEC wake", Status.FAIL, f"no picture within {self.args.wake_timeout:g} s")
                else:
                    self.section.add("CEC wake", Status.PASS, f"picture back after {seconds:.1f} s")
                after_wake = self._cec_power()
                wake_ran = True
            except ToolError as error:
                self.section.add("CEC wake", Status.FAIL, str(error))
        finally:
            if standby_sent and not woken:
                with contextlib.suppress(ToolError):
                    self._cec(f"on {address}")

        if not wake_ran:
            self._skip(["CEC power follows"], "needs the standby and wake steps")
        elif while_off == "standby" and after_wake == "on":
            self.section.add("CEC power follows", Status.PASS, "reported standby while off and on after waking")
        else:
            self.section.add(
                "CEC power follows",
                Status.FAIL,
                f"reported {while_off or 'unknown'} while off and {after_wake or 'unknown'} after waking",
            )

    # HDMI output.

    def run_output(self) -> None:
        names = ["HDMI outputs", "Output off", "Monitor sleeps without signal", "Output wake"]
        session = self._find_session(self.args.wayland_display, self._environ, self._uid)
        if session is None:
            self.section.add(
                "Wayland session",
                Status.FAIL,
                "no Wayland compositor found for this user: run this as the kiosk user while the kiosk is up, "
                "or pass --wayland-display",
            )
            self._skip(names, "needs a Wayland session")
            return
        self.section.add("Wayland session", Status.PASS, session.socket)
        env = session.env()

        output = self._choose_output(env)
        if output is None:
            self._skip(names[1:], "needs an HDMI output")
            return
        if not self.ctx.prompter.interactive:
            self._skip(names[1:], NEEDS_PERSON)
            return

        name = output.name
        is_off = False
        try:
            try:
                self.ctx.say(f"Switching {name} off.")
                self._switch_output(name, env, on=False)
                is_off = True
                self.ctx.sleep(OUTPUT_SETTLE)
                gone = self.ctx.prompter.yes_no("Has the picture gone? [y/n]")
            except ToolError as error:
                self.section.add("Output off", Status.FAIL, str(error))
                self._skip(names[2:], "needs the output to switch off")
                return
            if gone is None:
                self.section.add("Output off", Status.SKIP, "no answer was given")
                self._skip(names[2:], "needs the output to switch off")
                return
            if not gone:
                self.section.add("Output off", Status.FAIL, "the command ran but the picture stayed")
                self._skip(names[2:], "needs the picture to go first")
                return
            self.section.add("Output off", Status.PASS, "the picture went when the output was switched off")

            self.ctx.say(f"Leaving it off for {self.args.off_seconds:g} s.")
            self.ctx.sleep(self.args.off_seconds)
            asleep = self.ctx.prompter.yes_no(
                "Has the monitor gone into standby (power light changed, not just a 'no signal' message)? [y/n]"
            )
            if asleep is None:
                self.section.add("Monitor sleeps without signal", Status.SKIP, "no answer was given")
            elif asleep:
                self.section.add(
                    "Monitor sleeps without signal",
                    Status.PASS,
                    f"in standby after {self.args.off_seconds:g} s with no signal",
                )
            else:
                self.section.add(
                    "Monitor sleeps without signal",
                    Status.FAIL,
                    f"still lit after {self.args.off_seconds:g} s: the output back end would not save power",
                )

            try:
                self.ctx.say(f"Switching {name} back on.")
                self._switch_output(name, env, on=True)
                is_off = False
                seconds = self.ctx.prompter.wait_enter(
                    f"Press Enter when the picture is back (waiting up to {self.args.wake_timeout:g} s)",
                    self.args.wake_timeout,
                )
                if seconds is None:
                    self.section.add("Output wake", Status.FAIL, f"no picture within {self.args.wake_timeout:g} s")
                else:
                    self.section.add("Output wake", Status.PASS, f"picture back after {seconds:.1f} s")
            except ToolError as error:
                self.section.add("Output wake", Status.FAIL, str(error))
        finally:
            if is_off:
                with contextlib.suppress(ToolError):
                    self._switch_output(name, env, on=True)

    def _choose_output(self, env: Mapping[str, str]) -> wayland.Output | None:
        candidates: list[tuple[str, Callable[[str], list[wayland.Output]]]] = []
        if self.ctx.which("wlr-randr"):
            candidates.append(("wlr-randr", wayland.parse_wlr_randr))
        if self.ctx.which("wlopm"):
            candidates.append(("wlopm", wayland.parse_wlopm))
        if not candidates:
            self.section.add(
                "HDMI outputs",
                Status.FAIL,
                "neither wlr-randr nor wlopm is installed (sudo apt install wlr-randr wlopm)",
            )
            return None
        problem = ""
        outputs: list[wayland.Output] = []
        for tool, parse in candidates:
            try:
                result = self._run([tool], WAYLAND_TIMEOUT, env=env)
            except ToolError as error:
                problem = str(error)
                continue
            if not result.ok:
                problem = f"{tool} failed: {result.first_error_line()}"
                continue
            outputs = parse(result.stdout)
            if outputs:
                break
            problem = f"{tool} listed no outputs"
        if not outputs:
            self.section.add("HDMI outputs", Status.FAIL, problem)
            return None
        wanted = self.args.output
        if wanted:
            chosen = next((item for item in outputs if item.name == wanted), None)
            if chosen is None:
                names = ", ".join(item.name for item in outputs)
                self.section.add("HDMI outputs", Status.FAIL, f"no output named {wanted}; found {names}")
                return None
        else:
            chosen = next((item for item in outputs if item.enabled is not False), None)
            if chosen is None:
                self.section.add("HDMI outputs", Status.FAIL, "every output is disabled")
                return None
        detail = f"{chosen.name}, {chosen.mode}" if chosen.mode else chosen.name
        self.section.add("HDMI outputs", Status.PASS, detail)
        if chosen.mode:
            self.section.fact("Output mode", chosen.mode)
        return chosen

    def _switch_output(self, name: str, env: Mapping[str, str], *, on: bool) -> None:
        if self.ctx.which("wlopm"):
            argv = ["wlopm", "--on" if on else "--off", name]
        else:
            argv = ["wlr-randr", "--output", name, "--on" if on else "--off"]
        result = self._run(argv, WAYLAND_TIMEOUT, env=env)
        if not result.ok:
            raise ToolError(f"{argv[0]} failed: {result.first_error_line()}")

    # DDC/CI.

    def run_ddc(self) -> None:
        names = ["DDC/CI monitor", "DDC brightness read", "DDC brightness write"]
        buses = self._list_i2c()
        if not buses:
            self.section.add(
                "I2C buses",
                Status.FAIL,
                "no /dev/i2c-* devices: run `sudo modprobe i2c-dev` "
                "(and add i2c-dev to /etc/modules-load.d/ to keep it)",
            )
            self._skip(names, "needs /dev/i2c-* devices")
            return
        self.section.add("I2C buses", Status.PASS, f"{len(buses)} found")

        display = self._ddc_display()
        if display is None or display.bus is None:
            self._skip(names[1:], "needs a monitor that answers over DDC/CI")
            return
        bus = display.bus
        try:
            current, maximum, took = self._ddc_read(bus)
        except ToolError as error:
            self.section.add("DDC brightness read", Status.FAIL, str(error))
            self._skip(names[2:], "needs a brightness reading")
            return
        self.section.add("DDC brightness read", Status.PASS, f"{current} of {maximum} (took {took:.1f} s)")
        self._ddc_write(bus, current, maximum)

    def _ddc_display(self) -> DdcDisplay | None:
        failure = "DDC/CI monitor"
        try:
            result = self._run(["ddcutil", "detect"], DDC_TIMEOUT)
        except ToolError as error:
            self.section.add(failure, Status.FAIL, str(error))
            return None
        displays = parse_ddcutil_detect(result.stdout)
        found = next((item for item in displays if item.valid), None)
        if found is not None and found.bus is not None:
            label = f"display {found.number} on /dev/i2c-{found.bus}"
            self.section.add(failure, Status.PASS, f"{label}, {found.name}" if found.name else label)
            if found.name:
                self.section.fact("DDC monitor", found.name)
            return found
        reason = next((item.reason for item in displays if item.reason), "")
        if not reason:
            reason = "No displays found" if "No displays found" in result.stdout else result.first_error_line()
        shown = f" ({reason})" if reason else ""
        self.section.add(
            failure,
            Status.FAIL,
            f"no display answered over DDC/CI{shown}; turn on DDC/CI or 'PC mode' in the monitor's menu if it has one",
        )
        return None

    def _ddc_read(self, bus: int) -> tuple[int, int, float]:
        """The (current, maximum, seconds taken). Raises ToolError, with a message for the check, if it can't."""
        result = self._run(["ddcutil", "--bus", str(bus), "getvcp", "10"], DDC_TIMEOUT)
        value = parse_brightness(result.stdout)
        if value is None:
            why = result.first_error_line() or "no brightness value in the answer"
            raise ToolError(f"could not read the brightness: {why}")
        return value[0], value[1], result.seconds

    def _ddc_set(self, bus: int, value: int) -> Result:
        return self._run(["ddcutil", "--bus", str(bus), "setvcp", "10", str(value)], DDC_TIMEOUT)

    def _ddc_write(self, bus: int, original: int, maximum: int) -> None:
        check = "DDC brightness write"
        target = original - BRIGHTNESS_STEP if original >= 50 else original + BRIGHTNESS_STEP
        target = max(0, min(maximum, target))
        changed = False
        restored = False
        status = Status.FAIL
        detail = ""
        try:
            try:
                changed = True
                result = self._ddc_set(bus, target)
                if not result.ok:
                    raise ToolError(f"could not set the brightness: {result.first_error_line()}")
                self.ctx.sleep(DDC_SETTLE)
                after = self._ddc_read(bus)
                if abs(after[0] - target) > BRIGHTNESS_TOLERANCE:
                    detail = f"set {target} but read back {after[0]}"
                else:
                    status, detail = Status.PASS, f"set {target}, read back {after[0]}"
                    if self.ctx.prompter.interactive:
                        moved = self.ctx.prompter.yes_no("Did the brightness change? [y/n]")
                        if moved is False:
                            status = Status.FAIL
                            detail = f"the monitor accepted the value but the picture did not change ({detail})"
            except ToolError as error:
                detail = str(error)
        finally:
            if changed:
                try:
                    restored = self._ddc_set(bus, original).ok
                except ToolError:
                    restored = False
        if restored:
            detail += f"; restored to {original}"
        else:
            status = Status.FAIL
            detail += f"; could NOT restore to {original}: set it back in the monitor's menu"
        self.section.add(check, status, detail)

    # Summary.

    def recommend(self) -> None:
        if self._passed("CEC standby") and self._passed("CEC wake"):
            choice, why = "cec", "CEC put the monitor in standby and woke it again."
        elif (
            self._passed("Output off") and self._passed("Monitor sleeps without signal") and self._passed("Output wake")
        ):
            choice = "output"
            why = "Switching the HDMI output off made the monitor sleep, and switching it on brought the picture back."
        else:
            choice = "black"
            why = (
                "Neither CEC nor the HDMI output was shown to switch the monitor off and on, so leave the panel alone."
            )
        self.section.add("Recommended back end", Status.INFO, f"{choice}: {why}")
        if self._passed("DDC brightness write"):
            self.section.notes.append("DDC/CI brightness works: the backlog's DDC/CI backlight item is possible.")
        elif any(
            self._status(name) is Status.FAIL
            for name in ("DDC/CI monitor", "DDC brightness read", "DDC brightness write")
        ):
            self.section.notes.append(
                "DDC/CI brightness does not work on this monitor: the backlog's DDC/CI backlight item is not possible."
            )


def run(
    args: argparse.Namespace,
    ctx: Context,
    *,
    list_i2c: Callable[[], list[str]] = list_i2c_devices,
    environ: Mapping[str, str] | None = None,
    uid: int | None = None,
    find_session: Callable[..., wayland.Session | None] = wayland.find_session,
) -> Section:
    probe = ScreenProbe(
        args,
        ctx,
        list_i2c=list_i2c,
        environ=os.environ if environ is None else environ,
        uid=os.getuid() if uid is None else uid,
        find_session=find_session,
    )
    chosen = [name for name in GROUPS if (args.only is None or name in args.only) and name not in (args.skip or [])]
    steps = {"cec": probe.run_cec, "output": probe.run_output, "ddc": probe.run_ddc}
    for name in chosen:
        steps[name]()
    probe.recommend()
    return probe.section
