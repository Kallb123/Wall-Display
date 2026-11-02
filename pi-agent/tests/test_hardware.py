from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from gpiozero import Device
from gpiozero.pins.mock import MockFactory

from wallcal_agent.config import ButtonConfig, CecConfig, Config, MqttConfig, OutputConfig, ScreenConfig, SensorsConfig
from wallcal_agent.hardware import ButtonError, Hardware, ScreenError, build_hardware
from wallcal_agent.hardware.fake import FakeButton, FakeScreen, FakeSystemInfo
from wallcal_agent.hardware.gpio import GpioButton
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


def make_config(
    screen: ScreenConfig | None = None, button: ButtonConfig | None = None, sensors: SensorsConfig | None = None
) -> Config:
    return Config(
        display_id="hallway",
        mqtt=MqttConfig(host="broker.test", client_id="wallcal-pi-hallway"),
        screen=screen or ScreenConfig(),
        button=button or ButtonConfig(),
        sensors=sensors or SensorsConfig(),
    )


def test_build_hardware_gives_fake_or_linux() -> None:
    assert isinstance(build_hardware(fake=True, config=make_config()).system, FakeSystemInfo)
    assert isinstance(build_hardware(fake=False, config=make_config()).system, LinuxSystemInfo)
    assert isinstance(build_hardware(fake=True, config=make_config()), Hardware)


def test_fake_hardware_has_a_pretend_panel_whatever_the_config_says() -> None:
    for backend in ("black", "cec", "output"):
        screen = build_hardware(fake=True, config=make_config(screen=ScreenConfig(backend=backend))).screen

        assert isinstance(screen, FakeScreen)
        assert screen.read_power() is True


@pytest.mark.parametrize(
    ("backend", "expected"), [("black", BlackScreen), ("cec", CecScreen), ("output", OutputScreen)]
)
def test_build_hardware_picks_the_screen_back_end_from_the_config(backend: str, expected: type) -> None:
    config = ScreenConfig(backend=backend, cec=CecConfig(device=4), output=OutputConfig(name="DP-1"))

    assert type(build_hardware(fake=False, config=make_config(screen=config)).screen) is expected


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
    system = build_hardware(fake=True, config=make_config()).system

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


# The button


def test_the_button_is_only_built_when_sensors_button_is_on() -> None:
    off = make_config(sensors=SensorsConfig(button=False))
    on = make_config(sensors=SensorsConfig(button=True))

    assert build_hardware(fake=True, config=off).button is None
    assert build_hardware(fake=False, config=off).button is None
    assert isinstance(build_hardware(fake=True, config=on).button, FakeButton)


def test_fake_hardware_has_a_button_that_is_never_pressed() -> None:
    button = build_hardware(fake=True, config=make_config(sensors=SensorsConfig(button=True))).button
    assert isinstance(button, FakeButton)
    seen: list[bool] = []

    button.start(seen.append)

    assert button.started is True
    assert seen == []


def test_the_real_button_is_a_gpio_button_on_the_configured_pin(monkeypatch: pytest.MonkeyPatch) -> None:
    # Nothing is opened until start(), so this is safe off a Pi.
    config = make_config(button=ButtonConfig(pin=22), sensors=SensorsConfig(button=True))

    button = build_hardware(fake=False, config=config).button

    assert isinstance(button, GpioButton)
    assert button._pin == 22


def test_fake_button_reports_presses_and_releases_to_whoever_started_it() -> None:
    fake = FakeButton()
    seen: list[bool] = []

    fake.press()  # nobody is listening yet
    fake.start(seen.append)
    fake.press()
    fake.release()
    fake.close()
    fake.press()  # and nobody is listening now

    assert seen == [True, False]
    assert fake.started is True
    assert fake.closed is True


def test_fake_button_can_fail_to_start() -> None:
    fake = FakeButton()
    fake.start_error = "pin busy"

    with pytest.raises(ButtonError, match="pin busy"):
        fake.start(lambda pressed: None)

    assert fake.started is False


# The real one, on gpiozero's mock pins. The button goes between the pin and ground, with the pull-up on, so pressing
# it pulls the pin low and letting go lets it float back up.


@pytest.fixture
def mock_pins() -> Iterator[MockFactory]:
    factory = MockFactory()
    yield factory
    factory.reset()
    factory.close()


def test_a_gpio_button_reports_the_pin_going_low_as_pressed_and_high_as_released(mock_pins: MockFactory) -> None:
    pin = mock_pins.pin(17)
    button = GpioButton(17, pin_factory=mock_pins)
    seen: list[bool] = []
    button.start(seen.append)
    try:
        pin.drive_low()
        pin.drive_high()
        pin.drive_low()
    finally:
        button.close()

    assert seen == [True, False, True]


