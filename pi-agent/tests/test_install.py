"""Tests for install.sh, run against a scratch tree with --target (no root, no network)."""

import re
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


def test_the_installer_adds_the_video_group_and_the_screen_tools() -> None:
    # install_packages and create_user need root and a real system, so they can't run here: check what they say.
    script = INSTALL.read_text()

    assert re.search(r"^DEVICE_GROUPS=\(.*\bvideo\b.*\)$", script, re.MULTILINE)
    assert re.search(r"apt-get install -y python3 python3-venv .*\bcec-utils\b", script)
    assert re.search(r"apt-get install -y wlopm", script)


def test_the_installer_adds_lgpio_for_the_button_and_lets_the_venv_see_it() -> None:
    script = INSTALL.read_text()

    assert re.search(r"apt-get install -y python3 python3-venv .*\bpython3-lgpio\b", script)
    # python3-lgpio is only in apt, so a venv has to be made able to see the system's packages.
    assert re.search(r'python3 -m venv --system-site-packages "\$VENV_DIR"', script)
    assert re.search(r'enable_system_site_packages "\$VENV_DIR/pyvenv.cfg"', script)


def test_the_installer_adds_the_groups_the_presence_sensor_needs_and_the_package_depends_on_pyserial() -> None:
    script = INSTALL.read_text()

    # gpio for the OUT pin, dialout for /dev/serial0 and /dev/ttyUSB*. pyserial comes from the package's own
    # dependencies, so the venv's pip install fetches it and there is nothing for apt to add.
    assert re.search(r"^DEVICE_GROUPS=\(.*\bgpio\b.*\bdialout\b.*\)$", script, re.MULTILINE)
    assert re.search(r'^\s*"pyserial>=3\.5,<4",$', (PI_AGENT / "pyproject.toml").read_text(), re.MULTILINE)


def enable_system_site_packages(cfg: Path) -> None:
    """Runs install.sh's own function on a file, by sourcing the script (which does not run `main` then)."""
    result = subprocess.run(
        ["bash", "-c", 'source "$1"; enable_system_site_packages "$2"', "_", str(INSTALL), str(cfg)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


PYVENV_WITHOUT = "home = /usr/bin\ninclude-system-site-packages = false\nversion = 3.11.2\n"
PYVENV_WITH = PYVENV_WITHOUT.replace("false", "true")


def test_an_existing_venv_made_without_system_packages_is_switched_over(tmp_path: Path) -> None:
    cfg = tmp_path / "pyvenv.cfg"
    cfg.write_text(PYVENV_WITHOUT)

    enable_system_site_packages(cfg)

    assert cfg.read_text() == PYVENV_WITH


def test_a_venv_that_can_already_see_system_packages_is_left_alone(tmp_path: Path) -> None:
    cfg = tmp_path / "pyvenv.cfg"
    cfg.write_text(PYVENV_WITH)

    enable_system_site_packages(cfg)
    enable_system_site_packages(cfg)

    assert cfg.read_text() == PYVENV_WITH


def test_a_venv_config_without_the_setting_gets_it(tmp_path: Path) -> None:
    cfg = tmp_path / "pyvenv.cfg"
    cfg.write_text("home = /usr/bin\nversion = 3.11.2\n")

    enable_system_site_packages(cfg)

    assert cfg.read_text() == "home = /usr/bin\nversion = 3.11.2\ninclude-system-site-packages = true\n"


def test_the_unit_lets_the_service_reach_the_kiosks_wayland_socket() -> None:
    unit = UNIT_SOURCE.read_text()

    # "yes" would hide /run/user, where the socket is.
    assert re.search(r"^ProtectHome=read-only$", unit, re.MULTILINE)
    assert not re.search(r"^ProtectHome=yes", unit, re.MULTILINE)
