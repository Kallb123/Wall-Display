import argparse
import glob
import json
import os
import shutil
import stat
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from hw_probe import render, wayland
from hw_probe.context import Context
from hw_probe.report import Section, Status


def parse(*argv: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    render.add_arguments(parser)
    return parser.parse_args(list(argv))


def get(url: str) -> tuple[int, dict[str, str], bytes]:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read()


def post(url: str, body: object | bytes) -> int:
    data = body if isinstance(body, bytes) else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def sample_results() -> dict:
    def phase(name: str, frames: int, dropped: int, **extra: object) -> dict:
        return {
            "name": name,
            "seconds": frames / 60,
            "frames": frames,
            "droppedFrames": dropped,
            "frameMs": {"mean": 16.68, "median": 16.67, "p95": 16.9, "p99": 17.4, "max": 34.1},
            **extra,
        }

    return {
        "version": 1,
        "userAgent": "Mozilla/5.0 Chrome/130",
        "viewport": {"width": 2560, "height": 1440, "devicePixelRatio": 1, "stageScale": 1.0},
        "refreshIntervalMs": 16.68,
        "gpu": {"webgl": True, "vendor": "Broadcom", "renderer": "V3D 7.1"},
        "fonts": [
            {"family": "Caprasimo", "weight": "400", "status": "loaded"},
            {"family": "Figtree", "weight": "400", "status": "loaded"},
            {"family": "Figtree", "weight": "500", "status": "loaded"},
        ],
        "colour": {
            "oklchSupported": True,
            "colorMixSupported": True,
            "oklchPixel": {
                "css": "oklch(62.8% 0.2577 29.23)",
                "expected": [255, 0, 0],
                "actual": [255, 0, 0],
                "ok": True,
            },
            "colorMixPixel": {"css": "color-mix(...)", "expected": [99, 99, 99], "actual": [99, 99, 99], "ok": True},
        },
        "phases": [
            phase("month", 1199, 2),
            phase("photo", 3000, 5),
            phase("crossfade", 800, 4, fades=9),
        ],
        "photos": {"source": "generated", "count": 4, "prepareMs": 2100, "decodeMs": [41.2, 39.8, 50.0]},
        "memory": {"jsHeapUsedMB": 14.2, "jsHeapTotalMB": 20.0},
        "errors": [],
    }


def evaluated(results: dict, memory: render.MemoryTracker | None = None) -> Section:
    section = Section("Render probe")
    render.evaluate(results, memory, section)
    return section


def check(section: Section, name: str):
    return next(c for c in section.checks if c.name == name)


# -- flags


def test_parse_flags_trims_and_skips_comments():
    assert render.parse_flags("# c\n\n  --kiosk  \n\t--a=b\n  # indented comment\nlast") == ["--kiosk", "--a=b", "last"]


def test_find_flags_explicit_wins():
    files = {"/x/flags": "--one\n", "/etc/wallcal-kiosk/chromium-flags.conf": "--two\n"}
    assert render.find_flags(Path("/x/flags"), files.get) == (["--one"], "/x/flags")
    assert render.find_flags(Path("/missing"), files.get) is None


def test_find_flags_installed_files_then_repo():
    files = {
        "/etc/wallcal-kiosk/chromium-flags.conf": "--a\n",
        "/etc/wallcal-kiosk/chromium-flags.local.conf": "--b\n",
        "/repo/flags": "--repo\n",
    }
    flags, source = render.find_flags(None, files.get, Path("/repo/flags"))
    assert flags == ["--a", "--b"]
    assert "chromium-flags.local.conf" in source
    del files["/etc/wallcal-kiosk/chromium-flags.local.conf"]
    assert render.find_flags(None, files.get, Path("/repo/flags"))[0] == ["--a"]
    del files["/etc/wallcal-kiosk/chromium-flags.conf"]
    assert render.find_flags(None, files.get, Path("/repo/flags")) == (["--repo"], "/repo/flags")
    assert render.find_flags(None, files.get, Path("/nope")) is None


def test_repo_flags_file_exists_and_parses():
    flags = render.parse_flags(render.repo_flags_file().read_text())
    assert "--kiosk" in flags
    assert "--ozone-platform=wayland" in flags


# -- server


@pytest.fixture
def photo_files(tmp_path: Path) -> list[Path]:
    for name, body in (("b.jpg", b"JPEGB"), ("a.png", b"PNGA"), ("notes.txt", b"x")):
        (tmp_path / name).write_bytes(body)
    return render.list_photos(tmp_path)


@pytest.fixture
def static_root(tmp_path: Path) -> Path:
    root = tmp_path / "static"
    (root / "fonts").mkdir(parents=True)
    (root / "index.html").write_text("<h1>hi</h1>")
    (root / "bench.js").write_text("1")
    (root / "fonts" / "f.woff2").write_bytes(b"wOF2")
    (tmp_path / "secret.txt").write_text("secret")
    return root


@pytest.fixture
def server(static_root: Path, photo_files: list[Path]):
    progress: list[tuple[str, str]] = []
    config = render.build_config(parse("--seconds", "30", "--no-drift"), photo_files)
    srv = render.BenchServer(config, photo_files, static_root, lambda p, m: progress.append((p, m)))
    srv.start()
    srv.progress = progress  # type: ignore[attr-defined]
    yield srv
    srv.stop()


def test_list_photos_sorted_and_filtered(photo_files: list[Path]):
    assert [p.name for p in photo_files] == ["a.png", "b.jpg"]


def test_config_json(server: render.BenchServer):
    status, headers, body = get(server.url + "config.json")
    assert status == 200
    assert headers["Cache-Control"] == "no-store"
    assert json.loads(body) == {
        "warmupSeconds": 5,
        "monthSeconds": 20,
        "photoSeconds": 30,
        "fadeSeconds": 1.5,
        "photoIntervalSeconds": 6,
        "drift": False,
        "photos": ["/photos/0", "/photos/1"],
    }


def test_config_without_photos():
    config = render.build_config(parse(), [])
    assert config["photos"] == []
    assert config["drift"] is True
    assert config["photoSeconds"] == 60


def test_static_files_and_content_types(server: render.BenchServer):
    status, headers, body = get(server.url)
    assert (status, body) == (200, b"<h1>hi</h1>")
    assert headers["Content-Type"].startswith("text/html")
    assert get(server.url + "bench.js")[1]["Content-Type"].startswith("text/javascript")
    status, headers, body = get(server.url + "fonts/f.woff2")
    assert (status, headers["Content-Type"], body) == (200, "font/woff2", b"wOF2")
    assert headers["Cache-Control"] == "no-store"


def test_no_listing_and_no_traversal(server: render.BenchServer):
    assert get(server.url + "fonts/")[0] == 404
    assert get(server.url + "nope")[0] == 404
    port = server.url.split(":")[2].rstrip("/")
    import socket

    for raw in ("/../secret.txt", "/%2e%2e/secret.txt", "/fonts/../../secret.txt", "/%00"):
        with socket.create_connection(("127.0.0.1", int(port)), timeout=5) as sock:
            sock.sendall(f"GET {raw} HTTP/1.0\r\n\r\n".encode())
            reply = b""
            while chunk := sock.recv(4096):
                reply += chunk
        assert b"secret" not in reply.split(b"\r\n\r\n", 1)[-1]
        assert reply.split(b" ", 2)[1] in (b"404", b"400")


def test_photos_served_by_index(server: render.BenchServer):
    assert get(server.url + "photos/0")[2] == b"PNGA"
    assert get(server.url + "photos/0")[1]["Content-Type"] == "image/png"
    assert get(server.url + "photos/1")[2] == b"JPEGB"
    assert get(server.url + "photos/2")[0] == 404
    assert get(server.url + "photos/-1")[0] == 404
    assert get(server.url + "photos/a.png")[0] == 404
    assert get(server.url + "photos/")[0] == 404


def test_progress_and_results_posts(server: render.BenchServer):
    assert post(server.url + "progress", {"phase": "month", "message": "Measuring"}) == 204
    assert server.progress == [("month", "Measuring")]  # type: ignore[attr-defined]
    assert not server.wait(0)
    assert post(server.url + "results", b"not json") == 400
    assert post(server.url + "results", [1, 2]) == 400
    assert not server.done
    waiter: list[bool] = []
    thread = threading.Thread(target=lambda: waiter.append(server.wait(5)))
    thread.start()
    assert post(server.url + "results", {"version": 1}) == 204
    thread.join()
    assert waiter == [True]
    assert server.results == {"version": 1}
    assert post(server.url + "other", {}) == 404


# -- command building


def test_build_command_is_flags_profile_url():
    assert render.build_command("/usr/bin/chromium", ["--kiosk", "--a=b"], "/tmp/p", "http://127.0.0.1:1/") == [
        "/usr/bin/chromium",
        "--kiosk",
        "--a=b",
        "--user-data-dir=/tmp/p",
        "http://127.0.0.1:1/",
    ]


COMMAND = ["chromium", "--kiosk", "http://x/"]
SESSION = wayland.Session("/run/user/1000/wayland-0")


def which_only(*names: str):
    return lambda name: f"/usr/bin/{name}" if name in names else None


def test_plan_existing_session():
    plan = render.plan_launch("auto", SESSION, which_only("cage"))
    assert plan.kind == "existing"
    assert plan.argv(COMMAND) == COMMAND
    assert plan.env == {"WAYLAND_DISPLAY": SESSION.socket, "XDG_RUNTIME_DIR": "/run/user/1000"}
    assert "/run/user/1000/wayland-0" in plan.description


def test_plan_cage_then_labwc_when_no_session():
    cage = render.plan_launch("auto", None, which_only("cage", "labwc"))
    assert cage.argv(COMMAND) == ["cage", "--", *COMMAND]
    assert cage.description == "started cage"
    labwc = render.plan_launch("auto", None, which_only("labwc"))
    assert labwc.argv(COMMAND) == ["labwc", "-s", "chromium --kiosk http://x/"]


def test_plan_forced_and_missing():
    assert render.plan_launch("labwc", SESSION, which_only("cage", "labwc")).kind == "labwc"
    assert render.plan_launch("cage", None, which_only("labwc")) is None
    assert render.plan_launch("existing", None, which_only("cage")) is None
    assert render.plan_launch("auto", None, which_only()) is None
    assert render.plan_launch("auto", None, which_only("cage"), explicit_display=True) is None


def test_labwc_quotes_arguments():
    plan = render.LaunchPlan("labwc", "x")
    assert plan.argv(["c", "--a=b c"]) == ["labwc", "-s", "c '--a=b c'"]


# -- memory sampling


def write_proc(root: Path, pid: int, comm: str, ppid: int, cmdline: list[str], pss: int | None, rss: int | None = None):
    folder = root / str(pid)
    folder.mkdir()
    (folder / "stat").write_text(f"{pid} ({comm}) S {ppid} {pid} {pid} 0 -1 0\n")
    (folder / "cmdline").write_text("\x00".join(cmdline) + "\x00")
    if pss is not None:
        (folder / "smaps_rollup").write_text(f"Rss: 1 kB\nPss: {pss} kB\n")
    if rss is not None:
        (folder / "status").write_text(f"Name: {comm}\nVmRSS:\t{rss} kB\n")


@pytest.fixture
def proc_root(tmp_path: Path) -> Path:
    root = tmp_path / "proc"
    root.mkdir()
    write_proc(root, 100, "cage", 1, ["cage", "--", "/usr/bin/chromium"], 5000)
    write_proc(root, 101, "chromium", 100, ["/usr/bin/chromium", "--kiosk"], 200000)
    write_proc(root, 102, "chromium", 101, ["/usr/bin/chromium", "--type=zygote"], 10000)
    write_proc(root, 103, "chromium", 102, ["/usr/bin/chromium", "--type=renderer"], None, rss=150000)
    write_proc(root, 104, "chrome (gpu)", 101, ["/usr/bin/chromium", "--type=gpu-process"], 80000)
    write_proc(root, 105, "bash", 101, ["bash"], 999)  # a child that is not Chromium
    write_proc(root, 200, "chromium", 1, ["/usr/bin/chromium"], 777777)  # not ours
    (root / "meminfo").write_text("MemTotal: 8000000 kB\nMemAvailable:    5000000 kB\n")
    (root / "self").mkdir()
    return root


def test_sample_memory_walks_the_tree(proc_root: Path):
    sample = render.sample_memory(100, "/usr/bin/chromium", str(proc_root))
    assert {(p.pid, p.kind, p.kb) for p in sample.processes} == {
        (101, "browser", 200000),
        (102, "zygote", 10000),
        (103, "renderer", 150000),  # PSS missing: falls back to VmRSS
        (104, "gpu-process", 80000),
    }
    assert sample.total_kb == 440000
    assert sample.by_kind()["renderer"] == 150000


def test_sample_memory_matches_by_argv0_when_comm_differs(proc_root: Path):
    write_proc(proc_root, 106, "exe", 101, ["/usr/lib/chromium/chromium", "--type=utility"], 1234)
    kinds = {p.kind for p in render.sample_memory(100, "chromium", str(proc_root)).processes}
    assert "utility" in kinds


def test_sample_memory_empty_for_unknown_root(proc_root: Path):
    assert render.sample_memory(999, "chromium", str(proc_root)).processes == ()
    assert render.sample_memory(1, "chromium", str(proc_root / "missing")).processes == ()


def test_mem_available_and_other_chromium(proc_root: Path):
    assert render.mem_available_kb(str(proc_root)) == 5000000
    assert render.mem_available_kb(str(proc_root / "missing")) is None
    assert render.other_chromium_running(str(proc_root))
    (proc_root / "200" / "stat").write_text("200 (nginx) S 1 1 1 0\n")
    for pid in (101, 102, 103):
        (proc_root / str(pid) / "stat").write_text(f"{pid} (foo) S 1 1 1 0\n")
    (proc_root / "104" / "stat").write_text("104 (foo) S 1 1 1 0\n")
    assert not render.other_chromium_running(str(proc_root))


def test_tracker_keeps_peak_last_and_lowest():
    big = render.MemorySample((render.ProcessMemory(1, "browser", 900),))
    small = render.MemorySample((render.ProcessMemory(1, "browser", 100),))
    tracker = render.MemoryTracker()
    tracker.add(small, 500)
    tracker.add(big, 300)
    tracker.add(small, None)
    assert tracker.peak is big
    assert tracker.last is small
    assert tracker.min_available_kb == 300


# -- checks and tables


def test_evaluate_all_good():
    memory = render.MemoryTracker()
    memory.add(
        render.MemorySample(
            (render.ProcessMemory(1, "browser", 200 * 1024), render.ProcessMemory(2, "renderer", 212 * 1024))
        ),
        4 * 1024 * 1024,
    )
    section = evaluated(sample_results(), memory)
    statuses = {c.name: c.status for c in section.checks}
    assert not section.failed
    assert check(section, "GPU").detail == "WebGL on V3D 7.1"
    assert check(section, "Screen").detail == "2560×1440 at DPR 1, stage at 100%"  # noqa: RUF001
    assert section.fact_value("Refresh") == "59.95 Hz (16.68 ms)"
    assert check(section, "Fonts").detail == "Caprasimo 400, Figtree 400/500 loaded"
    assert statuses["OKLCH colours"] == statuses["color-mix() in OKLCH"] == Status.PASS
    assert check(section, "Month grid smoothness").detail == "2 frames dropped, 0.2% of refreshes, worst 34.1 ms"
    assert check(section, "Crossfade smoothness").detail.endswith("across 9 fades")
    assert "Page errors" not in statuses
    assert check(section, "Memory").detail == "peak 412 MiB across 2 Chromium processes"
    frame, mem = section.tables
    assert frame.title == "Frame times"
    assert [row[0] for row in frame.rows] == ["month grid", "photo (between fades)", "crossfade"]
    assert frame.rows[0][:4] == ["month grid", "1199", "20.0", "60.0"]
    assert len(frame.headers) == len(frame.rows[0]) == 10
    assert mem.title == "Chromium memory (PSS)"
    assert mem.rows[-1] == ["Total", "412", "412"]
    assert any("Lowest MemAvailable: 4096 MiB" in n for n in section.notes)
    assert any("JS heap: 14.2" in n for n in section.notes)
    assert any("median 41.2 ms, worst 50.0 ms" in n for n in section.notes)
    assert any("PR 4.2" in n for n in section.notes)


def test_evaluate_without_memory_or_heap():
    results = sample_results()
    results["memory"] = None
    section = evaluated(results)
    assert len(section.tables) == 1
    assert "Memory" not in {c.name for c in section.checks}


def test_software_gpu_fails():
    for renderer in ("Google SwiftShader", "llvmpipe (LLVM 15)", "Software rasterizer"):
        results = sample_results()
        results["gpu"]["renderer"] = renderer
        got = check(evaluated(results), "GPU")
        assert got.status is Status.FAIL
        assert "GPU is not being used" in got.detail
    results = sample_results()
    results["gpu"] = {"webgl": False, "vendor": "", "renderer": ""}
    assert check(evaluated(results), "GPU").status is Status.FAIL


def test_font_error_fails():
    results = sample_results()
    results["fonts"][2]["status"] = "error"
    got = check(evaluated(results), "Fonts")
    assert got.status is Status.FAIL
    assert "Figtree 500 (error)" in got.detail


def test_oklch_pixel_mismatch_and_unsupported():
    results = sample_results()
    results["colour"]["oklchPixel"].update(ok=False, actual=[250, 10, 10])
    results["colour"]["colorMixSupported"] = False
    section = evaluated(results)
    assert check(section, "OKLCH colours").status is Status.FAIL
    assert "expected rgb(255, 0, 0), got rgb(250, 10, 10)" in check(section, "OKLCH colours").detail
    assert check(section, "color-mix() in OKLCH").status is Status.FAIL
    results["colour"]["oklchPixel"].update(actual=None)
    assert "unreadable" in check(evaluated(results), "OKLCH colours").detail


def test_dropped_frame_thresholds():
    results = sample_results()
    results["phases"][0]["droppedFrames"] = 13  # 13 of 1212 refreshes is just over 1%
    results["phases"][2]["droppedFrames"] = 16  # 16 of 816 refreshes is just under 2%
    section = evaluated(results)
    assert check(section, "Month grid smoothness").status is Status.FAIL
    assert check(section, "Crossfade smoothness").status is Status.PASS
    results["phases"][2]["droppedFrames"] = 17
    assert check(evaluated(results), "Crossfade smoothness").status is Status.FAIL


def test_no_fades_is_skipped_not_passed():
    results = sample_results()
    results["phases"][2].update(frames=0, droppedFrames=0, fades=0)
    assert check(evaluated(results), "Crossfade smoothness").status is Status.SKIP


def test_missing_phase_and_page_errors():
    results = sample_results()
    results["phases"] = results["phases"][:1]
    results["errors"] = ["a", "b", "c", "d"]
    section = evaluated(results)
    assert check(section, "Crossfade smoothness").status is Status.FAIL
    errors = check(section, "Page errors")
    assert errors.status is Status.FAIL
    assert errors.detail == "a; b; c (and 1 more)"
    assert len(section.tables[0].rows) == 1


# -- the probe end to end with a stand-in browser


@pytest.fixture
def isolated(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """No real /proc, no real compositor, no real VT."""
    proc = tmp_path / "emptyproc"
    proc.mkdir()
    monkeypatch.setattr(render, "PROC_ROOT", str(proc))
    monkeypatch.setattr(render, "on_console_vt", lambda: True)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path / "no-runtime"))


