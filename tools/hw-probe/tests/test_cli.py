import argparse
import io
import sys
from datetime import datetime
from types import SimpleNamespace

import pytest

from hw_probe import __version__, cli
from hw_probe.context import Context
from hw_probe.prompt import NoPrompter, TerminalPrompter
from hw_probe.report import Section, Status

from .fakes import FakeRunner, ScriptedPrompter

WHEN = datetime(2026, 11, 13, 14, 2)


class FakeProbe:
    """A module-like probe. `outcome` is the status of its one check, or an exception to raise."""

    def __init__(self, outcome=Status.PASS):
        self.outcome = outcome
        self.args: argparse.Namespace | None = None
        self.ctx: Context | None = None

    def add_arguments(self, parser):
        parser.add_argument("--thing", default="none")

    def run(self, args, ctx):
        self.args, self.ctx = args, ctx
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        section = Section("Fake probe")
        section.fact("Probe fact", "yes")
        section.add("The check", self.outcome, "detail here")
        return section


@pytest.fixture(autouse=True)
def fixed_facts(monkeypatch):
    monkeypatch.setattr(cli, "system_facts", lambda: [("Host", "test-pi"), ("Model", "Test Model")])


def run_cli(argv, probe=None, tmp_path=None):
    probe = probe or FakeProbe()
    out = io.StringIO()
    contexts = []

    def factory(args, stream):
        ctx = Context(runner=FakeRunner(), prompter=ScriptedPrompter(), out=stream)
        contexts.append(ctx)
        return ctx

    code = cli.main(argv, ctx_factory=factory, probes={"fake": probe}, now=lambda: WHEN, out=out)
    return code, out.getvalue(), probe


def test_registry_names_the_probes():
    assert cli.PROBES == {
        "screen": "hw_probe.screen",
        "render": "hw_probe.render",
        "button": "hw_probe.button",
        "mmwave": "hw_probe.mmwave",
        "light": "hw_probe.light",
    }
    assert set(cli.HELP_SUMMARIES) == set(cli.PROBES)


def test_real_registry_modules_have_the_interface():
    for module in cli.load_probes().values():
        assert callable(module.add_arguments)
        assert callable(module.run)


def test_passing_run_exits_0_and_writes_report(tmp_path):
    report = tmp_path / "findings.md"
    code, output, probe = run_cli(["fake", "--report", str(report), "--thing", "x"])
    assert code == 0
    assert probe.args.thing == "x"
    assert "PASS  The check  detail here" in output
    assert f"Added to {report}" in output
    text = report.read_text()
    assert "## Fake probe: Test Model, 2026-11-13 14:02" in text


def test_failed_check_exits_1(tmp_path):
    code, output, _ = run_cli(["fake", "--report", str(tmp_path / "r.md")], FakeProbe(Status.FAIL))
    assert code == 1
    assert "1 failed" in output


@pytest.mark.parametrize("status", [Status.SKIP, Status.INFO])
def test_skipped_and_info_exit_0(status, tmp_path):
    code, _, _ = run_cli(["fake", "--no-report"], FakeProbe(status))
    assert code == 0


def test_system_facts_come_first(tmp_path):
    report = tmp_path / "r.md"
    run_cli(["fake", "--report", str(report)])
    text = report.read_text()
    assert text.index("| Host | test-pi |") < text.index("| Model | Test Model |") < text.index("| Probe fact | yes |")


def test_no_report_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    code, output, _ = run_cli(["fake", "--no-report"])
    assert code == 0
    assert "Added to" not in output
    assert list(tmp_path.iterdir()) == []


def test_default_report_is_in_the_current_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _, output, _ = run_cli(["fake"])
    assert (tmp_path / "hardware-findings.md").exists()
    assert "Added to hardware-findings.md" in output


def test_report_is_appended_to_on_a_second_run(tmp_path):
    report = tmp_path / "r.md"
    run_cli(["fake", "--report", str(report)])
    run_cli(["fake", "--report", str(report)])
    text = report.read_text()
    assert text.count("## Fake probe") == 2
    assert text.count("# Hardware findings") == 1


def test_no_command_prints_help_and_exits_2():
    code, output, _ = run_cli([])
    assert code == 2
    assert "usage: hw-probe" in output
    assert "fake" in output


def test_unknown_command_and_option_exit_2(capsys):
    assert run_cli(["nope"])[0] == 2
    assert run_cli(["fake", "--bogus"])[0] == 2
    assert "usage:" in capsys.readouterr().err


def test_help_and_version_exit_0(capsys):
    assert run_cli(["--help"])[0] == 0
    assert run_cli(["--version"])[0] == 0
    assert f"hw-probe {__version__}" in capsys.readouterr().out


def test_keyboard_interrupt_says_stopped_and_exits_130(tmp_path):
    report = tmp_path / "r.md"
    code, output, _ = run_cli(["fake", "--report", str(report)], FakeProbe(KeyboardInterrupt()))
    assert code == 130
    assert "Stopped." in output
    assert not report.exists()


def test_probe_gets_the_context_from_the_factory():
    _, _, probe = run_cli(["fake", "--no-report"])
    assert isinstance(probe.ctx.prompter, ScriptedPrompter)


def test_default_context_no_prompt_picks_no_prompter():
    out = io.StringIO()
    ctx = cli.default_context(SimpleNamespace(no_prompt=True), out)
    assert isinstance(ctx.prompter, NoPrompter)
    assert out.getvalue() == ""


def test_default_context_without_a_terminal_says_so(monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.StringIO())
    out = io.StringIO()
    ctx = cli.default_context(SimpleNamespace(no_prompt=False), out)
    assert isinstance(ctx.prompter, NoPrompter)
    assert "not a terminal" in out.getvalue()


def test_default_context_on_a_terminal_asks(monkeypatch):
    class Tty(io.StringIO):
        def isatty(self):
            return True

    monkeypatch.setattr(sys, "stdin", Tty())
    ctx = cli.default_context(SimpleNamespace(no_prompt=False), io.StringIO())
    assert isinstance(ctx.prompter, TerminalPrompter)


def test_no_prompt_flag_is_accepted_by_the_subcommand():
    _, _, probe = run_cli(["fake", "--no-prompt", "--no-report"])
    assert probe.args.no_prompt is True
