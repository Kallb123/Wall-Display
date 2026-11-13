import argparse

import pytest

from hw_probe import screen
from hw_probe.context import Context
from hw_probe.report import Section, Status
from hw_probe.runner import CommandMissing, CommandTimeout
from hw_probe.wayland import Session

from .fakes import FakeClock, FakeRunner, ScriptedPrompter, result

CEC = ("cec-client", "-s", "-d", "1")

CEC_LIST = """\
libCEC version: 6.0.2, compiled on Linux-6.1.0 ...
Found devices: 1

device:              1
com port:            /dev/cec0
vendor id:           2708
product id:          1001
firmware version:    3
type:                Raspberry Pi
"""

CEC_LIST_NONE = "libCEC version: 6.0.2\nFound devices: 0\n"

CEC_SCAN = """\
requesting CEC bus information ...
CEC bus information
===================
device #0: TV
address:       0.0.0.0
active source: no
vendor:        Samsung
osd string:    M80F
CEC version:   1.4
power status:  on
language:      eng

device #1: Recorder 1
address:       1.0.0.0
active source: no
vendor:        Unknown
osd string:    CECTester
CEC version:   1.4
power status:  on
language:      ???
"""

CEC_SCAN_NO_TV = """\
CEC bus information
===================
device #1: Recorder 1
address:       1.0.0.0
active source: no
vendor:        Unknown
osd string:    CECTester
power status:  on
"""

POW_ON = "power status: on\n"
POW_STANDBY = "power status: standby\n"
POW_UNKNOWN = "power status: unknown\n"

WLR_RANDR = """\
HDMI-A-1 "Samsung Electric Company Odyssey G80SD (HDMI-A-1)"
  Make: Samsung Electric Company
  Enabled: yes
  Modes:
    3840x2160 px, 60.000000 Hz (preferred)
    2560x1440 px, 59.951002 Hz (current)
  Position: 0,0
  Scale: 1.000000
"""

WLOPM = "HDMI-A-1 on\n"

DDC_DETECT = """\
Display 1
   I2C bus:  /dev/i2c-20
   DRM connector:           card1-HDMI-A-1
   EDID synopsis:
      Mfg id:               SAM - Samsung Electric Company
      Model:                M80F
      Product code:         3333  (0x0d05)
      Serial number:        HNAW600000
      Binary serial number: 16777217 (0x01000001)
      Manufacture year:     2024,  Week: 12
   VCP version:         2.2
"""

DDC_INVALID = """\
Invalid display
   I2C bus:  /dev/i2c-20
   DRM connector:           card1-HDMI-A-1
   EDID synopsis:
      Mfg id:               SAM - Samsung Electric Company
      Model:                M80F
      Product code:         3333  (0x0d05)
   DDC communication failed
   Is the monitor DDC/CI-enabled?
"""

DDC_NONE = "No displays found.\n"


def vcp(value: int, maximum: int = 100) -> str:
    return f"VCP code 0x10 (Brightness                    ): current value = {value:5d}, max value = {maximum:5d}\n"