def fast_args(*extra: str) -> argparse.Namespace:
    return parse("--seconds", "1", "--month-seconds", "1", "--warmup", "1", *extra)


def test_no_launch_run_collects_results(ctx: Context, out, isolated):
    args = fast_args("--no-launch")

    def poster() -> None:
        import re
        import time

        for _ in range(100):
            found = re.search(r"http://127\.0\.0\.1:\d+/", out.getvalue())
            if found:
                break
            time.sleep(0.05)
        post(found.group(0) + "progress", {"phase": "month", "message": "going"})
        post(found.group(0) + "results", sample_results())

    thread = threading.Thread(target=poster)
    thread.start()
    section = render.run(args, ctx)
    thread.join()
    assert check(section, "Page ran").status is Status.PASS
    assert not section.failed
    assert "month: going" in out.getvalue()
    assert section.fact_value("Browser") == "Mozilla/5.0 Chrome/130"


def test_no_compositor_reads_well(ctx: Context, runner, isolated, tmp_path: Path):
    runner.on(["/usr/bin/chromium", "--version"], "Chromium 130.0\n")
    flags = tmp_path / "flags.conf"
    flags.write_text("--kiosk\n")
    ctx.which = lambda name: f"/usr/bin/{name}" if name == "chromium" else None
    section = render.run(fast_args("--flags", str(flags), "--wayland-display", "/nope"), ctx)
    got = check(section, "Compositor")
    assert got.status is Status.FAIL
    assert got.detail.startswith("no Wayland session and no compositor to start")
    assert section.fact_value("Chromium") == "Chromium 130.0"


