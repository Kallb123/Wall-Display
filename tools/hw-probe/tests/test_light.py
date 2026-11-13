import argparse
import csv
import io
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from hw_probe import light
from hw_probe.agent_code import AgentCodeMissing
from hw_probe.context import Context
from hw_probe.light import Reading, Stats
from hw_probe.report import Section, Status

from .fakes import FakeClock, FakeRunner, ScriptedPrompter


def LightError(message: str) -> Exception:
    from wallcal_agent.hardware import LightError as real

    return real(message)


class FakeSensor:
    """Gives scripted readings: a number, or an exception to raise. The last one repeats."""

    def __init__(self, *script: Any) -> None:
        self._script = list(script) or [100.0]
        self.reads = 0
        self.closed = 0

    def read_lux(self) -> float:
        value = self._script[min(self.reads, len(self._script) - 1)]
        self.reads += 1
        if isinstance(value, Exception):
            raise value
        return float(value)

    def close(self) -> None:
        self.closed += 1


class ClockedPrompter(ScriptedPrompter):
    """A prompter whose waiting for Enter lets the fake clock move, as the real one's would."""

    def __init__(self, clock: FakeClock, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._clock = clock

    def poll_enter(self, timeout: float) -> bool:
        answer = super().poll_enter(timeout)
        if not answer:
            self._clock.sleep(timeout)
        return answer


@pytest.fixture(autouse=True)
def stubs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(light, "ensure_agent_code", lambda: None)
    monkeypatch.setattr(light, "bus_exists", lambda bus: True)
    monkeypatch.setattr(light, "wall_clock", lambda: datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC))


def make_args(**overrides: Any) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    light.add_arguments(parser)
    args = parser.parse_args([])
    for name, value in overrides.items():
        setattr(args, name, value)
    return args


def use_sensors(monkeypatch: pytest.MonkeyPatch, *sensors: FakeSensor) -> list[tuple[str, int, int]]:
    """`open_sensor` hands out these sensors in turn, and records what it was asked for."""
    asked: list[tuple[str, int, int]] = []
    queue = list(sensors)

    def open_sensor(chip: str, bus: int, address: int) -> FakeSensor:
        asked.append((chip, bus, address))
        return queue.pop(0)

    monkeypatch.setattr(light, "open_sensor", open_sensor)
    return asked


def readings(*values: float, step: float = 1.0) -> list[Reading]:
    return [Reading(index * step, value) for index, value in enumerate(values)]


# ---- pure analysis -------------------------------------------------------------------------------------------


def test_summarise() -> None:
    assert light.summarise([]) is None
    stats = light.summarise(readings(5, 1, 9, 3))
    assert stats == Stats(4, 1, 4, 9)
    assert stats.spread == 8


def test_published_flags_use_the_agents_reporter() -> None:
    # 100, then 105 (5%: not enough), 120 (20% from 100: published), then nothing new until the heartbeat at 30 s.
    data = [Reading(0, 100), Reading(1, 105), Reading(2, 120), Reading(3, 121), Reading(32, 121)]
    assert light.published_flags(data, 10, 0.5, 30) == [True, False, True, False, True]


def test_published_flags_ignore_flicker_in_the_dark() -> None:
    data = readings(0.1, 0.2, 0.1, 0.3)
    assert light.published_flags(data, 10, 0.5, 30) == [True, False, False, False]
    assert light.published_flags(data, 10, 0.05, 30) == [True, True, True, True]


def test_suggest_change_lux_is_twice_the_noise_rounded_up() -> None:
    assert light.suggest_change_lux(0.0) == 0
    assert light.suggest_change_lux(0.12) == 0.3
    assert light.suggest_change_lux(0.5) == 1.0
    assert light.suggest_change_lux(0.25) == 0.5