def parse(*argv: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    screen.add_arguments(parser)
    return parser.parse_args(argv)


SESSION = Session("/run/user/1000/wayland-0")
SESSION_ENV = SESSION.env()


def run_probe(
    ctx: Context,
    *argv: str,
    i2c: list[str] | None = None,
    session: Session | None = SESSION,
) -> Section:
    return screen.run(
        parse(*argv),
        ctx,
        list_i2c=lambda: ["/dev/i2c-20"] if i2c is None else i2c,
        environ={},
        uid=1000,
        find_session=lambda explicit, environ, uid: session,
    )


def check(section: Section, name: str):
    found = [item for item in section.checks if item.name == name]
    assert len(found) == 1, f"{name!r} in {[item.name for item in section.checks]}"
    return found[0]


def statuses(section: Section) -> dict[str, Status]:
    return {item.name: item.status for item in section.checks}


def cec_happy(runner: FakeRunner, pow_answers: tuple[str, ...] = (POW_ON, POW_STANDBY, POW_ON)) -> None:
    runner.on(["cec-client", "-l"], CEC_LIST)
    runner.on(CEC, CEC_SCAN, stdin="scan\n")
    runner.on(CEC, *pow_answers, stdin="pow 0\n")
    for command in ("standby 0\n", "on 0\n", "as\n"):
        runner.on(CEC, "", stdin=command)


def output_happy(runner: FakeRunner) -> None:
    runner.on(["wlr-randr"], WLR_RANDR)
    runner.on(["wlopm", "--off", "HDMI-A-1"], "")
    runner.on(["wlopm", "--on", "HDMI-A-1"], "")


def ddc_happy(runner: FakeRunner, readings: tuple[int, ...] = (50, 20)) -> None:
    runner.on(["ddcutil", "detect"], DDC_DETECT)
    runner.on(["ddcutil", "--bus", "20", "getvcp", "10"], *(vcp(value) for value in readings))
    runner.on(["ddcutil", "--bus", "20", "setvcp", "10", "20"], "")
    runner.on(["ddcutil", "--bus", "20", "setvcp", "10", "50"], "")


def cec_calls(runner: FakeRunner) -> list[str | None]:
    return runner.stdins(CEC)


# Parsers.


def test_parse_cec_adapters() -> None:
    assert screen.parse_cec_adapters(CEC_LIST) == (1, ["/dev/cec0"])
    assert screen.parse_cec_adapters(CEC_LIST_NONE) == (0, [])
    assert screen.parse_cec_adapters("") == (0, [])


def test_parse_cec_scan_reads_each_device() -> None:
    devices = screen.parse_cec_scan(CEC_SCAN)
    assert [(item.address, item.name) for item in devices] == [(0, "TV"), (1, "Recorder 1")]
    assert devices[0].vendor == "Samsung"
    assert devices[0].osd_name == "M80F"
    assert devices[1].vendor is None  # "Unknown" is not a vendor


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("power status: on", "on"),
        ("power status: standby", "standby"),
        ("power status: in transition from standby to on", "on"),
        ("power status: in transition from on to standby", "standby"),
        ("power status: unknown", None),
        ("nothing useful", None),
    ],
)
def test_parse_cec_power(text: str, expected: str | None) -> None:
    assert screen.parse_cec_power(f"waiting\n{text}\n") == expected


def test_parse_ddcutil_detect() -> None:
    [display] = screen.parse_ddcutil_detect(DDC_DETECT)
    assert (display.valid, display.number, display.bus, display.vendor, display.model) == (
        True,
        1,
        20,
        "Samsung",
        "M80F",
    )
    assert display.name == "Samsung M80F"


def test_parse_ddcutil_detect_keeps_the_first_reason_of_an_invalid_display() -> None:
    [display] = screen.parse_ddcutil_detect(DDC_INVALID)
    assert display.valid is False
    assert display.bus == 20
    assert display.reason == "DDC communication failed"


def test_parse_ddcutil_detect_with_nothing_found() -> None:
    assert screen.parse_ddcutil_detect(DDC_NONE) == []


def test_parse_brightness() -> None:
    assert screen.parse_brightness(vcp(50)) == (50, 100)
    assert screen.parse_brightness("nope") is None


def test_options() -> None:
    args = parse()
    assert (args.cec_device, args.cec_port, args.off_seconds, args.wake_timeout) == (0, None, 15, 60)
    assert parse("--only", "cec,ddc").only == ["cec", "ddc"]
    with pytest.raises(SystemExit):
        parse("--only", "cec,tv")


# CEC.


def test_cec_happy_path(ctx: Context, runner: FakeRunner, prompter: ScriptedPrompter, clock: FakeClock) -> None:
    cec_happy(runner)
    prompter.__init__(yes_no=[True], enter=[4.2])
    section = run_probe(ctx, "--only", "cec")
    assert statuses(section) == {
        "CEC adapter": Status.PASS,
        "CEC monitor": Status.PASS,
        "CEC power report": Status.PASS,
        "CEC standby": Status.PASS,
        "CEC wake": Status.PASS,
        "CEC power follows": Status.PASS,
        "Recommended back end": Status.INFO,
    }
    assert check(section, "CEC adapter").detail == "/dev/cec0"
    assert check(section, "CEC monitor").detail == "TV: vendor Samsung, name 'M80F'"
    assert check(section, "CEC power report").detail == "reports on"
    assert "reported: standby" in check(section, "CEC standby").detail
    assert check(section, "CEC wake").detail == "picture back after 4.2 s"
    assert section.fact_value("CEC vendor") == "Samsung"
    assert section.fact_value("CEC name") == "M80F"
    assert cec_calls(runner) == ["scan\n", "pow 0\n", "standby 0\n", "pow 0\n", "on 0\n", "as\n", "pow 0\n"]
    assert clock.sleeps == [5]
    assert prompter.questions == ["Did the monitor go to standby? [y/n]"]
    assert prompter.waits == [("Press Enter when the picture is back (waiting up to 60 s)", 60)]
    assert check(section, "Recommended back end").detail.startswith("cec:")
    assert {call.timeout for call in runner.calls} == {20}


