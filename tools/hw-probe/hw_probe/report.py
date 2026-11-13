"""What a probe found: the terminal summary and the markdown report."""

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from pathlib import Path


class Status(StrEnum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skipped"
    INFO = "info"


@dataclass
class Check:
    name: str
    status: Status
    detail: str = ""


@dataclass
class Table:
    title: str
    headers: list[str]
    rows: list[list[str]]


@dataclass
class Section:
    title: str
    facts: list[tuple[str, str]] = field(default_factory=list)
    checks: list[Check] = field(default_factory=list)
    tables: list[Table] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def add(self, name: str, status: Status, detail: str = "") -> Check:
        check = Check(name, status, detail)
        self.checks.append(check)
        return check

    def fact(self, key: str, value: str) -> None:
        self.facts.append((key, value))

    def fact_value(self, key: str) -> str | None:
        return next((value for name, value in self.facts if name == key), None)

    @property
    def failed(self) -> bool:
        return any(check.status is Status.FAIL for check in self.checks)


REPORT_HEADER = (
    "# Hardware findings\n"
    "\n"
    "What `tools/hw-probe` found on the real hardware (architecture §12, implementation plan H.1 and H.2). "
    "Each run of a probe adds a section at the end, so the newest is last. "
    "Commit this file as `docs/hardware-findings.md`.\n"
)


def _text_table(headers: list[str], rows: list[list[str]], indent: str = "  ") -> list[str]:
    widths = [len(header) for header in headers]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))

    def line(cells: list[str]) -> str:
        return (indent + "  ".join(cell.ljust(widths[index]) for index, cell in enumerate(cells))).rstrip()

    return [line(headers), *(line(row) for row in rows)]


def summary_text(section: Section) -> str:
    lines = [section.title, ""]
    if section.checks:
        name_width = max(len(check.name) for check in section.checks)
        for check in section.checks:
            line = f"{check.status.name:<4}  {check.name:<{name_width}}  {check.detail}"
            lines.append(line.rstrip())
    for table in section.tables:
        lines += ["", table.title, *_text_table(table.headers, table.rows)]
    if section.notes:
        lines.append("")
        lines += [f"- {note}" for note in section.notes]
    passed = sum(check.status is Status.PASS for check in section.checks)
    failed = sum(check.status is Status.FAIL for check in section.checks)
    skipped = sum(check.status is Status.SKIP for check in section.checks)
    lines += ["", f"{passed} passed, {failed} failed, {skipped} skipped"]
    return "\n".join(lines)


def _cell(value: str) -> str:
    return " ".join(value.replace("|", "\\|").split())


def _markdown_table(headers: list[str], rows: list[list[str]]) -> list[str]:
    lines = [
        "| " + " | ".join(_cell(header) for header in headers) + " |",
        "|" + "---|" * len(headers),
    ]
    lines += ["| " + " | ".join(_cell(cell) for cell in row) + " |" for row in rows]
    return lines


def to_markdown(section: Section, when: datetime) -> str:
    """The section as markdown, ending with a newline. The model (else the host) goes in the heading."""
    which = next(
        (value for value in (section.fact_value("Model"), section.fact_value("Host")) if value and value != "unknown"),
        None,
    )
    stamp = when.strftime("%Y-%m-%d %H:%M")
    heading = f"## {section.title}: {which}, {stamp}" if which else f"## {section.title}, {stamp}"
    blocks: list[list[str]] = [[heading]]
    if section.facts:
        blocks.append(_markdown_table(["Fact", "Value"], [[key, value] for key, value in section.facts]))
    if section.checks:
        rows = [[check.name, check.status.value, check.detail] for check in section.checks]
        blocks.append(_markdown_table(["Check", "Result", "Detail"], rows))
    for table in section.tables:
        blocks.append([f"#### {table.title}"])
        blocks.append(_markdown_table(table.headers, table.rows))
    if section.notes:
        blocks.append([f"- {_cell(note)}" for note in section.notes])
    return "\n\n".join("\n".join(block) for block in blocks) + "\n"


def append_to_report(path: Path, section: Section, when: datetime) -> None:
    """Adds the section at the end of the report, creating the report (with its header) if it is not there."""
    markdown = to_markdown(section, when)
    if path.exists() and path.stat().st_size > 0:
        existing = path.read_text(encoding="utf-8")
        separator = "\n" if existing.endswith("\n") else "\n\n"
        text = separator + markdown
        with path.open("a", encoding="utf-8") as handle:
            handle.write(text)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(REPORT_HEADER + "\n" + markdown, encoding="utf-8")
