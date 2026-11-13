"""Placeholder for `hw-probe render`; the real probe replaces this file."""

import argparse

from .context import Context
from .report import Section, Status


def add_arguments(parser: argparse.ArgumentParser) -> None:
    return None


def run(args: argparse.Namespace, ctx: Context) -> Section:
    section = Section("Render probe")
    section.add("Placeholder", Status.INFO, "Not written yet")
    return section