def test_missing_browser_and_flags_and_photos(ctx: Context, runner, isolated, tmp_path: Path):
    runner.on(["/b", "--version"], "B 1\n")
    ctx.which = lambda name: None
    assert check(render.run(fast_args(), ctx), "Chromium").detail == "not installed (sudo apt install chromium)"
    ctx.which = lambda name: "/usr/bin/chromium"
    section = render.run(fast_args("--browser", "/b", "--flags", str(tmp_path / "x")), ctx)
    assert check(section, "Kiosk flags").status is Status.FAIL
    (tmp_path / "one.jpg").write_bytes(b"x")
    section = render.run(fast_args("--photos", str(tmp_path)), ctx)
    assert check(section, "Photos").status is Status.FAIL
    section = render.run(fast_args("--photos", str(tmp_path / "missing")), ctx)
    assert check(section, "Photos").status is Status.FAIL


FAKE_BROWSER = """#!/bin/sh
# last argument is the URL
for last; do :; done
exec {python} {poster} "$last" "$MODE"
"""

POSTER = """
import json, sys, urllib.request
url, mode = sys.argv[1], sys.argv[2]
if mode == "exit":
    print("boom: cannot open display")
    sys.exit(3)
body = json.dumps(json.load(open(sys.argv[0] + ".json"))).encode()
urllib.request.urlopen(urllib.request.Request(url + "results", data=body, method="POST"))
"""