def test_cec_uses_the_chosen_port_and_device(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["cec-client", "-l"], CEC_LIST)
    runner.on([*CEC, "/dev/cec1"], CEC_SCAN.replace("device #0", "device #5"), stdin="scan\n")
    runner.on([*CEC, "/dev/cec1"], POW_ON, stdin="pow 5\n")
    ctx.prompter.interactive = False  # type: ignore[misc]
    section = run_probe(ctx, "--only", "cec", "--cec-port", "/dev/cec1", "--cec-device", "5")
    assert check(section, "CEC monitor").status is Status.PASS
    assert check(section, "CEC power report").status is Status.PASS


def test_cec_without_cec_client(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["cec-client", "-l"], CommandMissing("cec-client"))
    section = run_probe(ctx, "--only", "cec")
    assert check(section, "CEC adapter").status is Status.FAIL
    assert check(section, "CEC adapter").detail == "cec-client is not installed (sudo apt install cec-utils)"
    assert check(section, "CEC monitor").status is Status.SKIP
    assert check(section, "CEC monitor").detail == "needs a CEC adapter"
    assert check(section, "Recommended back end").detail.startswith("black:")
    assert section.failed


def test_cec_with_no_adapter(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["cec-client", "-l"], CEC_LIST_NONE)
    section = run_probe(ctx, "--only", "cec")
    assert check(section, "CEC adapter").status is Status.FAIL
    assert "no CEC adapter found" in check(section, "CEC adapter").detail
    assert "video group" in check(section, "CEC adapter").detail
    skipped = [item.name for item in section.checks if item.status is Status.SKIP]
    assert skipped == ["CEC monitor", "CEC power report", "CEC standby", "CEC wake", "CEC power follows"]


def test_cec_timeout_is_a_failure(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["cec-client", "-l"], CEC_LIST)
    runner.on(CEC, CommandTimeout("cec-client", 20), stdin="scan\n")
    section = run_probe(ctx, "--only", "cec")
    assert check(section, "CEC monitor").status is Status.FAIL
    assert check(section, "CEC monitor").detail == "cec-client did not finish within 20 seconds"
    assert check(section, "CEC power report").status is Status.SKIP


def test_cec_monitor_not_answering(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["cec-client", "-l"], CEC_LIST)
    runner.on(CEC, CEC_SCAN_NO_TV, stdin="scan\n")
    section = run_probe(ctx, "--only", "cec")
    detail = check(section, "CEC monitor").detail
    assert check(section, "CEC monitor").status is Status.FAIL
    assert "no device at address 0 answered" in detail
    assert "Anynet+" in detail
    assert "--cec-port /dev/cec1" in detail
    assert check(section, "CEC standby").detail == "needs a CEC monitor that answers"
    assert cec_calls(runner) == ["scan\n"]


def test_cec_power_unknown(ctx: Context, runner: FakeRunner, prompter: ScriptedPrompter) -> None:
    cec_happy(runner, (POW_UNKNOWN,))
    prompter.__init__(yes_no=[True], enter=[2.0])
    section = run_probe(ctx, "--only", "cec")
    assert check(section, "CEC power report").status is Status.FAIL
    assert check(section, "CEC power report").detail == "does not report its power state (answered 'unknown')"
    assert check(section, "CEC standby").status is Status.PASS
    assert check(section, "CEC power follows").status is Status.FAIL
    assert "reported unknown while off" in check(section, "CEC power follows").detail


def test_cec_standby_answered_no(ctx: Context, runner: FakeRunner, prompter: ScriptedPrompter) -> None:
    cec_happy(runner, (POW_ON, POW_ON, POW_ON))
    prompter.__init__(yes_no=[False], enter=[1.0])
    section = run_probe(ctx, "--only", "cec")
    assert check(section, "CEC standby").status is Status.FAIL
    assert "reported: on" in check(section, "CEC standby").detail
    assert check(section, "CEC wake").status is Status.PASS  # waking is still tried
    assert check(section, "CEC power follows").status is Status.FAIL
    assert check(section, "Recommended back end").detail.startswith("black:")


def test_cec_wake_timeout(ctx: Context, runner: FakeRunner, prompter: ScriptedPrompter) -> None:
    cec_happy(runner)
    prompter.__init__(yes_no=[True], enter=[None])
    section = run_probe(ctx, "--only", "cec", "--wake-timeout", "30")
    assert check(section, "CEC wake").status is Status.FAIL
    assert check(section, "CEC wake").detail == "no picture within 30 s"
    assert prompter.waits == [("Press Enter when the picture is back (waiting up to 30 s)", 30)]
    assert check(section, "Recommended back end").detail.startswith("black:")