def test_responds_to_light() -> None:
    def stats(median: float) -> Stats:
        return Stats(5, median, median, median)

    assert light.responds_to_light(stats(100), stats(20)) is True
    assert light.responds_to_light(stats(100), stats(49.9)) is True
    assert light.responds_to_light(stats(100), stats(60)) is False
    assert light.responds_to_light(stats(100), stats(50)) is False
    assert light.responds_to_light(stats(3), stats(0.8)) is True  # under 1 lx counts, even in a dim room
    assert light.responds_to_light(None, stats(1)) is None
    assert light.responds_to_light(stats(1), None) is None


@pytest.mark.parametrize(
    ("lux", "expected"),
    [(0.04, 0.1), (0.34, 0.3), (2.3, 2.5), (7.2, 7.0), (12.4, 12.0), (47.6, 48.0), (162.0, 160.0), (1234.0, 1235.0)],
)
def test_round_lux(lux: float, expected: float) -> None:
    assert light.round_lux(lux) == expected


def stats_at(median: float) -> Stats:
    return Stats(5, median, median, median)


def test_suggest_darkness_is_the_geometric_mean() -> None:
    # sqrt(1 x 100) = 10
    assert light.suggest_darkness(stats_at(1), stats_at(100)) == 10
    # sqrt(2 x 80) = 12.6, rounded
    assert light.suggest_darkness(stats_at(2), stats_at(80)) == 13


def test_suggest_darkness_with_a_pitch_black_room() -> None:
    # 0 lx counts as 0.1: sqrt(0.1 x 90) = 3
    assert light.suggest_darkness(stats_at(0), stats_at(90)) == 3


def test_suggest_darkness_needs_both_and_an_order() -> None:
    assert light.suggest_darkness(None, stats_at(80)) is None
    assert light.suggest_darkness(stats_at(1), None) is None
    assert light.suggest_darkness(stats_at(50), stats_at(50)) is None
    assert light.suggest_darkness(stats_at(50), stats_at(10)) is None


def test_suggest_darkness_stays_between_when_rounding_would_not() -> None:
    # sqrt(1.0 x 1.1) = 1.05, which rounds to 1.0: not above the dark room, so the unrounded figure is kept.
    value = light.suggest_darkness(stats_at(1.0), stats_at(1.1))
    assert value is not None
    assert 1.0 < value < 1.1


def test_format_lux() -> None:
    assert light.format_lux(0.1234) == "0.12"
    assert light.format_lux(12.34) == "12.3"
    assert light.format_lux(1234.5) == "1234"


def test_parser_defaults_follow_the_agents_config() -> None:
    pytest.importorskip("yaml")
    from wallcal_agent.config import LightConfig

    defaults = LightConfig()
    args = make_args()
    assert args.chip == "auto"
    assert args.bus == defaults.bus
    assert args.interval_ms == defaults.sample_ms
    assert args.change_percent == defaults.change_percent
    assert args.change_lux == defaults.change_lux
    assert args.report_seconds == defaults.report_seconds


def test_address_argument() -> None:
    parser = argparse.ArgumentParser()
    light.add_arguments(parser)
    assert parser.parse_args(["--address", "0x5c"]).address == 0x5C
    assert parser.parse_args(["--address", "35"]).address == 35
    with pytest.raises(SystemExit):
        parser.parse_args(["--address", "0xzz"])
    with pytest.raises(SystemExit):
        parser.parse_args(["--address", "0x200"])
    with pytest.raises(SystemExit):
        parser.parse_args(["--interval-ms", "0"])


# ---- reading -------------------------------------------------------------------------------------------------


def test_collect_reads_at_the_interval(ctx: Context, clock: FakeClock) -> None:
    recorder = light._Recorder(ctx, FakeSensor(1, 2, 3, 4, 5, 6), None)
    taken = light.collect(ctx, recorder, duration=5, interval=1)
    assert [reading.lux for reading in taken.readings] == [1, 2, 3, 4, 5]
    assert [reading.seconds for reading in taken.readings] == [0, 1, 2, 3, 4]
    assert clock.sleeps == [1, 1, 1, 1]