def make_fake_browser(tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch) -> str:
    poster = tmp_path / "poster.py"
    poster.write_text(POSTER)
    Path(str(poster) + ".json").write_text(json.dumps(sample_results()))
    browser = tmp_path / "fakechromium"
    browser.write_text(FAKE_BROWSER.format(python=sys.executable, poster=poster))
    browser.chmod(browser.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("MODE", mode)
    return str(browser)


@pytest.mark.parametrize("mode", ["ok", "exit"])
def test_launch_path_with_a_stand_in_browser(
    mode: str, ctx: Context, runner, isolated, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    browser = make_fake_browser(tmp_path, mode, monkeypatch)
    runner.on([browser, "--version"], "Fake Chromium 1\n")
    flags = tmp_path / "flags.conf"
    flags.write_text("--kiosk\n")
    monkeypatch.setattr(wayland, "find_session", lambda *a, **k: wayland.Session("/run/user/1/wayland-0"))
    ctx.which = lambda name: None
    section = render.run(fast_args("--browser", browser, "--flags", str(flags)), ctx)
    assert check(section, "Compositor").detail == "the running one at /run/user/1/wayland-0"
    assert check(section, "Kiosk flags").detail.startswith("1 flags from ")
    page = check(section, "Page ran")
    if mode == "ok":
        assert page.status is Status.PASS
        assert check(section, "GPU").status is Status.PASS
    else:
        assert page.status is Status.FAIL
        assert "exited with status 3" in page.detail
        assert "boom: cannot open display" in page.detail


# -- the page itself


def find_chromium() -> str | None:
    env = os.environ.get("HW_PROBE_TEST_CHROMIUM")
    if env:
        return env
    for pattern in ("/opt/pw-browsers/chromium*/chrome-linux*/chrome",):
        found = sorted(glob.glob(pattern))
        if found:
            return found[-1]
    for name in ("google-chrome", "chromium", "chromium-browser"):
        path = shutil.which(name)
        if path:
            return path
    return None


def test_page_in_headless_chromium(tmp_path: Path):
    browser = find_chromium()
    if browser is None:
        pytest.skip("no Chromium to run the page in")
    args = parse(
        "--warmup", "1", "--month-seconds", "2", "--seconds", "4", "--photo-interval", "2", "--fade-seconds", "0.5"
    )
    server = render.BenchServer(render.build_config(args, []))
    url = server.start()
    proc = subprocess.Popen(
        [
            browser,
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu-sandbox",
            "--window-size=1280,720",
            f"--user-data-dir={tmp_path / 'profile'}",
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        arrived = server.wait(90)
    finally:
        render.stop_process_group(proc, lambda s: None)
        server.stop()
    assert arrived, "the page posted no results within 90 s"
    results = server.results
    assert results["version"] == 1
    phases = {p["name"]: p for p in results["phases"]}
    assert set(phases) == {"month", "photo", "crossfade"}
    assert all(p["frames"] > 0 for p in phases.values())
    assert results["fonts"]
    assert all(f["status"] == "loaded" for f in results["fonts"])
    assert results["colour"]["oklchPixel"]["ok"] is True
    assert results["colour"]["colorMixPixel"]["ok"] is True
    assert results["errors"] == []
    section = Section("Render probe")
    render.evaluate(results, None, section)
    assert check(section, "Fonts").status is Status.PASS