def test_cec_non_interactive_skips_what_needs_a_person(ctx: Context, runner: FakeRunner) -> None:
    cec_happy(runner)
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--only", "cec")
    for name in ("CEC standby", "CEC wake", "CEC power follows"):
        assert check(section, name).status is Status.SKIP
        assert check(section, name).detail == "needs someone watching the screen"
    assert cec_calls(runner) == ["scan\n", "pow 0\n"]  # nothing was switched
    assert not section.failed


@pytest.mark.parametrize(
    "raised",
    [
        {"yes_no": [KeyboardInterrupt], "enter": []},
        {"yes_no": [True], "enter": [KeyboardInterrupt]},
    ],
    ids=["during the question", "while waiting for the picture"],
)
def test_cec_wakes_the_monitor_when_stopped(ctx: Context, runner: FakeRunner, raised: dict) -> None:
    cec_happy(runner)
    ctx.prompter = ScriptedPrompter(**raised)
    with pytest.raises(KeyboardInterrupt):
        run_probe(ctx, "--only", "cec")
    stdins = cec_calls(runner)
    assert stdins[-1] != "standby 0\n"
    assert stdins.count("on 0\n") == 1  # once, wherever it was stopped


def test_cec_standby_failure_is_not_followed_by_a_blind_wake(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["cec-client", "-l"], CEC_LIST)
    runner.on(CEC, CEC_SCAN, stdin="scan\n")
    runner.on(CEC, POW_ON, stdin="pow 0\n")
    runner.on(CEC, CommandTimeout("cec-client", 20), stdin="standby 0\n")
    ctx.prompter = ScriptedPrompter()
    section = run_probe(ctx, "--only", "cec")
    assert check(section, "CEC standby").status is Status.FAIL
    assert check(section, "CEC wake").status is Status.SKIP
    assert "on 0\n" not in cec_calls(runner)


# HDMI output.


def test_output_happy_path(ctx: Context, runner: FakeRunner, prompter: ScriptedPrompter, clock: FakeClock) -> None:
    output_happy(runner)
    prompter.__init__(yes_no=[True, True], enter=[3.0])
    section = run_probe(ctx, "--only", "output")
    assert statuses(section) == {
        "Wayland session": Status.PASS,
        "HDMI outputs": Status.PASS,
        "Output off": Status.PASS,
        "Monitor sleeps without signal": Status.PASS,
        "Output wake": Status.PASS,
        "Recommended back end": Status.INFO,
    }
    assert check(section, "Wayland session").detail == "/run/user/1000/wayland-0"
    assert check(section, "HDMI outputs").detail == "HDMI-A-1, 2560x1440 @ 59.951 Hz"
    assert section.fact_value("Output mode") == "2560x1440 @ 59.951 Hz"
    assert check(section, "Output wake").detail == "picture back after 3.0 s"
    assert runner.argvs() == [
        ("wlr-randr",),
        ("wlopm", "--off", "HDMI-A-1"),
        ("wlopm", "--on", "HDMI-A-1"),
    ]
    assert all(call.env == SESSION_ENV and call.timeout == 10 for call in runner.calls)
    assert clock.sleeps == [2, 15]
    assert prompter.questions[0] == "Has the picture gone? [y/n]"
    assert prompter.questions[1].startswith("Has the monitor gone into standby")
    assert check(section, "Recommended back end").detail.startswith("output:")


def test_output_off_seconds_option(
    ctx: Context, runner: FakeRunner, prompter: ScriptedPrompter, clock: FakeClock
) -> None:
    output_happy(runner)
    prompter.__init__(yes_no=[True, True], enter=[3.0])
    run_probe(ctx, "--only", "output", "--off-seconds", "40")
    assert clock.sleeps == [2, 40]


def test_output_without_a_wayland_session(ctx: Context, runner: FakeRunner) -> None:
    section = run_probe(ctx, "--only", "output", session=None)
    assert check(section, "Wayland session").status is Status.FAIL
    assert "--wayland-display" in check(section, "Wayland session").detail
    for name in ("HDMI outputs", "Output off", "Monitor sleeps without signal", "Output wake"):
        assert check(section, name).status is Status.SKIP
        assert check(section, name).detail == "needs a Wayland session"
    assert runner.calls == []


def test_output_passes_the_wayland_display_option_to_the_finder(ctx: Context, runner: FakeRunner) -> None:
    seen: list[tuple] = []

    def finder(explicit, environ, uid):
        seen.append((explicit, uid))
        return None

    screen.run(
        parse("--only", "output", "--wayland-display", "wayland-1"),
        ctx,
        list_i2c=list,
        environ={},
        uid=1234,
        find_session=finder,
    )
    assert seen == [("wayland-1", 1234)]