def test_collect_counts_a_failed_reading_and_goes_on(ctx: Context, out: io.StringIO) -> None:
    sensor = FakeSensor(1, LightError("i2c read failed"), LightError("i2c read failed"), 4)
    taken = light.collect(ctx, light._Recorder(ctx, sensor, None), duration=4, interval=1)
    assert [reading.lux for reading in taken.readings] == [1, 4]
    assert taken.failed == 2
    assert taken.errors == ["i2c read failed"]
    assert out.getvalue().count("i2c read failed") == 1
    assert not taken.gave_up


def test_collect_gives_up_after_many_failures_in_a_row(ctx: Context) -> None:
    sensor = FakeSensor(1, LightError("gone"))
    taken = light.collect(ctx, light._Recorder(ctx, sensor, None), duration=1000, interval=1)
    assert taken.gave_up
    assert taken.failed == light.MAX_FAILURES_IN_A_ROW
    assert len(taken.readings) == 1


def test_collect_stops_on_enter(clock: FakeClock, out: io.StringIO) -> None:
    prompter = ClockedPrompter(clock, enter_polls=[False, False, True])
    ctx = Context(FakeRunner(), prompter, out, clock.sleep, clock.monotonic)
    taken = light.collect(ctx, light._Recorder(ctx, FakeSensor(5), None), duration=100, interval=2, stoppable=True)
    assert taken.stopped
    assert len(taken.readings) == 3
    assert prompter.poll_timeouts == [2, 2, 2]
    assert clock.sleeps == [2, 2]  # only the two polls that timed out let time pass; none was a sleep


def test_collect_without_a_person_sleeps_instead_of_polling(clock: FakeClock, out: io.StringIO) -> None:
    prompter = ScriptedPrompter(interactive=False)
    ctx = Context(FakeRunner(), prompter, out, clock.sleep, clock.monotonic)
    taken = light.collect(ctx, light._Recorder(ctx, FakeSensor(5), None), duration=3, interval=1, stoppable=True)
    assert len(taken.readings) == 3
    assert prompter.poll_timeouts == []
    assert clock.sleeps == [1, 1]


def test_a_slow_reading_does_not_stretch_the_run(ctx: Context, clock: FakeClock) -> None:
    class SlowSensor(FakeSensor):
        def read_lux(self) -> float:
            clock.sleep(0.4)
            clock.sleeps.pop()
            return super().read_lux()

    taken = light.collect(ctx, light._Recorder(ctx, SlowSensor(5), None), duration=3, interval=1)
    assert [reading.seconds for reading in taken.readings] == pytest.approx([0.4, 1.4, 2.4])
    assert clock.sleeps == pytest.approx([0.6, 0.6])


# ---- the probe -----------------------------------------------------------------------------------------------


def check(section: Section, name: str) -> Any:
    return next(item for item in section.checks if item.name == name)


def quiet_args(**overrides: Any) -> argparse.Namespace:
    return make_args(**{"seconds": 5, "step_seconds": 3, **overrides})


