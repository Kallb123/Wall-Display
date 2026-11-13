import io

import pytest

from hw_probe.prompt import NoPrompter, TerminalPrompter

from .fakes import FakeClock


def make(text: str, readable: bool = True, clock: FakeClock | None = None, advance: float = 0.0):
    clock = clock or FakeClock()
    out = io.StringIO()

    def wait_readable(timeout: float) -> bool:
        clock.now += advance
        return readable

    prompter = TerminalPrompter(io.StringIO(text), out, clock.monotonic, wait_readable)
    return prompter, out


def test_yes_no_accepts_the_four_answers():
    prompter, _ = make("y\nYES\nn\n No \n")
    assert [prompter.yes_no("ok?") for _ in range(4)] == [True, True, False, False]


def test_yes_no_asks_again_until_it_understands():
    prompter, out = make("maybe\n\nyes\n")
    assert prompter.yes_no("Did it work? [y/n]") is True
    assert out.getvalue().count("Did it work? [y/n]") == 3
    assert out.getvalue().count("Please answer y or n.") == 2


def test_yes_no_on_end_of_input_is_none():
    prompter, _ = make("")
    assert prompter.yes_no("ok?") is None


def test_wait_enter_prints_the_message_and_returns_the_seconds_taken():
    prompter, out = make("\n", advance=4.2)
    assert prompter.wait_enter("Press Enter when the picture is back", 60) == pytest.approx(4.2)
    assert "Press Enter when the picture is back" in out.getvalue()


def test_wait_enter_measures_from_the_call():
    clock = FakeClock(start=50.0)
    prompter, _ = make("\n", clock=clock, advance=4.0)
    assert prompter.wait_enter("go", 60) == pytest.approx(4.0)


def test_wait_enter_times_out_without_reading():
    stdin = io.StringIO("\n")
    prompter = TerminalPrompter(stdin, io.StringIO(), FakeClock().monotonic, lambda timeout: False)
    assert prompter.wait_enter("go", 5) is None
    assert stdin.read() == "\n"


def test_wait_enter_passes_the_timeout_to_the_wait():
    seen: list[float] = []
    prompter = TerminalPrompter(
        io.StringIO("\n"), io.StringIO(), FakeClock().monotonic, lambda t: seen.append(t) or True
    )
    prompter.wait_enter("go", 12.5)
    assert seen == [12.5]


def test_wait_enter_on_end_of_input_is_none():
    prompter, _ = make("")
    assert prompter.wait_enter("go", 5) is None


def test_pause_reads_a_line():
    stdin = io.StringIO("\nrest")
    prompter = TerminalPrompter(stdin, io.StringIO())
    prompter.pause("Ready?")
    assert stdin.read() == "rest"


def test_no_prompter_does_nothing():
    prompter = NoPrompter()
    assert prompter.interactive is False
    assert prompter.yes_no("x") is None
    assert prompter.wait_enter("x", 1) is None
    assert prompter.pause("x") is None
    assert TerminalPrompter(io.StringIO(), io.StringIO()).interactive is True