def test_output_without_listing_tools(ctx: Context, runner: FakeRunner) -> None:
    ctx.which = lambda name: None
    section = run_probe(ctx, "--only", "output")
    assert check(section, "HDMI outputs").status is Status.FAIL
    assert "neither wlr-randr nor wlopm is installed" in check(section, "HDMI outputs").detail
    assert check(section, "Output off").status is Status.SKIP


def test_output_uses_wlopm_to_list_when_it_is_the_only_tool(ctx: Context, runner: FakeRunner, prompter) -> None:
    ctx.which = lambda name: "/usr/bin/wlopm" if name == "wlopm" else None
    runner.on(["wlopm"], WLOPM)
    runner.on(["wlopm", "--off", "HDMI-A-1"], "")
    runner.on(["wlopm", "--on", "HDMI-A-1"], "")
    prompter.__init__(yes_no=[True, True], enter=[1.5])
    section = run_probe(ctx, "--only", "output")
    assert check(section, "HDMI outputs").detail == "HDMI-A-1"
    assert section.fact_value("Output mode") is None
    assert check(section, "Output wake").status is Status.PASS


def test_output_uses_wlr_randr_to_switch_when_wlopm_is_missing(ctx: Context, runner: FakeRunner, prompter) -> None:
    ctx.which = lambda name: "/usr/bin/wlr-randr" if name == "wlr-randr" else None
    runner.on(["wlr-randr"], WLR_RANDR)
    runner.on(["wlr-randr", "--output", "HDMI-A-1", "--off"], "")
    runner.on(["wlr-randr", "--output", "HDMI-A-1", "--on"], "")
    prompter.__init__(yes_no=[True, True], enter=[1.5])
    section = run_probe(ctx, "--only", "output")
    assert check(section, "Output wake").status is Status.PASS


def test_output_listing_failure_falls_back_to_the_other_tool(ctx: Context, runner: FakeRunner, prompter) -> None:
    runner.on(["wlr-randr"], result(stderr="failed to connect to display\n", returncode=1))
    runner.on(["wlopm"], WLOPM)
    runner.on(["wlopm", "--off", "HDMI-A-1"], "")
    runner.on(["wlopm", "--on", "HDMI-A-1"], "")
    prompter.__init__(yes_no=[True, True], enter=[1.5])
    section = run_probe(ctx, "--only", "output")
    assert check(section, "HDMI outputs").status is Status.PASS


def test_output_listing_failure_is_reported(ctx: Context, runner: FakeRunner) -> None:
    ctx.which = lambda name: "/usr/bin/wlr-randr" if name == "wlr-randr" else None
    runner.on(["wlr-randr"], result(stderr="failed to connect to display\n", returncode=1))
    section = run_probe(ctx, "--only", "output")
    assert check(section, "HDMI outputs").status is Status.FAIL
    assert check(section, "HDMI outputs").detail == "wlr-randr failed: failed to connect to display"


def test_output_option_picks_a_named_output(ctx: Context, runner: FakeRunner, prompter) -> None:
    two = (
        WLR_RANDR + 'HDMI-A-2 "Other"\n  Enabled: yes\n  Modes:\n    1920x1080 px, 60.000000 Hz (preferred, current)\n'
    )
    runner.on(["wlr-randr"], two)
    runner.on(["wlopm", "--off", "HDMI-A-2"], "")
    runner.on(["wlopm", "--on", "HDMI-A-2"], "")
    prompter.__init__(yes_no=[True, True], enter=[1.0])
    section = run_probe(ctx, "--only", "output", "--output", "HDMI-A-2")
    assert check(section, "HDMI outputs").detail == "HDMI-A-2, 1920x1080 @ 60.000 Hz"
    missing = run_probe(ctx, "--only", "output", "--output", "DP-1")
    assert check(missing, "HDMI outputs").status is Status.FAIL
    assert "no output named DP-1; found HDMI-A-1, HDMI-A-2" in check(missing, "HDMI outputs").detail


def test_output_first_enabled_is_chosen(ctx: Context, runner: FakeRunner, prompter) -> None:
    text = 'DP-1 "Off one"\n  Enabled: no\n' + WLR_RANDR
    runner.on(["wlr-randr"], text)
    runner.on(["wlopm", "--off", "HDMI-A-1"], "")
    runner.on(["wlopm", "--on", "HDMI-A-1"], "")
    prompter.__init__(yes_no=[True, True], enter=[1.0])
    section = run_probe(ctx, "--only", "output")
    assert check(section, "HDMI outputs").detail.startswith("HDMI-A-1,")


def test_output_non_interactive_changes_nothing(ctx: Context, runner: FakeRunner) -> None:
    output_happy(runner)
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--only", "output")
    assert check(section, "HDMI outputs").status is Status.PASS
    for name in ("Output off", "Monitor sleeps without signal", "Output wake"):
        assert check(section, name).status is Status.SKIP
        assert check(section, name).detail == "needs someone watching the screen"
    assert runner.argvs() == [("wlr-randr",)]


