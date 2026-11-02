"""Tests for install.sh, run against a scratch tree with --target (no root, no network)."""

import shutil
import subprocess
from pathlib import Path

import pytest

PI_AGENT = Path(__file__).resolve().parents[1]
INSTALL = PI_AGENT / "install.sh"
UNIT_SOURCE = PI_AGENT / "systemd" / "wallcal-agent.service"
CONFIG_SOURCE = PI_AGENT / "config.example.yaml"

pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="bash is not installed")


def run_install(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["bash", str(INSTALL), *args], capture_output=True, text=True, check=False)


def install_into(target: Path) -> subprocess.CompletedProcess[str]:
    return run_install("--target", str(target))


def test_help_prints_usage() -> None:
    result = run_install("--help")
    assert result.returncode == 0
    assert "Usage:" in result.stdout
    assert "install.sh" in result.stdout
    assert "--target" not in result.stdout  # the test hook stays hidden


def test_unknown_option_is_a_usage_error() -> None:
    result = run_install("--nope")
    assert result.returncode == 2
    assert "unknown option" in result.stderr


def test_installs_unit_and_config(tmp_path: Path) -> None:
    result = install_into(tmp_path)
    assert result.returncode == 0, result.stderr

    unit = tmp_path / "etc/systemd/system/wallcal-agent.service"
    assert unit.read_text() == UNIT_SOURCE.read_text()
    assert unit.stat().st_mode & 0o777 == 0o644

    config = tmp_path / "etc/wallcal-agent/config.yaml"
    assert config.read_text() == CONFIG_SOURCE.read_text()
    assert config.stat().st_mode & 0o777 == 0o640

    # The first run leaves the service stopped, and says the config needs editing.
    assert "not started yet" in result.stdout


def test_second_run_is_safe_and_keeps_the_config(tmp_path: Path) -> None:
    assert install_into(tmp_path).returncode == 0

    config = tmp_path / "etc/wallcal-agent/config.yaml"
    config.write_text("display_id: kitchen\nmqtt:\n  host: broker.example\n")
    unit = tmp_path / "etc/systemd/system/wallcal-agent.service"
    unit.write_text("stale unit\n")

    result = install_into(tmp_path)
    assert result.returncode == 0, result.stderr
    assert config.read_text() == "display_id: kitchen\nmqtt:\n  host: broker.example\n"
    assert unit.read_text() == UNIT_SOURCE.read_text()
    assert "not started yet" not in result.stdout
    assert "config" in result.stdout and "kept" in result.stdout


def test_existing_config_gets_the_right_mode(tmp_path: Path) -> None:
    config = tmp_path / "etc/wallcal-agent/config.yaml"
    config.parent.mkdir(parents=True)
    config.write_text("display_id: kitchen\n")
    config.chmod(0o666)

    assert install_into(tmp_path).returncode == 0
    assert config.read_text() == "display_id: kitchen\n"
    assert config.stat().st_mode & 0o777 == 0o640


def test_target_mode_touches_nothing_outside_the_target(tmp_path: Path) -> None:
    assert install_into(tmp_path).returncode == 0
    created = {path.relative_to(tmp_path).parts[0] for path in tmp_path.rglob("*")}
    assert created == {"etc"}
