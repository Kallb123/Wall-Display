"""`hw-probe mmwave`: watch the mmWave presence sensor. Not written yet."""

import argparse

from .context import Context
from .report import Section, Status


def add_arguments(parser: argparse.ArgumentParser) -> None:
    return None


def run(args: argparse.Namespace, ctx: Context) -> Section:
    section = Section("mmWave probe")
    section.add("Not written yet", Status.SKIP, "")
    return section