def test_output_picture_stayed_and_the_output_is_put_back(ctx: Context, runner: FakeRunner, prompter) -> None:
    output_happy(runner)
    prompter.__init__(yes_no=[False])
    section = run_probe(ctx, "--only", "output")
    assert check(section, "Output off").status is Status.FAIL
    assert check(section, "Monitor sleeps without signal").status is Status.SKIP
    assert check(section, "Output wake").status is Status.SKIP
    assert runner.argvs()[-1] == ("wlopm", "--on", "HDMI-A-1")


def test_output_monitor_stays_lit(ctx: Context, runner: FakeRunner, prompter) -> None:
    output_happy(runner)
    prompter.__init__(yes_no=[True, False], enter=[2.0])
    section = run_probe(ctx, "--only", "output")
    assert check(section, "Monitor sleeps without signal").status is Status.FAIL
    assert check(section, "Output wake").status is Status.PASS
    assert check(section, "Recommended back end").detail.startswith("black:")


def test_output_wake_timeout(ctx: Context, runner: FakeRunner, prompter) -> None:
    output_happy(runner)
    prompter.__init__(yes_no=[True, True], enter=[None])
    section = run_probe(ctx, "--only", "output", "--wake-timeout", "20")
    assert check(section, "Output wake").status is Status.FAIL
    assert check(section, "Output wake").detail == "no picture within 20 s"


def test_output_switch_command_failure(ctx: Context, runner: FakeRunner, prompter) -> None:
    runner.on(["wlr-randr"], WLR_RANDR)
    runner.on(["wlopm", "--off", "HDMI-A-1"], result(stderr="no such output\n", returncode=1))
    section = run_probe(ctx, "--only", "output")
    assert check(section, "Output off").status is Status.FAIL
    assert check(section, "Output off").detail == "wlopm failed: no such output"
    assert check(section, "Output wake").status is Status.SKIP


@pytest.mark.parametrize(
    "queue",
    [
        {"yes_no": [KeyboardInterrupt], "enter": []},
        {"yes_no": [True, KeyboardInterrupt], "enter": []},
        {"yes_no": [True, True], "enter": [KeyboardInterrupt]},
    ],
    ids=["after switching off", "while it sleeps", "waiting for the picture"],
)
def test_output_is_switched_back_on_when_stopped(ctx: Context, runner: FakeRunner, queue: dict) -> None:
    output_happy(runner)
    ctx.prompter = ScriptedPrompter(**queue)
    with pytest.raises(KeyboardInterrupt):
        run_probe(ctx, "--only", "output")
    assert runner.argvs()[-1] == ("wlopm", "--on", "HDMI-A-1")
    assert runner.argvs().count(("wlopm", "--on", "HDMI-A-1")) == 1


# DDC/CI.


def test_ddc_happy_path(ctx: Context, runner: FakeRunner, prompter: ScriptedPrompter, clock: FakeClock) -> None:
    ddc_happy(runner)
    prompter.__init__(yes_no=[True])
    section = run_probe(ctx, "--only", "ddc")
    assert statuses(section) == {
        "I2C buses": Status.PASS,
        "DDC/CI monitor": Status.PASS,
        "DDC brightness read": Status.PASS,
        "DDC brightness write": Status.PASS,
        "Recommended back end": Status.INFO,
    }
    assert check(section, "I2C buses").detail == "1 found"
    assert check(section, "DDC/CI monitor").detail == "display 1 on /dev/i2c-20, Samsung M80F"
    assert section.fact_value("DDC monitor") == "Samsung M80F"
    assert check(section, "DDC brightness read").detail == "50 of 100 (took 0.1 s)"
    write = check(section, "DDC brightness write")
    assert write.detail == "set 20, read back 20; restored to 50"
    assert runner.argvs() == [
        ("ddcutil", "detect"),
        ("ddcutil", "--bus", "20", "getvcp", "10"),
        ("ddcutil", "--bus", "20", "setvcp", "10", "20"),
        ("ddcutil", "--bus", "20", "getvcp", "10"),
        ("ddcutil", "--bus", "20", "setvcp", "10", "50"),
    ]
    assert clock.sleeps == [2]
    assert prompter.questions == ["Did the brightness change? [y/n]"]
    assert "DDC/CI brightness works" in section.notes[0]


