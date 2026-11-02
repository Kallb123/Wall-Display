"""The screen back ends, against a fake command runner: what each one runs, and how it reads the answer."""

import subprocess
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import pytest

from wallcal_agent.config import CecConfig, OutputConfig, ScreenConfig
from wallcal_agent.hardware import ScreenError
from wallcal_agent.hardware.screen import (
    BlackScreen,
    CecScreen,
    OutputScreen,
    build_screen,
    subprocess_runner,
)


@dataclass(frozen=True)
class Call:
    argv: tuple[str, ...]
    stdin: str | None
    env: dict[str, str] | None


@dataclass
class FakeRunner:
    """Records each command, and answers with the next of `outputs` (or raises the next error)."""

    outputs: list[str | Exception] = field(default_factory=list)
    calls: list[Call] = field(default_factory=list)

    def __call__(self, argv: Sequence[str], *, stdin: str | None = None, env: Mapping[str, str] | None = None) -> str:
        self.calls.append(Call(tuple(argv), stdin, dict(env) if env is not None else None))
        if not self.outputs:
            return ""
        answer = self.outputs.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def runner_saying(*outputs: str | Exception) -> FakeRunner:
    return FakeRunner(outputs=list(outputs))


# black


def test_black_does_nothing_and_reports_the_last_request() -> None:
    screen = BlackScreen()

    assert screen.read_power() is None
    screen.set_power(False)
    assert screen.read_power() is False
    screen.set_power(True)
    assert screen.read_power() is True


# cec

CEC_ARGV = ("cec-client", "-s", "-d", "1")


@pytest.mark.parametrize(("on", "stdin"), [(True, "on 0\n"), (False, "standby 0\n")])
def test_cec_set_power_sends_one_command_on_stdin(on: bool, stdin: str) -> None:
    runner = runner_saying()

    CecScreen(CecConfig(), runner).set_power(on)

    assert runner.calls == [Call(CEC_ARGV, stdin, None)]


def test_cec_uses_the_configured_device() -> None:
    runner = runner_saying("power status: on\n")
    screen = CecScreen(CecConfig(device=5), runner)

    screen.set_power(False)
    screen.read_power()

    assert [call.stdin for call in runner.calls] == ["standby 5\n", "pow 5\n"]


# What cec-client -s -d 1 prints for `pow 0`, with its other output (and a chatty first line) around it.
CEC_ON = "power status: on\n"
CEC_STANDBY = "power status: standby\n"
CEC_NOISY = "opening a connection to the CEC adapter...\npower status: standby\n"


@pytest.mark.parametrize(
    ("output", "expected"),
    [
        (CEC_ON, True),
        (CEC_STANDBY, False),
        (CEC_NOISY, False),
        ("power status: on", True),
        ("power status:standby", False),
        ("POWER STATUS: ON\r\n", True),
        ("power status: in transition from standby to on\n", True),
        ("power status: in transition from on to standby\n", False),
        ("power status: unknown\n", None),
        ("power status: \n", None),
        ("power status: warming up\n", None),
        ("", None),
        ("no adapter found\n", None),
        ("the power status: on", None),
    ],
)
def test_cec_reads_power_status(output: str, expected: bool | None) -> None:
    runner = runner_saying(output)

    assert CecScreen(CecConfig(), runner).read_power() is expected
    assert runner.calls == [Call(CEC_ARGV, "pow 0\n", None)]


def test_cec_errors_are_passed_on() -> None:
    error = ScreenError("cec-client is not installed")

    with pytest.raises(ScreenError, match="not installed"):
        CecScreen(CecConfig(), runner_saying(error)).set_power(True)
    with pytest.raises(ScreenError, match="not installed"):
        CecScreen(CecConfig(), runner_saying(error)).read_power()


# output

SOCKET = "/run/user/1000/wayland-0"
ENV = {"WAYLAND_DISPLAY": SOCKET, "XDG_RUNTIME_DIR": "/run/user/1000"}


def wlopm_screen(runner: FakeRunner, name: str = "HDMI-A-1", socket: str = SOCKET) -> OutputScreen:
    return OutputScreen(OutputConfig(tool="wlopm", name=name, wayland_display=socket), runner)


def randr_screen(runner: FakeRunner, name: str = "HDMI-A-1", socket: str = SOCKET) -> OutputScreen:
    return OutputScreen(OutputConfig(tool="wlr-randr", name=name, wayland_display=socket), runner)


