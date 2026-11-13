"""The hardware modules and the three sensor modules load without PyYAML, so `hw-probe` can use them on the Pi's apt
packages alone."""

import subprocess
import sys

SCRIPT = """
import sys
sys.modules["yaml"] = None  # makes `import yaml` raise ImportError
import wallcal_agent.hardware.gpio
import wallcal_agent.hardware.ld2410
import wallcal_agent.hardware.light
import wallcal_agent.button
import wallcal_agent.presence
import wallcal_agent.light
"""


def test_the_sensor_code_imports_without_pyyaml() -> None:
    result = subprocess.run([sys.executable, "-c", SCRIPT], capture_output=True, text=True, timeout=60)

    assert result.returncode == 0, result.stderr
