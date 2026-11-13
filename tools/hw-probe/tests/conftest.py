import io

import pytest

from hw_probe.context import Context

from .fakes import FakeClock, FakeRunner, ScriptedPrompter


@pytest.fixture
def runner() -> FakeRunner:
    return FakeRunner()


@pytest.fixture
def prompter() -> ScriptedPrompter:
    return ScriptedPrompter()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def out() -> io.StringIO:
    return io.StringIO()


@pytest.fixture
def ctx(runner: FakeRunner, prompter: ScriptedPrompter, clock: FakeClock, out: io.StringIO) -> Context:
    """A context where every program is "installed" under /usr/bin. Tests may replace `which`."""
    return Context(
        runner=runner,
        prompter=prompter,
        out=out,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
        which=lambda name: f"/usr/bin/{name}",
    )
