"""The `wallcal-agent` command: reads the config, starts the agent and runs until told to stop."""

import argparse
import logging
import signal
import sys
import threading
from collections.abc import Sequence
from types import FrameType

from . import __version__
from .agent import Agent, default_client_factory
from .config import DEFAULT_CONFIG_PATH, ConfigError, load_config
from .hardware import build_hardware

logger = logging.getLogger(__name__)

LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wallcal-agent",
        description="The Wall Display agent for the Raspberry Pi: MQTT availability, Home Assistant discovery, "
        "diagnostics, panel power, the button, the mmWave presence sensor and the ambient light sensor.",
    )
    parser.add_argument(
        "--config",
        default=str(DEFAULT_CONFIG_PATH),
        metavar="PATH",
        help="the config file (default: %(default)s)",
    )
    parser.add_argument(
        "--fake-hardware",
        action="store_true",
        help="use made-up sensor values, a pretend panel, a button that is never pressed, a presence sensor that "
        "always sees nobody and a light sensor that always reads 150 lux, to try the agent somewhere that isn't a Pi",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        type=str.upper,
        choices=LOG_LEVELS,
        metavar="LEVEL",
        help=f"one of {', '.join(LOG_LEVELS)} (default: INFO)",
    )
    parser.add_argument("--version", action="version", version=f"wallcal-agent {__version__}")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Runs the agent. Returns 0 after a clean stop, and 2 if the config can't be used."""
    args = _parser().parse_args(argv)
    # No timestamp: systemd's journal adds its own.
    logging.basicConfig(level=args.log_level, format="%(levelname)s %(name)s: %(message)s")

    try:
        config = load_config(args.config)
    except ConfigError as error:
        print(f"wallcal-agent: config {args.config}: {error}", file=sys.stderr)
        return 2

    stop = threading.Event()

    def request_stop(signum: int, frame: FrameType | None) -> None:
        logger.info("Stopping (%s)", signal.Signals(signum).name)
        stop.set()

    previous = {sig: signal.signal(sig, request_stop) for sig in (signal.SIGTERM, signal.SIGINT)}
    agent = Agent(config, build_hardware(args.fake_hardware, config), client_factory=default_client_factory)
    try:
        agent.start()
        agent.run(stop)
    finally:
        agent.stop()
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    return 0