def test_a_gpio_button_reads_every_edge_because_the_detector_does_the_debouncing(mock_pins: MockFactory) -> None:
    pin = mock_pins.pin(17)
    button = GpioButton(17, pin_factory=mock_pins)
    seen: list[bool] = []
    button.start(seen.append)
    try:
        # A chattering contact, far quicker than gpiozero's own default debounce would pass.
        for _ in range(3):
            pin.drive_low()
            pin.drive_high()
    finally:
        button.close()

    assert seen == [True, False] * 3


def test_a_gpio_button_uses_the_pin_it_was_given_with_the_pull_up_on(mock_pins: MockFactory) -> None:
    pin = mock_pins.pin(23)
    button = GpioButton(23, pin_factory=mock_pins)
    button.start(lambda pressed: None)
    try:
        assert pin.pull == "up"
        assert pin.function == "input"
    finally:
        button.close()


def test_closing_a_gpio_button_frees_the_pin_and_stops_the_reports(mock_pins: MockFactory) -> None:
    pin = mock_pins.pin(17)
    seen: list[bool] = []
    first = GpioButton(17, pin_factory=mock_pins)
    first.start(seen.append)

    first.close()
    pin.drive_low()
    pin.drive_high()
    # Free again, so another can be opened on it.
    second = GpioButton(17, pin_factory=mock_pins)
    second.start(seen.append)
    second.close()

    assert seen == []


def test_closing_a_gpio_button_twice_or_before_it_started_is_harmless(mock_pins: MockFactory) -> None:
    button = GpioButton(17, pin_factory=mock_pins)
    button.close()
    button.start(lambda pressed: None)
    button.close()
    button.close()


def test_starting_a_gpio_button_again_lets_go_of_the_first_open(mock_pins: MockFactory) -> None:
    button = GpioButton(17, pin_factory=mock_pins)
    seen: list[bool] = []

    button.start(lambda pressed: None)
    button.start(seen.append)
    try:
        mock_pins.pin(17).drive_low()
    finally:
        button.close()

    assert seen == [True]


def test_a_pin_that_is_already_in_use_is_a_button_error_with_a_short_message(mock_pins: MockFactory) -> None:
    taken = GpioButton(17, pin_factory=mock_pins)
    taken.start(lambda pressed: None)
    try:
        with pytest.raises(ButtonError) as error:
            GpioButton(17, pin_factory=mock_pins).start(lambda pressed: None)
    finally:
        taken.close()

    assert "in use" in str(error.value)
    assert "\n" not in str(error.value)
    assert len(str(error.value)) <= 210


def test_a_pin_that_cannot_be_opened_is_a_button_error(mock_pins: MockFactory) -> None:
    class Denied(MockFactory):
        def pin(self, *args: Any, **kwargs: Any) -> Any:
            raise PermissionError("no access to /dev/gpiochip4")

    factory = Denied()

    with pytest.raises(ButtonError, match="no access to /dev/gpiochip4"):
        GpioButton(17, pin_factory=factory).start(lambda pressed: None)


def test_no_pin_factory_at_all_is_a_button_error(monkeypatch: pytest.MonkeyPatch) -> None:
    # What a machine that is not a Pi, or has no lgpio, looks like: gpiozero can't find a default pin factory.
    monkeypatch.setattr(Device, "pin_factory", None)
    monkeypatch.setenv("GPIOZERO_PIN_FACTORY", "no-such-factory")

    with pytest.raises(ButtonError) as error:
        GpioButton(17).start(lambda pressed: None)

    assert str(error.value) != ""
    assert "\n" not in str(error.value)


def test_an_error_with_no_message_is_reported_by_its_kind(mock_pins: MockFactory) -> None:
    class Odd(MockFactory):
        def pin(self, *args: Any, **kwargs: Any) -> Any:
            raise OSError

    with pytest.raises(ButtonError, match="OSError"):
        GpioButton(17, pin_factory=Odd()).start(lambda pressed: None)


def test_a_very_long_library_message_is_cut_short(mock_pins: MockFactory) -> None:
    class Wordy(MockFactory):
        def pin(self, *args: Any, **kwargs: Any) -> Any:
            raise OSError("x " * 500)

    with pytest.raises(ButtonError) as error:
        GpioButton(17, pin_factory=Wordy()).start(lambda pressed: None)

    assert len(str(error.value)) < 250
    assert str(error.value).endswith("...")