def test_ddc_without_i2c_devices(ctx: Context, runner: FakeRunner) -> None:
    section = run_probe(ctx, "--only", "ddc", i2c=[])
    assert check(section, "I2C buses").status is Status.FAIL
    assert "sudo modprobe i2c-dev" in check(section, "I2C buses").detail
    assert "/etc/modules-load.d/" in check(section, "I2C buses").detail
    for name in ("DDC/CI monitor", "DDC brightness read", "DDC brightness write"):
        assert check(section, name).status is Status.SKIP
    assert runner.calls == []


def test_ddc_without_ddcutil(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["ddcutil", "detect"], CommandMissing("ddcutil"))
    section = run_probe(ctx, "--only", "ddc")
    assert check(section, "DDC/CI monitor").detail == "ddcutil is not installed (sudo apt install ddcutil)"
    assert check(section, "DDC brightness read").status is Status.SKIP


def test_ddc_invalid_display(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["ddcutil", "detect"], DDC_INVALID)
    section = run_probe(ctx, "--only", "ddc")
    monitor = check(section, "DDC/CI monitor")
    assert monitor.status is Status.FAIL
    assert "no display answered over DDC/CI (DDC communication failed)" in monitor.detail
    assert "'PC mode'" in monitor.detail
    assert check(section, "DDC brightness read").detail == "needs a monitor that answers over DDC/CI"
    assert "does not work" in section.notes[0]


def test_ddc_no_displays_with_a_failing_exit(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["ddcutil", "detect"], result(DDC_NONE, returncode=1))
    section = run_probe(ctx, "--only", "ddc")
    assert check(section, "DDC/CI monitor").status is Status.FAIL
    assert "(No displays found)" in check(section, "DDC/CI monitor").detail


def test_ddc_permission_problem_is_reported(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["ddcutil", "detect"], result(stderr="Permission denied: /dev/i2c-20\n", returncode=1))
    section = run_probe(ctx, "--only", "ddc")
    assert "(Permission denied: /dev/i2c-20)" in check(section, "DDC/CI monitor").detail


def test_ddc_brightness_read_failure(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["ddcutil", "detect"], DDC_DETECT)
    runner.on(["ddcutil", "--bus", "20", "getvcp", "10"], result(stderr="VCP code 0x10: not supported\n", returncode=1))
    section = run_probe(ctx, "--only", "ddc")
    assert check(section, "DDC brightness read").status is Status.FAIL
    assert "not supported" in check(section, "DDC brightness read").detail
    assert check(section, "DDC brightness write").status is Status.SKIP
    assert "does not work" in section.notes[0]


def test_ddc_write_when_the_picture_did_not_change(ctx: Context, runner: FakeRunner, prompter) -> None:
    ddc_happy(runner)
    prompter.__init__(yes_no=[False])
    section = run_probe(ctx, "--only", "ddc")
    write = check(section, "DDC brightness write")
    assert write.status is Status.FAIL
    assert "accepted the value but the picture did not change" in write.detail
    assert write.detail.endswith("restored to 50")
    assert runner.argvs()[-1] == ("ddcutil", "--bus", "20", "setvcp", "10", "50")


def test_ddc_write_read_back_differs(ctx: Context, runner: FakeRunner) -> None:
    ddc_happy(runner, (50, 50))
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--only", "ddc")
    write = check(section, "DDC brightness write")
    assert write.status is Status.FAIL
    assert write.detail == "set 20 but read back 50; restored to 50"


def test_ddc_write_tolerates_one_step_of_rounding(ctx: Context, runner: FakeRunner) -> None:
    ddc_happy(runner, (50, 21))
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--only", "ddc")
    assert check(section, "DDC brightness write").status is Status.PASS


def test_ddc_non_interactive_asks_nothing(ctx: Context, runner: FakeRunner) -> None:
    ddc_happy(runner)
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--only", "ddc")
    assert check(section, "DDC brightness write").status is Status.PASS
    assert ctx.prompter.questions == []  # type: ignore[attr-defined]


def test_ddc_low_brightness_goes_up_and_is_clamped(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["ddcutil", "detect"], DDC_DETECT)
    runner.on(["ddcutil", "--bus", "20", "getvcp", "10"], vcp(40, 60), vcp(60, 60))
    runner.on(["ddcutil", "--bus", "20", "setvcp", "10", "60"], "")  # 40 + 30 is clamped to the maximum, 60
    runner.on(["ddcutil", "--bus", "20", "setvcp", "10", "40"], "")
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--only", "ddc")
    assert check(section, "DDC brightness write").detail == "set 60, read back 60; restored to 40"


def test_ddc_high_brightness_clamps_at_zero(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["ddcutil", "detect"], DDC_DETECT)
    runner.on(["ddcutil", "--bus", "20", "getvcp", "10"], vcp(50, 20), vcp(20, 20))
    runner.on(["ddcutil", "--bus", "20", "setvcp", "10", "20"], "")
    runner.on(["ddcutil", "--bus", "20", "setvcp", "10", "50"], "")
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--only", "ddc")
    assert check(section, "DDC brightness write").status is Status.PASS


