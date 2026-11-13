import sys

import pytest

from hw_probe.runner import CommandMissing, CommandTimeout, Result, subprocess_runner

from .fakes import FakeRunner, result


def test_result_ok_and_first_error_line():
    failed = Result(("x",), 2, "out line\n", "\n  \n  first problem  \nsecond\n", 0.1)
    assert not failed.ok
    assert failed.first_error_line() == "first problem"
    assert Result(("x",), 0, "fine", "", 0.1).ok


def test_first_error_line_falls_back_to_stdout_and_trims():
    assert Result(("x",), 1, "\nonly stdout\n", "", 0).first_error_line() == "only stdout"
    assert len(Result(("x",), 1, "", "a" * 500, 0).first_error_line()) == 200
    assert Result(("x",), 1, "", "", 0).first_error_line() == ""


def test_real_runner_captures_output_and_status():
    run = subprocess_runner()
    done = run([sys.executable, "-c", "import sys; print('hi'); sys.stderr.write('bad'); sys.exit(3)"])
    assert done.returncode == 3
    assert done.stdout.strip() == "hi"
    assert done.stderr == "bad"
    assert done.argv[0] == sys.executable
    assert done.seconds >= 0


def test_real_runner_sends_stdin_and_adds_env(monkeypatch):
    monkeypatch.setenv("HW_PROBE_OLD", "old")
    code = "import os, sys; print(sys.stdin.read().strip(), os.environ['HW_PROBE_NEW'], os.environ['HW_PROBE_OLD'])"
    done = subprocess_runner()([sys.executable, "-c", code], stdin="hello\n", env={"HW_PROBE_NEW": "new"})
    assert done.stdout.strip() == "hello new old"


def test_real_runner_closes_stdin_when_none_is_given():
    done = subprocess_runner()([sys.executable, "-c", "import sys; print(repr(sys.stdin.read()))"], timeout=10)
    assert done.stdout.strip() == "''"


def test_real_runner_does_not_use_a_shell():
    done = subprocess_runner()([sys.executable, "-c", "import sys; print(sys.argv[1])", "a; echo b"])
    assert done.stdout.strip() == "a; echo b"


def test_missing_program():
    with pytest.raises(CommandMissing, match="no-such-program-hw-probe is not installed"):
        subprocess_runner()(["no-such-program-hw-probe"])


def test_timeout_names_the_program_and_time():
    with pytest.raises(CommandTimeout, match=r"python.* did not finish within 0\.5 seconds|did not finish within 0.5"):
        subprocess_runner()([sys.executable, "-c", "import time; time.sleep(30)"], timeout=0.5)


def test_not_executable_is_status_126(tmp_path):
    script = tmp_path / "plain"
    script.write_text("not a program")
    script.chmod(0o644)
    done = subprocess_runner()([str(script)])
    assert done.returncode == 126
    assert "plain" in done.stderr


def test_fake_runner_matches_exact_stdin_before_argv_only():
    fake = FakeRunner()
    fake.on(["tool"], "any")
    fake.on(["tool"], "exact", stdin="x\n")
    assert fake(["tool"], stdin="x\n").stdout == "exact"
    assert fake(["tool"], stdin="y\n").stdout == "any"
    assert fake(["tool"]).argv == ("tool",)
    assert fake.stdins(["tool"]) == ["x\n", "y\n", None]


def test_fake_runner_outcomes_in_turn_then_repeat_and_raise():
    fake = FakeRunner()
    fake.on(["tool"], "one", result("two", returncode=1), CommandTimeout("tool", 5))
    assert fake(["tool"]).stdout == "one"
    assert fake(["tool"]).returncode == 1
    for _ in range(2):
        with pytest.raises(CommandTimeout):
            fake(["tool"])
    with pytest.raises(AssertionError):
        fake(["other"])