@pytest.mark.parametrize(("on", "flag"), [(True, "--on"), (False, "--off")])
def test_wlopm_set_power(on: bool, flag: str) -> None:
    runner = runner_saying()

    wlopm_screen(runner).set_power(on)

    assert runner.calls == [Call(("wlopm", flag, "HDMI-A-1"), None, ENV)]


@pytest.mark.parametrize(("on", "flag"), [(True, "--on"), (False, "--off")])
def test_wlr_randr_set_power(on: bool, flag: str) -> None:
    runner = runner_saying()

    randr_screen(runner).set_power(on)

    assert runner.calls == [Call(("wlr-randr", "--output", "HDMI-A-1", flag), None, ENV)]


def test_the_environment_follows_the_socket_path() -> None:
    runner = runner_saying()

    wlopm_screen(runner, socket="/run/user/1001/wayland-1").set_power(True)

    assert runner.calls[0].env == {"WAYLAND_DISPLAY": "/run/user/1001/wayland-1", "XDG_RUNTIME_DIR": "/run/user/1001"}


def test_the_output_name_is_used() -> None:
    runner = runner_saying()

    wlopm_screen(runner, name="DP-2").set_power(False)

    assert runner.calls[0].argv == ("wlopm", "--off", "DP-2")


WLOPM_LIST = "HDMI-A-1 on\nDP-1 off\n"


@pytest.mark.parametrize(
    ("output", "name", "expected"),
    [
        (WLOPM_LIST, "HDMI-A-1", True),
        (WLOPM_LIST, "DP-1", False),
        ("HDMI-A-1 off\n", "HDMI-A-1", False),
        ("HDMI-A-1 on", "HDMI-A-1", True),
        ("  HDMI-A-1   off  \r\n", "HDMI-A-1", False),
        # Not the output asked about: HDMI-A-1 must not match HDMI-A-10, and an unknown output is not a guess.
        ("HDMI-A-10 on\n", "HDMI-A-1", None),
        (WLOPM_LIST, "HDMI-A-2", None),
        ("HDMI-A-1 suspend\n", "HDMI-A-1", None),
        ("HDMI-A-1\n", "HDMI-A-1", None),
        ("", "HDMI-A-1", None),
        ("failed to connect to a Wayland compositor\n", "HDMI-A-1", None),
    ],
)
def test_wlopm_reads_the_listing(output: str, name: str, expected: bool | None) -> None:
    runner = runner_saying(output)

    assert wlopm_screen(runner, name=name).read_power() is expected
    assert runner.calls == [Call(("wlopm",), None, ENV)]


# What `wlr-randr` prints: a block per output, the name at column 0 and the details indented.
RANDR_TWO_OUTPUTS = """\
HDMI-A-1 "Dell Inc. DELL U2412M ABC123 (HDMI-A-1)"
  Make: Dell Inc.
  Model: DELL U2412M
  Serial: ABC123
  Physical size: 520x320 mm
  Enabled: yes
  Modes:
    1920x1200 px, 59.950 Hz (preferred, current)
    1920x1080 px, 60.000 Hz
  Position: 0,0
  Transform: normal
  Scale: 1.000000
  Adaptive Sync: disabled
HDMI-A-2 "Philips Consumer Electronics Company 22PFS (HDMI-A-2)"
  Make: Philips Consumer Electronics Company
  Model: 22PFS
  Enabled: no
  Modes:
    1920x1080 px, 60.000 Hz (preferred)
  Position: 0,0
  Transform: normal
  Scale: 1.000000
"""


@pytest.mark.parametrize(
    ("name", "expected"), [("HDMI-A-1", True), ("HDMI-A-2", False), ("HDMI-A-3", None), ("HDMI-A", None)]
)
def test_wlr_randr_reads_the_enabled_line_of_the_named_block(name: str, expected: bool | None) -> None:
    runner = runner_saying(RANDR_TWO_OUTPUTS)

    assert randr_screen(runner, name=name).read_power() is expected
    assert runner.calls == [Call(("wlr-randr",), None, ENV)]


def test_wlr_randr_does_not_take_another_blocks_enabled_line() -> None:
    # HDMI-A-1 has no Enabled line here; the one below belongs to HDMI-A-2.
    output = 'HDMI-A-1 "Panel"\n  Make: X\nHDMI-A-2 "Other"\n  Enabled: no\n'

    assert randr_screen(runner_saying(output)).read_power() is None


@pytest.mark.parametrize(
    "output",
    [
        "",
        "failed to connect to a Wayland compositor\n",
        'HDMI-A-1 "Panel"\n  Enabled: maybe\n',
        'HDMI-A-1 "Panel"\n  Make: X\n',
    ],
)
def test_wlr_randr_unknown_is_none(output: str) -> None:
    assert randr_screen(runner_saying(output)).read_power() is None


