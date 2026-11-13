"""`hw-probe button`: tune the button's single, double and long press timings. Not written yet."""

import argparse

from .context import Context
from .report import Section, Status


def add_arguments(parser: argparse.ArgumentParser) -> None:
    return None


def run(args: argparse.Namespace, ctx: Context) -> Section:
    section = Section("Button probe")
    section.add("Not written yet", Status.SKIP, "")
    return section
