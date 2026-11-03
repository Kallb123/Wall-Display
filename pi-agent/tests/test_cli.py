import json
import logging
import os
import signal
import threading
import time
from pathlib import Path

import pytest

from wallcal_agent import __version__, cli

from .conftest import PASSWORD, FakeMqttClient

CONFIG = f"""\
display_id: hallway
mqtt:
  host: broker.test
  username: wallcal
  password: {PASSWORD}
sensors:
  button: true
  presence: true
  light: true
"""


@pytest.fixture
def config_file(tmp_path: Path) -> Path:
    path = tmp_path / "config.yaml"
    path.write_text(CONFIG)
    return path


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch) -> FakeMqttClient:
    client = FakeMqttClient()

    def factory(client_id: str) -> FakeMqttClient:
        client.client_id = client_id
        return client

    monkeypatch.setattr(cli, "default_client_factory", factory)
    return client


def test_version(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        cli.main(["--version"])

    assert exit_info.value.code == 0
    assert capsys.readouterr().out.strip() == f"wallcal-agent {__version__}"


def test_help_lists_the_options(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        cli.main(["--help"])

    out = capsys.readouterr().out
    assert exit_info.value.code == 0
    for option in ("--config", "--fake-hardware", "--log-level", "--version", "/etc/wallcal-agent/config.yaml"):
        assert option in out


def test_a_bad_option_exits_2() -> None:
    with pytest.raises(SystemExit) as exit_info:
        cli.main(["--log-level", "LOUD"])

    assert exit_info.value.code == 2


def test_a_missing_config_exits_2_with_a_message(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    missing = tmp_path / "nope.yaml"

    assert cli.main(["--config", str(missing)]) == 2

    err = capsys.readouterr().err
    assert str(missing) in err
    assert "file not found" in err
    assert "Traceback" not in err


def test_a_bad_config_exits_2_naming_the_key(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(f"display_id: hallway\nmqtt:\n  host: h\n  port: 99999\n  password: {PASSWORD}\n")

    assert cli.main(["--config", str(path), "--fake-hardware"]) == 2

    err = capsys.readouterr().err
    assert "mqtt.port: must be 1 to 65535" in err
    assert "Traceback" not in err
    assert PASSWORD not in err


def stop_soon(sig: signal.Signals) -> threading.Timer:
    """Sends this process a signal shortly, as systemd would, from another thread."""
    timer = threading.Timer(0.3, os.kill, args=(os.getpid(), sig))
    timer.start()
    return timer


@pytest.mark.parametrize("sig", [signal.SIGTERM, signal.SIGINT])
def test_runs_until_signalled_then_says_offline(
    config_file: Path, fake_client: FakeMqttClient, sig: signal.Signals, caplog: pytest.LogCaptureFixture
) -> None:
    before = signal.getsignal(sig)
    timer = threading.Timer(0.3, lambda: (fake_client.broker_accepts(), os.kill(os.getpid(), sig)))
    timer.start()
    caplog.set_level(logging.DEBUG)

    code = cli.main(["--config", str(config_file), "--fake-hardware"])
    timer.join()

    assert code == 0
    assert fake_client.connect_args == ("broker.test", 1883, 30)
    assert fake_client.publishes[-1].payload == "offline"
    assert fake_client.disconnected is True
    # The handlers main installed are put back, so it can be called again (and doesn't leak into other tests).
    assert signal.getsignal(sig) == before
    assert PASSWORD not in caplog.text


def test_fake_hardware_has_a_pretend_panel_that_obeys_requests(config_file: Path, fake_client: FakeMqttClient) -> None:
    state_topic = "wallcal/hallway/pi/screen/state"

    def states() -> list[str | None]:
        return [p.payload for p in list(fake_client.publishes) if p.topic == state_topic]

    def play_the_broker() -> None:
        deadline = time.monotonic() + 10
        wait = threading.Event()
        fake_client.broker_accepts()
        while states() != ["on"] and time.monotonic() < deadline:
            wait.wait(0.005)
        fake_client.message_arrives("wallcal/hallway/pi/screen/set", "off")
        while states() != ["on", "off"] and time.monotonic() < deadline:
            wait.wait(0.005)
        os.kill(os.getpid(), signal.SIGTERM)

    player = threading.Timer(0.2, play_the_broker)
    player.start()

    code = cli.main(["--config", str(config_file), "--fake-hardware"])
    player.join()

    assert code == 0
    assert states() == ["on", "off"]
    assert ("wallcal/hallway/pi/screen/set", 1) in fake_client.subscriptions


def test_every_sensor_is_built_so_switching_all_of_them_on_raises_no_warning(
    config_file: Path, fake_client: FakeMqttClient, caplog: pytest.LogCaptureFixture
) -> None:
    timer = stop_soon(signal.SIGTERM)
    caplog.set_level(logging.INFO)

    cli.main(["--config", str(config_file), "--fake-hardware"])
    timer.join()

    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []
    assert "not built yet" not in caplog.text
    for line in ("Watching the button on GPIO17", "Watching presence on GPIO27", "Reading the light sensor"):
        assert line in caplog.text


def test_a_button_on_its_own_raises_no_warning_and_is_announced_to_home_assistant(
    tmp_path: Path, fake_client: FakeMqttClient, caplog: pytest.LogCaptureFixture
) -> None:
    path = tmp_path / "config.yaml"
    path.write_text("display_id: hallway\nmqtt:\n  host: broker.test\nsensors:\n  button: true\n")
    timer = threading.Timer(0.3, lambda: (fake_client.broker_accepts(), os.kill(os.getpid(), signal.SIGTERM)))
    timer.start()
    caplog.set_level(logging.INFO)

    code = cli.main(["--config", str(path), "--fake-hardware"])
    timer.join()

    assert code == 0
    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []
    assert "Watching the button on GPIO17" in caplog.text
    event = next(p for p in fake_client.publishes if p.topic == "homeassistant/event/wallcal_pi_hallway/button/config")
    assert event.payload
    assert json.loads(event.payload)["name"] == "Button"


def test_presence_on_its_own_raises_no_warning_and_is_announced_to_home_assistant(
    tmp_path: Path, fake_client: FakeMqttClient, caplog: pytest.LogCaptureFixture
) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(
        "display_id: hallway\nmqtt:\n  host: broker.test\nsensors:\n  presence: true\npresence:\n  hold_ms: 0\n"
    )
    presence_topic = "wallcal/hallway/pi/presence"

    def play_the_broker() -> None:
        deadline = time.monotonic() + 10
        # The fake sensor sees nobody once at start, and with no hold that is confirmed straight away.
        while "Presence: nobody" not in caplog.text and time.monotonic() < deadline:
            threading.Event().wait(0.005)
        fake_client.broker_accepts()
        os.kill(os.getpid(), signal.SIGTERM)

    player = threading.Timer(0.2, play_the_broker)
    player.start()
    caplog.set_level(logging.INFO)

    code = cli.main(["--config", str(path), "--fake-hardware"])
    player.join()

    assert code == 0
    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []
    assert "Watching presence on GPIO27" in caplog.text
    # The state confirmed before the broker was there is published, retained, when it connects.
    assert [(p.payload, p.retain) for p in fake_client.publishes if p.topic == presence_topic] == [("OFF", True)]
    entity = next(
        p for p in fake_client.publishes if p.topic == "homeassistant/binary_sensor/wallcal_pi_hallway/presence/config"
    )
    assert entity.payload
    assert json.loads(entity.payload)["name"] == "Presence"


def test_the_light_sensor_on_its_own_raises_no_warning_publishes_its_reading_and_is_announced_to_home_assistant(
    tmp_path: Path, fake_client: FakeMqttClient, caplog: pytest.LogCaptureFixture
) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(
        "display_id: hallway\nmqtt:\n  host: broker.test\nsensors:\n  light: true\nlight:\n  sample_ms: 200\n"
    )
    light_topic = "wallcal/hallway/pi/illuminance"

    def readings() -> list[tuple[str | None, bool]]:
        return [(p.payload, p.retain) for p in list(fake_client.publishes) if p.topic == light_topic]

    def play_the_broker() -> None:
        fake_client.broker_accepts()
        deadline = time.monotonic() + 10
        # The fake sensor reads 150 lux every time, and the first reading after a connect is the one that is published.
        while not readings() and time.monotonic() < deadline:
            threading.Event().wait(0.005)
        os.kill(os.getpid(), signal.SIGTERM)

    player = threading.Timer(0.2, play_the_broker)
    player.start()
    caplog.set_level(logging.INFO)

    code = cli.main(["--config", str(path), "--fake-hardware"])
    player.join()

    assert code == 0
    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []
    assert "Reading the light sensor (VEML7700 at 0x10 on /dev/i2c-1)" in caplog.text
    # A reading is a measurement, so it is not retained.
    assert readings() == [("150", False)]
    entity = next(
        p for p in fake_client.publishes if p.topic == "homeassistant/sensor/wallcal_pi_hallway/illuminance/config"
    )
    assert entity.payload
    assert json.loads(entity.payload)["name"] == "Illuminance"


def test_a_bad_light_setting_exits_2_naming_the_key_even_with_the_sensor_off(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "config.yaml"
    path.write_text("display_id: hallway\nmqtt:\n  host: h\nlight:\n  chip: bh1750\n  address: 0x10\n")

    assert cli.main(["--config", str(path), "--fake-hardware"]) == 2

    assert "light.address: must be 0x23 or 0x5c for the bh1750" in capsys.readouterr().err


def test_a_bad_presence_setting_exits_2_naming_the_key_even_with_the_sensor_off(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "config.yaml"
    path.write_text("display_id: hallway\nmqtt:\n  host: h\npresence:\n  uart:\n    baud: 1200\n")

    assert cli.main(["--config", str(path), "--fake-hardware"]) == 2

    assert "presence.uart.baud: must be one of 9600" in capsys.readouterr().err


def test_a_shared_pin_exits_2_naming_presence_pin(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(
        "display_id: hallway\nmqtt:\n  host: h\nsensors:\n  button: true\n  presence: true\npresence:\n  pin: 17\n"
    )

    assert cli.main(["--config", str(path), "--fake-hardware"]) == 2

    assert "presence.pin" in capsys.readouterr().err


def test_the_help_says_what_the_fake_hardware_has(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        cli.main(["--help"])

    out = " ".join(capsys.readouterr().out.split())
    assert "presence sensor" in out
    assert "light sensor" in out


def test_a_bad_button_setting_exits_2_naming_the_key_even_with_the_button_off(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "config.yaml"
    path.write_text("display_id: hallway\nmqtt:\n  host: h\nbutton:\n  long_press_ms: 50\n")

    assert cli.main(["--config", str(path), "--fake-hardware"]) == 2

    err = capsys.readouterr().err
    assert "button.long_press_ms: must be a whole number of milliseconds, 300 to 10000" in err


def test_python_dash_m_works(tmp_path: Path) -> None:
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-m", "wallcal_agent", "--version"], capture_output=True, text=True, check=False, timeout=30
    )

    assert result.returncode == 0
    assert result.stdout.strip() == f"wallcal-agent {__version__}"
