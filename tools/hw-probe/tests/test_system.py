import platform
import socket

from hw_probe.system import cpu_temperature, read_text, system_facts

FILES = {
    "/proc/device-tree/model": "Raspberry Pi 5 Model B Rev 1.0\x00",
    "/etc/os-release": 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nID=debian\n',
    "/proc/meminfo": "MemTotal:        8245984 kB\nMemFree:         5000000 kB\n",
    "/sys/class/thermal/thermal_zone0/temp": "48750\n",
}


def test_facts_in_order_with_values():
    facts = dict(system_facts(FILES.get))
    assert list(facts) == ["Host", "Model", "OS", "Kernel", "Memory", "Python"]
    assert facts["Host"] == socket.gethostname()
    assert facts["Model"] == "Raspberry Pi 5 Model B Rev 1.0"
    assert facts["OS"] == "Debian GNU/Linux 12 (bookworm)"
    assert facts["Kernel"] == platform.release()
    assert facts["Memory"] == "7.9 GiB"
    assert facts["Python"] == platform.python_version()


def test_missing_files_say_unknown():
    facts = dict(system_facts(lambda path: None))
    assert facts["Model"] == facts["OS"] == facts["Memory"] == "unknown"


def test_os_release_without_pretty_name_and_odd_meminfo():
    facts = dict(system_facts({"/etc/os-release": "ID=x\n", "/proc/meminfo": "nothing"}.get))
    assert facts["OS"] == "unknown"
    assert facts["Memory"] == "unknown"


def test_cpu_temperature():
    assert cpu_temperature(FILES.get) == 48.75
    assert cpu_temperature(lambda path: None) is None
    assert cpu_temperature(lambda path: "hot") is None


def test_read_text(tmp_path):
    path = tmp_path / "f"
    path.write_text("abc")
    assert read_text(str(path)) == "abc"
    assert read_text(str(tmp_path / "missing")) is None
