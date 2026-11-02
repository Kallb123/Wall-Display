import logging
import os
import signal
import threading
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
  presence: true
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


def test_enabled_sensors_are_reported_as_not_built_yet(
    config_file: Path, fake_client: FakeMqttClient, caplog: pytest.LogCaptureFixture
) -> None:
    timer = stop_soon(signal.SIGTERM)
    caplog.set_level(logging.INFO)

    cli.main(["--config", str(config_file), "--fake-hardware"])
    timer.join()

    messages = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert messages == ["Sensor 'presence' is enabled in the config but not built yet, so it is ignored"]


def test_python_dash_m_works(tmp_path: Path) -> None:
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-m", "wallcal_agent", "--version"], capture_output=True, text=True, check=False, timeout=30
    )

    assert result.returncode == 0
    assert result.stdout.strip() == f"wallcal-agent {__version__}"
