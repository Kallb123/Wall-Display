"""The `hw-probe` command line: picks a probe, runs it, prints the summary and adds it to the report."""

import argparse
import importlib
import os
import sys
from collections.abc import Callable, Mapping
from datetime import datetime
from pathlib import Path
from types import ModuleType
from typing import Any, TextIO

from . import __version__
from .context import Context
from .prompt import NoPrompter, TerminalPrompter
from .report import Section, append_to_report, summary_text
from .runner import subprocess_runner
from .system import system_facts

# One module per probe. Each has `add_arguments(parser)` and `run(args, ctx) -> Section`.
PROBES: dict[str, str] = {
    "screen": "hw_probe.screen",
    "render": "hw_probe.render",
    "button": "hw_probe.button",
    "mmwave": "hw_probe.mmwave",
    "light": "hw_probe.light",
}

DEFAULT_REPORT = "hardware-findings.md"

HELP_SUMMARIES = {
    "screen": "check that the monitor can be switched off and on (CEC, HDMI output, DDC/CI)",
    "render": "measure how smoothly Chromium draws the calendar and photo pages",
    "button": "tune the button's single, double and long press timings",
    "mmwave": "watch the mmWave presence sensor (OUT pin and, optionally, its gate energies over UART)",
    "light": "log the light sensor's lux readings to choose thresholds",
}


def default_context(args: argparse.Namespace, out: TextIO) -> Context:
    """The real context. Questions are asked only when someone can answer them."""
    interactive = not args.no_prompt and sys.stdin.isatty()
    if interactive:
        prompter: TerminalPrompter | NoPrompter = TerminalPrompter(sys.stdin, out)
    else:
        prompter = NoPrompter()
        if not args.no_prompt:
            out.write("  Input is not a terminal, so steps that need someone watching the screen will be skipped.\n")
    return Context(runner=subprocess_runner(), prompter=prompter, out=out)


def build_parser(probes: Mapping[str, Any]) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hw-probe", description="Hardware probes for the Wall Display.")
    parser.add_argument("--version", action="version", version=f"hw-probe {__version__}")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--report",
        type=Path,
        default=Path(DEFAULT_REPORT),
        metavar="PATH",
        help=f"markdown report to add the results to (default: {DEFAULT_REPORT} in this folder)",
    )
    common.add_argument("--no-report", action="store_true", help="print the summary only; write no report")
    common.add_argument(
        "--no-prompt",
        action="store_true",
        help="never ask questions: steps that need someone watching the screen are skipped",
    )
    subparsers = parser.add_subparsers(dest="command", metavar="<command>")
    for name, module in probes.items():
        sub = subparsers.add_parser(
            name, parents=[common], help=HELP_SUMMARIES.get(name), description=HELP_SUMMARIES.get(name)
        )
        module.add_arguments(sub)
        sub.set_defaults(probe=module)
    return parser


def load_probes() -> dict[str, ModuleType]:
    return {name: importlib.import_module(path) for name, path in PROBES.items()}


def main(
    argv: list[str] | None = None,
    *,
    ctx_factory: Callable[[argparse.Namespace, TextIO], Context] = default_context,
    probes: Mapping[str, Any] | None = None,
    now: Callable[[], datetime] = datetime.now,
    out: TextIO | None = None,
) -> int:
    """Runs one probe. Returns 0 if nothing failed, 1 if a check failed, 2 for bad usage, 130 if stopped."""
    stream = out if out is not None else sys.stdout
    parser = build_parser(load_probes() if probes is None else probes)
    try:
        args = parser.parse_args(argv)
    except SystemExit as exit_request:
        code = exit_request.code
        return code if isinstance(code, int) else (0 if code is None else 2)
    if args.command is None:
        parser.print_help(stream)
        return 2

    try:
        ctx = ctx_factory(args, stream)
        section: Section = args.probe.run(args, ctx)
        section.facts[:0] = system_facts()
        stream.write("\n" + summary_text(section) + "\n")
        if not args.no_report:
            append_to_report(args.report, section, now())
            stream.write(f"\nAdded to {os.fspath(args.report)}\n")
    except KeyboardInterrupt:
        stream.write("\nStopped.\n")
        return 130
    return 1 if section.failed else 0
