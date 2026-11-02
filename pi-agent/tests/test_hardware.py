from pathlib import Path

import pytest

from wallcal_agent.config import CecConfig, OutputConfig, ScreenConfig
from wallcal_agent.hardware import Hardware, ScreenError, build_hardware
from wallcal_agent.hardware.fake import FakeScreen, FakeSystemInfo
from wallcal_agent.hardware.linux import LinuxSystemInfo
from wallcal_agent.hardware.screen import BlackScreen, CecScreen, OutputScreen


def test_fake_defaults_and_settable_values() -> None:
    fake = FakeSystemInfo()

    assert fake.cpu_temperature() == 45.0
    assert fake.uptime_seconds() == 0.0

    fake.temperature = None
    fake.uptime = 12.5

    assert fake.cpu_temperature() is None
    assert fake.uptime_seconds() == 12.5


def test_fake_uptime_advances_with_a_clock() -> None:
    now = [100.0]
    fake = FakeSystemInfo(uptime=10.0, clock=lambda: now[0])

    now[0] = 130.0

    assert fake.uptime_seconds() == 40.0


def test_build_hardware_gives_fake_or_linux() -> None:
    assert isinstance(build_hardware(fake=True, screen=ScreenConfig()).system, FakeSystemInfo)
    assert isinstance(build_hardware(fake=False, screen=ScreenConfig()).system, LinuxSystemInfo)
    assert isinstance(build_hardware(fake=True, screen=ScreenConfig()), Hardware)


def test_fake_hardware_has_a_pretend_panel_whatever_the_config_says() -> None:
    for backend in ("black", "cec", "output"):
        screen = build_hardware(fake=True, screen=ScreenConfig(backend=backend)).screen

        assert isinstance(screen, FakeScreen)
        assert screen.read_power() is True


@pytest.mark.parametrize(
    ("backend", "expected"), [("black", BlackScreen), ("cec", CecScreen), ("output", OutputScreen)]
)
def test_build_hardware_picks_the_screen_back_end_from_the_config(backend: str, expected: type) -> None:
    config = ScreenConfig(backend=backend, cec=CecConfig(device=4), output=OutputConfig(name="DP-1"))

    assert type(build_hardware(fake=False, screen=config).screen) is expected


def test_fake_screen_follows_requests_and_records_them() -> None:
    fake = FakeScreen()

    assert fake.read_power() is None
    fake.set_power(True)
    fake.set_power(False)

    assert fake.set_calls == [True, False]
    assert fake.read_power() is False
    assert fake.read_count == 2


def test_fake_screen_can_ignore_requests() -> None:
    fake = FakeScreen(power=True)
    fake.applies_requests = False

    fake.set_power(False)

    assert fake.set_calls == [False]
    assert fake.read_power() is True


def test_fake_screen_can_be_told_to_fail() -> None:
    fake = FakeScreen(power=True)
    fake.set_error = "no adapter"
    fake.read_error = "timed out"

    with pytest.raises(ScreenError, match="no adapter"):
        fake.set_power(False)
    with pytest.raises(ScreenError, match="timed out"):
        fake.read_power()

    # The request was made, but it did not change the panel.
    assert fake.set_calls == [False]
    assert fake.power is True


def test_fake_screen_runs_its_hook_during_a_request() -> None:
    fake = FakeScreen()
    seen: list[bool] = []
    fake.on_set = seen.append

    fake.set_power(True)

    assert seen == [True]


def test_fake_hardware_uptime_moves_on_its_own() -> None:
    system = build_hardware(fake=True, screen=ScreenConfig()).system

    assert system.uptime_seconds() >= 0.0
    first = system.uptime_seconds()
    assert system.uptime_seconds() >= first


def test_linux_reads_millidegrees_and_uptime(tmp_path: Path) -> None:
    thermal = tmp_path / "temp"
    thermal.write_text("48312\n")
    uptime = tmp_path / "uptime"
    uptime.write_text("12345.67 54321.00\n")
    system = LinuxSystemInfo(thermal_path=thermal, uptime_path=uptime)

    assert system.cpu_temperature() == pytest.approx(48.312)
    assert system.uptime_seconds() == pytest.approx(12345.67)


@pytest.mark.parametrize("content", ["", "abc", "48.3", "\n"])
def test_linux_garbled_temperature_is_none(tmp_path: Path, content: str) -> None:
    thermal = tmp_path / "temp"
    thermal.write_text(content)

    assert LinuxSystemInfo(thermal_path=thermal).cpu_temperature() is None


def test_linux_missing_temperature_is_none_and_logged_once(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    system = LinuxSystemInfo(thermal_path=tmp_path / "nope")

    with caplog.at_level("DEBUG", logger="wallcal_agent.hardware.linux"):
        assert system.cpu_temperature() is None
        assert system.cpu_temperature() is None
        assert system.cpu_temperature() is None

    assert len(caplog.records) == 1


def test_linux_temperature_logs_again_after_it_recovers(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    thermal = tmp_path / "temp"
    system = LinuxSystemInfo(thermal_path=thermal)

    with caplog.at_level("DEBUG", logger="wallcal_agent.hardware.linux"):
        assert system.cpu_temperature() is None
        thermal.write_text("50000")
        assert system.cpu_temperature() == 50.0
        thermal.unlink()
        assert system.cpu_temperature() is None

    assert len(caplog.records) == 2


@pytest.mark.parametrize("content", ["", "soon"])
def test_linux_unreadable_uptime_raises(tmp_path: Path, content: str) -> None:
    uptime = tmp_path / "uptime"
    uptime.write_text(content)

    with pytest.raises(ValueError, match=r"."):
        LinuxSystemInfo(uptime_path=uptime).uptime_seconds()


def test_linux_missing_uptime_raises_oserror(tmp_path: Path) -> None:
    with pytest.raises(OSError, match=r"."):
        LinuxSystemInfo(uptime_path=tmp_path / "nope").uptime_seconds()