def test_ddc_set_failure_still_restores(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["ddcutil", "detect"], DDC_DETECT)
    runner.on(["ddcutil", "--bus", "20", "getvcp", "10"], vcp(50))
    runner.on(["ddcutil", "--bus", "20", "setvcp", "10", "20"], result(stderr="Display busy\n", returncode=1))
    runner.on(["ddcutil", "--bus", "20", "setvcp", "10", "50"], "")
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--only", "ddc")
    write = check(section, "DDC brightness write")
    assert write.status is Status.FAIL
    assert "could not set the brightness: Display busy" in write.detail
    assert write.detail.endswith("restored to 50")


def test_ddc_restore_failure_is_a_failure(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["ddcutil", "detect"], DDC_DETECT)
    runner.on(["ddcutil", "--bus", "20", "getvcp", "10"], vcp(50), vcp(20))
    runner.on(["ddcutil", "--bus", "20", "setvcp", "10", "20"], "")
    runner.on(["ddcutil", "--bus", "20", "setvcp", "10", "50"], CommandTimeout("ddcutil", 20))
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--only", "ddc")
    write = check(section, "DDC brightness write")
    assert write.status is Status.FAIL
    assert "could NOT restore to 50" in write.detail


def test_ddc_brightness_is_restored_when_stopped(ctx: Context, runner: FakeRunner) -> None:
    ddc_happy(runner)
    ctx.prompter = ScriptedPrompter(yes_no=[KeyboardInterrupt])
    with pytest.raises(KeyboardInterrupt):
        run_probe(ctx, "--only", "ddc")
    assert runner.argvs()[-1] == ("ddcutil", "--bus", "20", "setvcp", "10", "50")


# Selecting parts, and the recommendation.


def test_only_runs_the_chosen_parts(ctx: Context, runner: FakeRunner) -> None:
    ddc_happy(runner)
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--only", "ddc")
    assert section.checks[0].name == "I2C buses"
    assert not any(item.name.startswith(("CEC", "HDMI", "Wayland")) for item in section.checks)


def test_skip_leaves_parts_out(ctx: Context, runner: FakeRunner) -> None:
    runner.on(["cec-client", "-l"], CEC_LIST_NONE)
    ctx.prompter = ScriptedPrompter(interactive=False)
    section = run_probe(ctx, "--skip", "output,ddc")
    assert section.checks[0].name == "CEC adapter"
    assert not any(item.name.startswith(("HDMI", "I2C", "DDC")) for item in section.checks)


def test_all_parts_run_in_order_and_recommend_cec(ctx: Context, runner: FakeRunner, prompter) -> None:
    cec_happy(runner)
    output_happy(runner)
    ddc_happy(runner)
    prompter.__init__(yes_no=[True, True, True, True], enter=[4.2, 3.0])
    section = run_probe(ctx)
    names = [item.name for item in section.checks]
    assert names == [
        "CEC adapter",
        "CEC monitor",
        "CEC power report",
        "CEC standby",
        "CEC wake",
        "CEC power follows",
        "Wayland session",
        "HDMI outputs",
        "Output off",
        "Monitor sleeps without signal",
        "Output wake",
        "I2C buses",
        "DDC/CI monitor",
        "DDC brightness read",
        "DDC brightness write",
        "Recommended back end",
    ]
    assert not section.failed
    assert check(section, "Recommended back end").detail.startswith("cec:")


def test_recommends_output_when_cec_does_not_work(ctx: Context, runner: FakeRunner, prompter) -> None:
    cec_happy(runner, (POW_ON, POW_ON, POW_ON))
    output_happy(runner)
    # CEC standby: no, then the output steps: gone, sleeps; the CEC wake and output wake presses come in order.
    prompter.__init__(yes_no=[False, True, True], enter=[1.0, 2.0])
    section = run_probe(ctx, "--skip", "ddc")
    assert check(section, "CEC standby").status is Status.FAIL
    assert check(section, "Recommended back end").detail.startswith("output:")


def test_recommends_black_when_nothing_switched(ctx: Context, runner: FakeRunner) -> None:
    ctx.prompter = ScriptedPrompter(interactive=False)
    runner.on(["cec-client", "-l"], CEC_LIST_NONE)
    section = run_probe(ctx, "--skip", "ddc", session=None)
    recommendation = check(section, "Recommended back end")
    assert recommendation.status is Status.INFO
    assert recommendation.detail.startswith("black:")
    assert section.failed
