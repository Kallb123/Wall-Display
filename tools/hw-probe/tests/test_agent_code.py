import sys
from pathlib import Path

import pytest

from hw_probe import agent_code
from hw_probe.agent_code import AgentCodeMissing, ensure_agent_code, library_hint


def forget_agent(monkeypatch):
    """Makes `import wallcal_agent` fail until the path is changed, whatever the test environment has."""
    for name in [n for n in sys.modules if n == "wallcal_agent" or n.startswith("wallcal_agent.")]:
        monkeypatch.delitem(sys.modules, name)
    monkeypatch.setattr(sys, "path", [p for p in sys.path if not Path(p, "wallcal_agent").is_dir()])


def test_the_agent_source_is_the_repos_pi_agent_folder():
    assert agent_code.AGENT_SOURCE.parts[-2:] == ("pi-agent", "src")
    assert (agent_code.AGENT_SOURCE / "wallcal_agent").is_dir()


def test_an_importable_agent_is_left_alone(monkeypatch):
    before = list(sys.path)
    ensure_agent_code()
    assert sys.path == before


def test_the_repos_copy_is_put_at_the_front_of_the_path(monkeypatch):
    forget_agent(monkeypatch)

    ensure_agent_code()

    assert sys.path[0] == str(agent_code.AGENT_SOURCE)
    import wallcal_agent

    assert wallcal_agent is not None


def test_a_missing_agent_says_what_to_do(monkeypatch, tmp_path):
    forget_agent(monkeypatch)
    monkeypatch.setattr(agent_code, "AGENT_SOURCE", tmp_path / "pi-agent" / "src")
    before = list(sys.path)

    with pytest.raises(AgentCodeMissing) as raised:
        ensure_agent_code()

    assert "Pi agent's code" in str(raised.value)
    assert "clone of the repo" in str(raised.value)
    assert sys.path == before


@pytest.mark.parametrize(
    ("text", "hint"),
    [
        ("No module named 'gpiozero'", "sudo apt install python3-gpiozero python3-lgpio"),
        ("No module named 'lgpio'", "sudo apt install python3-gpiozero python3-lgpio"),
        ("No module named 'serial'", "sudo apt install python3-serial"),
        ("No module named 'smbus2'", "sudo apt install python3-smbus2"),
        ("The gpiozero library is not installed", "sudo apt install python3-gpiozero python3-lgpio"),
        ("pyserial missing: no module named serial", "sudo apt install python3-serial"),
    ],
)
def test_library_hint_names_the_apt_packages(text, hint):
    assert library_hint(text) == hint


@pytest.mark.parametrize("text", ["Permission denied", "", "No module named 'requests'"])
def test_library_hint_is_none_for_other_errors(text):
    assert library_hint(text) is None