def test_agent_code_missing_is_a_failed_check(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    def missing() -> None:
        raise AgentCodeMissing("the agent's code is not here")

    monkeypatch.setattr(light, "ensure_agent_code", missing)
    section = light.run(make_args(), ctx)
    assert section.failed
    assert "not here" in check(section, "Agent code").detail


def test_missing_bus_fails_with_the_raspi_config_hint(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(light, "bus_exists", lambda bus: bus == 1)
    section = light.run(make_args(bus=3), ctx)
    detail = check(section, "I2C bus").detail
    assert section.failed
    assert "/dev/i2c-3" in detail
    assert "raspi-config" in detail


def test_auto_tries_each_chip_and_the_first_that_reads_wins(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    veml = FakeSensor(LightError("[Errno 121] Remote I/O error"))
    bh_low = FakeSensor(143.2)
    asked = use_sensors(monkeypatch, veml, bh_low, FakeSensor(1))
    section = light.run(quiet_args(), ctx)
    assert asked[:2] == [("veml7700", 1, 0x10), ("bh1750", 1, 0x23)]
    assert check(section, "Sensor").detail == "BH1750 at 0x23 on bus 1, 143.2 lx"
    assert check(section, "Sensor").status is Status.PASS
    assert veml.closed == 1  # the one that didn't answer is let go
    assert bh_low.closed == 1  # and the one in use is released at the end


def test_auto_goes_on_to_the_second_bh1750_address(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    error = LightError("no")
    asked = use_sensors(monkeypatch, FakeSensor(error), FakeSensor(error), FakeSensor(7.5))
    section = light.run(quiet_args(), ctx)
    assert asked[2] == ("bh1750", 1, 0x5C)
    assert "BH1750 at 0x5c on bus 1" in check(section, "Sensor").detail
    assert section.fact_value("Address") == "0x5c on I2C bus 1"


def test_no_sensor_fails_with_each_error_and_a_hint(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    sensors = [
        FakeSensor(LightError("the smbus2 library is not installed")),
        FakeSensor(LightError("the smbus2 library is not installed")),
        FakeSensor(LightError("the smbus2 library is not installed")),
    ]
    use_sensors(monkeypatch, *sensors)
    section = light.run(make_args(), ctx)
    detail = check(section, "Sensor").detail
    assert section.failed
    assert "VEML7700 at 0x10" in detail
    assert "BH1750 at 0x23" in detail
    assert "BH1750 at 0x5c" in detail
    assert any("python3-smbus2" in note for note in section.notes)
    assert all(sensor.closed == 1 for sensor in sensors)


def test_a_chosen_chip_and_address_are_the_only_one_tried(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    asked = use_sensors(monkeypatch, FakeSensor(50))
    light.run(quiet_args(chip="bh1750", address=0x5C, bus=0), ctx)
    assert asked == [("bh1750", 0, 0x5C)]


def test_auto_with_an_address_tries_both_chips_there(ctx: Context, monkeypatch: pytest.MonkeyPatch) -> None:
    asked = use_sensors(monkeypatch, FakeSensor(LightError("no")), FakeSensor(LightError("no")))
    light.run(make_args(address=0x44), ctx)
    assert asked == [("veml7700", 1, 0x44), ("bh1750", 1, 0x44)]


def test_unattended_run_skips_the_guided_steps_and_keeps_the_watch(
    ctx: Context, out: io.StringIO, prompter: ScriptedPrompter, monkeypatch: pytest.MonkeyPatch
) -> None:
    prompter.interactive = False
    # Noise: 10 readings, then 5 s of watch. 100 lx steady, then a jump to 300 at the end.
    sensor = FakeSensor(*([100.0] * 12 + [300.0] * 5))
    use_sensors(monkeypatch, sensor)
    section = light.run(quiet_args(), ctx)
    assert not section.failed
    assert check(section, "Responds to light").status is Status.SKIP
    assert check(section, "Light levels").status is Status.SKIP
    assert "Noise" in [item.name for item in section.checks]
    assert check(section, "Watch").detail.startswith("5 readings")
    # Only the readings the agent would publish are printed when nobody is watching: the first, and the jump.
    shown = [line for line in out.getvalue().splitlines() if " lx" in line]
    assert len(shown) == 2
    assert all(line.endswith("published") for line in shown)
    assert prompter.pauses == []
    assert sensor.closed == 1


def test_would_publish_counts_the_watch(
    ctx: Context, prompter: ScriptedPrompter, monkeypatch: pytest.MonkeyPatch
) -> None:
    prompter.interactive = False
    use_sensors(monkeypatch, FakeSensor(*([100.0] * 11 + [100, 100, 150, 150, 150, 150, 150, 150])))
    section = light.run(make_args(seconds=8), ctx)
    # In the watch (readings 11 on): 100 (published, first), 100, 150 (published), then 150s
    assert check(section, "Would publish").detail.startswith("2 of 8 readings")


def test_csv_gets_every_reading_with_a_header(
    ctx: Context, prompter: ScriptedPrompter, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    prompter.interactive = False
    path = tmp_path / "log.csv"
    use_sensors(monkeypatch, FakeSensor(1.5, 2.5))
    light.run(quiet_args(csv=path, seconds=2), ctx)
    with path.open() as handle:
        rows = list(csv.reader(handle))
    assert rows[0] == ["iso_time", "seconds", "lux"]
    assert rows[1] == ["2026-01-02T03:04:05+00:00", "0.0", "2.500"]
    # 10 noise readings and 2 in the watch (the first read, which found the sensor, is not logged)
    assert len(rows) == 1 + 12


def test_csv_is_added_to_not_overwritten(
    ctx: Context, prompter: ScriptedPrompter, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    prompter.interactive = False
    path = tmp_path / "log.csv"
    path.write_text("iso_time,seconds,lux\nold,0,1\n")
    use_sensors(monkeypatch, FakeSensor(9))
    light.run(quiet_args(csv=path, seconds=1), ctx)
    text = path.read_text()
    assert text.startswith("iso_time,seconds,lux\nold,0,1\n")
    assert text.count("iso_time") == 1


def test_csv_that_cannot_be_opened_is_a_failed_check_and_releases_the_sensor(
    ctx: Context, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    sensor = FakeSensor(9)
    use_sensors(monkeypatch, sensor)
    section = light.run(quiet_args(csv=tmp_path / "nowhere" / "log.csv"), ctx)
    assert check(section, "CSV file").status is Status.FAIL
    assert sensor.closed == 1


def test_sensor_that_dies_midway_fails_and_still_analyses(
    ctx: Context, prompter: ScriptedPrompter, monkeypatch: pytest.MonkeyPatch
) -> None:
    prompter.interactive = False
    sensor = FakeSensor(*([50.0] * 14), LightError("Remote I/O error"))
    use_sensors(monkeypatch, sensor)
    section = light.run(make_args(seconds=100), ctx)
    assert check(section, "Readings").status is Status.FAIL
    assert "Remote I/O error" in check(section, "Readings").detail
    assert check(section, "Watch").status is Status.INFO
    assert sensor.closed == 1


def test_ctrl_c_releases_the_sensor(ctx: Context, prompter: ScriptedPrompter, monkeypatch: pytest.MonkeyPatch) -> None:
    prompter.interactive = False

    # KeyboardInterrupt is not an Exception the probe catches; it must still close the sensor.
    class Interrupting(FakeSensor):
        def read_lux(self) -> float:
            if self.reads >= 2:
                raise KeyboardInterrupt
            return super().read_lux()

    sensor = Interrupting(5)
    use_sensors(monkeypatch, sensor)
    with pytest.raises(KeyboardInterrupt):
        light.run(make_args(), ctx)
    assert sensor.closed == 1


def guided_ctx(
    clock: FakeClock, out: io.StringIO, enter_polls: Sequence[bool] = (True,)
) -> tuple[Context, ClockedPrompter]:
    prompter = ClockedPrompter(clock, enter_polls=list(enter_polls))
    return Context(FakeRunner(), prompter, out, clock.sleep, clock.monotonic), prompter


def guided_script(
    first: float, baseline: float, covered: float, evening: float, dark: float, bright: float
) -> list[float]:
    """What the sensor says in turn: the find, the noise (10), then each guided step (3 readings at 1 s), then the
    watch (which is stopped by Enter after one reading)."""
    script = [first] + [baseline] * 10
    for value in (baseline, covered, evening, dark, bright):
        script += [value] * 3
    return [*script, bright]


def test_guided_run_passes_and_suggests_a_threshold(
    clock: FakeClock, out: io.StringIO, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx, prompter = guided_ctx(clock, out)
    use_sensors(monkeypatch, FakeSensor(*guided_script(150, 150, 2, 90, 1, 800)))
    section = light.run(make_args(seconds=60, step_seconds=3), ctx)
    assert not section.failed
    assert len(prompter.pauses) == 5
    assert check(section, "Responds to light").status is Status.PASS
    table = next(table for table in section.tables if table.title.startswith("Light levels"))
    assert table.headers == ["Condition", "Readings", "Min", "Median", "Max"]
    assert [row[0] for row in table.rows] == [
        light.BASELINE,
        light.COVERED,
        light.EVENING,
        light.DARK,
        light.BRIGHT,
        "Free watch",
    ]
    assert table.rows[3] == [light.DARK, "3", "1.00", "1.00", "1.00"]
    # sqrt(1 x 90) = 9.5, rounded to the nearest half
    assert check(section, "Darkness threshold").detail == "9.5 lx"
    assert any("policies.auto_brightness.night_below_lux: 9.5" in note for note in section.notes)
    assert any(
        note.startswith("Settings for pi-agent's /etc/wallcal-agent/config.yaml: light: {chip: ")
        for note in section.notes
    )


def test_guided_run_fails_when_covering_changes_nothing(
    clock: FakeClock, out: io.StringIO, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx, _ = guided_ctx(clock, out)
    use_sensors(monkeypatch, FakeSensor(*guided_script(150, 150, 140, 90, 1, 800)))
    section = light.run(make_args(seconds=60, step_seconds=3), ctx)
    assert check(section, "Responds to light").status is Status.FAIL
    assert section.failed


def test_no_threshold_when_evening_is_not_brighter_than_night(
    clock: FakeClock, out: io.StringIO, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx, _ = guided_ctx(clock, out)
    use_sensors(monkeypatch, FakeSensor(*guided_script(150, 150, 2, 5, 20, 800)))
    section = light.run(make_args(seconds=60, step_seconds=3), ctx)
    assert "Darkness threshold" not in [item.name for item in section.checks]
    assert any("no darkness threshold" in note for note in section.notes)


def test_noisy_sensor_gets_a_change_lux_suggestion(
    ctx: Context, prompter: ScriptedPrompter, monkeypatch: pytest.MonkeyPatch
) -> None:
    prompter.interactive = False
    noisy = [0.2, 0.9, 0.3, 0.8, 0.2, 0.9, 0.3, 0.8, 0.2, 0.9]
    use_sensors(monkeypatch, FakeSensor(0.5, *noisy, 0.5))
    section = light.run(make_args(seconds=1), ctx)
    assert any("change_lux: 1.4" in note for note in section.notes)
    # The settings block carries the suggestion, not the 0.5 that was used.
    assert any("change_lux: 1.4, report_seconds" in note for note in section.notes)


def test_busy_publishing_is_pointed_out(
    ctx: Context, prompter: ScriptedPrompter, monkeypatch: pytest.MonkeyPatch
) -> None:
    prompter.interactive = False
    swinging = [100.0, 200.0] * 10
    use_sensors(monkeypatch, FakeSensor(*([100.0] * 11 + swinging)))
    section = light.run(make_args(seconds=20), ctx)
    assert any("most of them" in note for note in section.notes)


def test_settings_block_reflects_the_options(
    ctx: Context, prompter: ScriptedPrompter, monkeypatch: pytest.MonkeyPatch
) -> None:
    prompter.interactive = False
    use_sensors(monkeypatch, FakeSensor(100))
    section = light.run(
        make_args(seconds=1, chip="bh1750", address=0x5C, bus=0, change_percent=15, report_seconds=60), ctx
    )
    note = next(note for note in section.notes if note.startswith("Settings for"))
    assert "light: {chip: bh1750, bus: 0, address: 0x5c, sample_ms: 1000, change_percent: 15, change_lux: 0.5" in note
    assert "report_seconds: 60}" in note
