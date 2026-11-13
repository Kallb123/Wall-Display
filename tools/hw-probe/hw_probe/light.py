"""`hw-probe light`: log the light sensor's lux readings. Not written yet."""

import argparse

from .context import Context
from .report import Section, Status


def add_arguments(parser: argparse.ArgumentParser) -> None:
    return None


def run(args: argparse.Namespace, ctx: Context) -> Section:
    section = Section("Light probe")
    section.add("Not written yet", Status.SKIP, "")
    return section
