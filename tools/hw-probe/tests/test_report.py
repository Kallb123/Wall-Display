from datetime import datetime

from hw_probe.report import REPORT_HEADER, Check, Section, Status, Table, append_to_report, summary_text, to_markdown

WHEN = datetime(2026, 11, 13, 14, 2)


def sample() -> Section:
    section = Section("Screen probe")
    section.fact("Host", "wallcal-pi")
    section.fact("Model", "Raspberry Pi 5 Model B Rev 1.0")
    section.add("CEC adapter", Status.PASS, "/dev/cec0")
    section.add("CEC standby", Status.SKIP, "needs someone watching the screen")
    section.add("DDC/CI monitor", Status.FAIL, "no display | answered\nover DDC")
    section.tables.append(Table("Frame times", ["Phase", "Frames"], [["month", "1199"], ["photo", "3600"]]))
    section.notes = ["note one", "note two"]
    return section


def test_add_returns_the_check_and_failed_reflects_failures():
    section = Section("X")
    check = section.add("a", Status.PASS)
    assert check == Check("a", Status.PASS, "")
    assert not section.failed
    section.add("b", Status.INFO)
    section.add("c", Status.SKIP)
    assert not section.failed
    section.add("d", Status.FAIL)
    assert section.failed


def test_status_values():
    assert [s.value for s in Status] == ["pass", "fail", "skipped", "info"]


def test_summary_text_aligns_and_counts():
    lines = summary_text(sample()).splitlines()
    assert lines[0] == "Screen probe"
    assert "PASS  CEC adapter     /dev/cec0" in lines
    assert "SKIP  CEC standby     needs someone watching the screen" in lines
    assert lines[-1] == "1 passed, 1 failed, 1 skipped"
    assert "Frame times" in lines
    assert "  Phase  Frames" in lines
    assert "  month  1199" in lines
    assert "- note one" in lines


def test_summary_text_without_checks():
    assert summary_text(Section("Empty")).splitlines()[-1] == "0 passed, 0 failed, 0 skipped"


def test_markdown_format():
    markdown = to_markdown(sample(), WHEN)
    assert markdown.startswith("## Screen probe: Raspberry Pi 5 Model B Rev 1.0, 2026-11-13 14:02\n\n")
    assert "| Fact | Value |\n|---|---|\n| Host | wallcal-pi |" in markdown
    assert "| Check | Result | Detail |\n|---|---|---|\n| CEC adapter | pass | /dev/cec0 |" in markdown
    assert "| CEC standby | skipped | needs someone watching the screen |" in markdown
    assert "| DDC/CI monitor | fail | no display \\| answered over DDC |" in markdown
    assert "#### Frame times\n\n| Phase | Frames |\n|---|---|\n| month | 1199 |" in markdown
    assert markdown.endswith("\n\n- note one\n- note two\n")


def test_heading_uses_host_without_model_and_nothing_without_either():
    section = Section("Render probe")
    section.fact("Host", "wallcal-pi")
    assert to_markdown(section, WHEN).startswith("## Render probe: wallcal-pi, 2026-11-13 14:02\n")
    assert to_markdown(Section("Render probe"), WHEN).startswith("## Render probe, 2026-11-13 14:02\n")


def test_append_creates_the_report_with_its_header(tmp_path):
    path = tmp_path / "docs" / "findings.md"
    append_to_report(path, sample(), WHEN)
    text = path.read_text()
    assert text.startswith(REPORT_HEADER + "\n## Screen probe")
    assert text.startswith("# Hardware findings\n\nWhat `tools/hw-probe` found on the real hardware")
    assert "Commit this file as `docs/hardware-findings.md`.\n\n## Screen probe" in text


def test_append_adds_a_section_without_rewriting_earlier_content(tmp_path):
    path = tmp_path / "findings.md"
    append_to_report(path, sample(), WHEN)
    first = path.read_text()
    second = Section("Render probe")
    second.add("Page ran", Status.PASS, "ran for 85 s")
    append_to_report(path, second, datetime(2026, 11, 14, 9, 0))
    text = path.read_text()
    assert text.startswith(first)
    assert text[len(first) :].startswith("\n## Render probe, 2026-11-14 09:00\n")
    assert text.count("# Hardware findings") == 1


def test_append_to_a_file_with_no_final_newline(tmp_path):
    path = tmp_path / "findings.md"
    path.write_text("# Mine")
    append_to_report(path, Section("Screen probe"), WHEN)
    assert path.read_text().startswith("# Mine\n\n## Screen probe")


def test_heading_skips_an_unknown_model():
    section = Section("Render probe", facts=[("Host", "wallcal-pi"), ("Model", "unknown")])
    heading = to_markdown(section, datetime(2026, 11, 13, 14, 2)).splitlines()[0]
    assert heading == "## Render probe: wallcal-pi, 2026-11-13 14:02"