def test_output_errors_are_passed_on() -> None:
    error = ScreenError("wlopm exited with status 1")

    with pytest.raises(ScreenError, match="status 1"):
        wlopm_screen(runner_saying(error)).set_power(False)
    with pytest.raises(ScreenError, match="status 1"):
        randr_screen(runner_saying(error)).read_power()


# build_screen


def test_build_screen_passes_the_config_through() -> None:
    cec = build_screen(ScreenConfig(backend="cec", cec=CecConfig(device=3)))
    output = build_screen(ScreenConfig(backend="output", output=OutputConfig(tool="wlr-randr", name="DP-9")))

    assert isinstance(build_screen(ScreenConfig()), BlackScreen)
    assert isinstance(cec, CecScreen)
    assert isinstance(output, OutputScreen)


# The real runner


def test_the_real_runner_starts_the_program_without_a_shell(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}

    def fake_run(argv: Any, **kwargs: Any) -> subprocess.CompletedProcess[str]:
        seen["argv"] = argv
        seen.update(kwargs)
        return subprocess.CompletedProcess(argv, 0, stdout="out", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setenv("PATH_KEPT", "yes")

    output = subprocess_runner(7)(["wlopm", "--on", "HDMI-A-1; rm -rf /"], stdin="x", env={"WAYLAND_DISPLAY": "/s"})

    assert output == "out"
    assert seen["argv"] == ["wlopm", "--on", "HDMI-A-1; rm -rf /"]
    assert seen["input"] == "x"
    assert seen["timeout"] == 7
    assert seen["capture_output"] is True
    assert seen["text"] is True
    assert not seen.get("shell")
    assert seen["env"]["WAYLAND_DISPLAY"] == "/s"
    assert seen["env"]["PATH_KEPT"] == "yes"


def test_the_real_runner_leaves_the_environment_alone_without_extra_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}

    def fake_run(argv: Any, **kwargs: Any) -> subprocess.CompletedProcess[str]:
        seen.update(kwargs)
        return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    subprocess_runner(7)(["cec-client"], stdin="on 0\n")

    assert seen["env"] is None


def test_the_real_runner_returns_what_the_program_prints() -> None:
    run = subprocess_runner(10)

    assert run([sys.executable, "-c", "import sys; print(sys.stdin.read().upper())"], stdin="power status: on") == (
        "POWER STATUS: ON\n"
    )


def test_the_real_runner_passes_the_environment() -> None:
    run = subprocess_runner(10)

    output = run(
        [sys.executable, "-c", "import os; print(os.environ['WAYLAND_DISPLAY'])"], env={"WAYLAND_DISPLAY": "/s"}
    )

    assert output == "/s\n"


def test_a_missing_program_is_a_screen_error() -> None:
    with pytest.raises(ScreenError, match=r"^wallcal-no-such-program is not installed$"):
        subprocess_runner(10)(["wallcal-no-such-program"])


def test_a_program_that_cannot_be_run_is_a_screen_error(tmp_path: Any) -> None:
    not_executable = tmp_path / "tool"
    not_executable.write_text("#!/bin/sh\n")
    not_executable.chmod(0o644)

    with pytest.raises(ScreenError, match="could not be run"):
        subprocess_runner(10)([str(not_executable)])


def test_a_failing_program_is_a_screen_error_with_its_first_line() -> None:
    code = "import sys; sys.stderr.write('\\nno adapter found\\nsecond line\\n'); sys.exit(3)"

    with pytest.raises(ScreenError) as error:
        subprocess_runner(10)([sys.executable, "-c", code])

    assert "exited with status 3: no adapter found" in str(error.value)
    assert "second line" not in str(error.value)


def test_a_failing_program_with_no_message_is_still_a_short_error() -> None:
    with pytest.raises(ScreenError) as error:
        subprocess_runner(10)([sys.executable, "-c", "import sys; sys.exit(1)"])

    assert str(error.value).endswith("exited with status 1")


def test_a_long_failure_message_is_cut_short() -> None:
    code = "import sys; sys.stderr.write('x' * 5000); sys.exit(1)"

    with pytest.raises(ScreenError) as error:
        subprocess_runner(10)([sys.executable, "-c", code])

    assert len(str(error.value)) < 400


def test_a_program_that_takes_too_long_is_a_screen_error() -> None:
    with pytest.raises(ScreenError, match=r"did not finish within 1 seconds"):
        subprocess_runner(1)([sys.executable, "-c", "import time; time.sleep(30)"])
