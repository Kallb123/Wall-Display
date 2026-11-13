"""`hw-probe render`: how smoothly does the Pi's Chromium draw the calendar and photo pages?

A small web server on the loopback address serves a benchmark page (hw_probe/render/). Chromium opens it with the
kiosk's own flags, the page measures frame times and checks fonts, colours and the GPU, and posts the results back.
While it runs this module samples the memory of Chromium's processes from /proc.

The pieces are separate so they can be tested without a Pi: flags lookup, the server, the command that starts
Chromium, memory sampling, and the pure step from results to checks and tables.
"""

import argparse
import contextlib
import json
import mimetypes
import os
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
import urllib.parse
from collections import defaultdict
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from . import system, wayland
from .context import Context
from .report import Section, Status, Table
from .runner import CommandMissing, CommandTimeout

# Rough lines for "smooth enough" on a wall display, not specifications.
MONTH_DROPPED_MAX_PCT = 1.0
CROSSFADE_DROPPED_MAX_PCT = 2.0
SOFTWARE_RENDERERS = ("swiftshader", "llvmpipe", "software")

# The slack on top of the page's own durations before giving up on it.
EXTRA_WAIT_SECONDS = 120
SAMPLE_INTERVAL = 2.0
STOP_GRACE_SECONDS = 10
MAX_POST_BYTES = 8 * 1024 * 1024

INSTALLED_FLAGS = ("/etc/wallcal-kiosk/chromium-flags.conf", "/etc/wallcal-kiosk/chromium-flags.local.conf")
PHOTO_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")
CHROMIUM_NAMES = ("chromium", "chromium-browse", "chrome")
PROC_ROOT = "/proc"
STATIC_ROOT = Path(__file__).with_name("render")

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
}

# The page's "photo" phase holds only the frames outside crossfades; "crossfade" the frames inside them.
FRAME_LABELS = {"month": "month grid", "photo": "photo (between fades)", "crossfade": "crossfade"}

COMPOSITOR_MODES = ("auto", "existing", "cage", "labwc")


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--seconds", type=float, default=60, help="seconds to measure the photo frame (default 60)")
    parser.add_argument(
        "--month-seconds", type=float, default=20, help="seconds to measure the month grid (default 20)"
    )
    parser.add_argument("--warmup", type=float, default=5, help="seconds of warm-up before measuring (default 5)")
    parser.add_argument("--fade-seconds", type=float, default=1.5, help="crossfade length (default 1.5, as the app)")
    parser.add_argument("--photo-interval", type=float, default=6, help="seconds between photos (default 6)")
    parser.add_argument(
        "--no-drift", action="store_true", help="turn off the slow pan and zoom on photos (on by default, as the app)"
    )
    parser.add_argument(
        "--photos",
        type=Path,
        metavar="DIR",
        help="use the real photos in DIR (jpg, jpeg, png, webp; at least 2) instead of generated ones",
    )
    parser.add_argument("--browser", metavar="PATH", help="Chromium to run (default: chromium or chromium-browser)")
    parser.add_argument("--flags", type=Path, metavar="FILE", help="Chromium flags file (default: the kiosk's)")
    parser.add_argument(
        "--compositor",
        choices=COMPOSITOR_MODES,
        default="auto",
        help="where to show the page: the running compositor, or start cage or labwc (default auto)",
    )
    parser.add_argument("--wayland-display", metavar="PATH", help="Wayland socket of the running compositor")
    parser.add_argument(
        "--no-launch",
        action="store_true",
        help="serve the page and print its URL, then wait for a browser to post results",
    )


# ---------------------------------------------------------------------------------------------------------------
# Flags


def parse_flags(text: str) -> list[str]:
    """One flag per line, trimmed; blank lines and lines starting with # are skipped (as `read_flags` in the kiosk)."""
    flags = []
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            flags.append(line)
    return flags


def repo_flags_file() -> Path:
    return Path(__file__).resolve().parents[3] / "kiosk" / "chromium-flags.conf"


def find_flags(
    explicit: Path | None,
    read: Callable[[str], str | None] = system.read_text,
    repo_file: Path | None = None,
) -> tuple[list[str], str] | None:
    """The flags and the file(s) they came from: --flags, else the installed kiosk files, else the repo copy."""
    if explicit is not None:
        text = read(os.fspath(explicit))
        return (parse_flags(text), os.fspath(explicit)) if text is not None else None
    main_text = read(INSTALLED_FLAGS[0])
    if main_text is not None:
        flags = parse_flags(main_text)
        source = INSTALLED_FLAGS[0]
        local_text = read(INSTALLED_FLAGS[1])
        if local_text is not None:
            flags += parse_flags(local_text)
            source += f" and {INSTALLED_FLAGS[1]}"
        return flags, source
    repo = os.fspath(repo_file or repo_flags_file())
    text = read(repo)
    return (parse_flags(text), repo) if text is not None else None


# ---------------------------------------------------------------------------------------------------------------
# Config, photos and the server


def _number(value: float) -> float | int:
    return int(value) if float(value).is_integer() else value


def list_photos(directory: Path) -> list[Path]:
    return sorted(p for p in directory.iterdir() if p.is_file() and p.suffix.lower() in PHOTO_SUFFIXES)


def build_config(args: argparse.Namespace, photos: list[Path]) -> dict[str, Any]:
    return {
        "warmupSeconds": _number(args.warmup),
        "monthSeconds": _number(args.month_seconds),
        "photoSeconds": _number(args.seconds),
        "fadeSeconds": _number(args.fade_seconds),
        "photoIntervalSeconds": _number(args.photo_interval),
        "drift": not args.no_drift,
        "photos": [f"/photos/{index}" for index in range(len(photos))],
    }


def content_type(path: Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


class BenchServer:
    """Serves the page on 127.0.0.1 and collects what it posts. `start()` returns the URL."""

    def __init__(
        self,
        config: dict[str, Any],
        photos: list[Path] | None = None,
        root: Path = STATIC_ROOT,
        on_progress: Callable[[str, str], None] | None = None,
    ) -> None:
        self.config = config
        self.photos = photos or []
        self.root = root.resolve()
        self.on_progress = on_progress
        self.results: dict[str, Any] | None = None
        self._done = threading.Event()
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        assert self._httpd is not None, "server not started"
        return f"http://127.0.0.1:{self._httpd.server_address[1]}/"

    def start(self) -> str:
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                return None

            def do_GET(self) -> None:
                server._get(self)

            def do_POST(self) -> None:
                server._post(self)

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        httpd.daemon_threads = True
        self._httpd = httpd
        self._thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
        self._thread.start()
        return self.url

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def wait(self, timeout: float) -> bool:
        """Waits up to `timeout` seconds for results; True once they have arrived."""
        return self._done.wait(timeout)

    @property
    def done(self) -> bool:
        return self._done.is_set()

    # -- request handling

    def _send(
        self, handler: BaseHTTPRequestHandler, status: HTTPStatus, body: bytes = b"", ctype: str | None = None
    ) -> None:
        handler.send_response(status)
        if ctype:
            handler.send_header("Content-Type", ctype)
        handler.send_header("Content-Length", str(len(body)))
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        if handler.command != "HEAD":
            handler.wfile.write(body)

    def _send_file(self, handler: BaseHTTPRequestHandler, path: Path) -> None:
        try:
            body = path.read_bytes()
        except OSError:
            self._send(handler, HTTPStatus.NOT_FOUND)
            return
        self._send(handler, HTTPStatus.OK, body, content_type(path))

    def _static_file(self, url_path: str) -> Path | None:
        relative = urllib.parse.unquote(url_path).lstrip("/") or "index.html"
        if "\x00" in relative:
            return None
        candidate = (self.root / relative).resolve()
        if not candidate.is_relative_to(self.root) or not candidate.is_file():
            return None
        return candidate

    def _get(self, handler: BaseHTTPRequestHandler) -> None:
        path = urllib.parse.urlsplit(handler.path).path
        if path == "/config.json":
            self._send(handler, HTTPStatus.OK, json.dumps(self.config).encode(), "application/json")
            return
        if path.startswith("/photos/"):
            index = path.removeprefix("/photos/")
            if index.isascii() and index.isdigit() and int(index) < len(self.photos):
                self._send_file(handler, self.photos[int(index)])
            else:
                self._send(handler, HTTPStatus.NOT_FOUND)
            return
        file = self._static_file(path)
        if file is None:
            self._send(handler, HTTPStatus.NOT_FOUND)
        else:
            self._send_file(handler, file)

    def _read_json(self, handler: BaseHTTPRequestHandler) -> dict[str, Any] | None:
        try:
            length = int(handler.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_POST_BYTES:
                return None
            data = json.loads(handler.rfile.read(length))
        except (ValueError, OSError):
            return None
        return data if isinstance(data, dict) else None

    def _post(self, handler: BaseHTTPRequestHandler) -> None:
        path = urllib.parse.urlsplit(handler.path).path
        if path not in ("/progress", "/results"):
            self._send(handler, HTTPStatus.NOT_FOUND)
            return
        data = self._read_json(handler)
        if data is None:
            self._send(handler, HTTPStatus.BAD_REQUEST)
            return
        if path == "/progress":
            if self.on_progress is not None:
                self.on_progress(str(data.get("phase", "")), str(data.get("message", "")))
        else:
            self.results = data
            self._done.set()
        self._send(handler, HTTPStatus.NO_CONTENT)


# ---------------------------------------------------------------------------------------------------------------
# Starting Chromium


def build_command(browser: str, flags: list[str], profile: str, url: str) -> list[str]:
    """Exactly what the kiosk runs, with a throwaway profile and the benchmark URL."""
    return [browser, *flags, f"--user-data-dir={profile}", url]


@dataclass(frozen=True)
class LaunchPlan:
    kind: str  # "existing", "cage" or "labwc"
    description: str
    env: dict[str, str] = field(default_factory=dict)

    def argv(self, command: list[str]) -> list[str]:
        if self.kind == "cage":
            return ["cage", "--", *command]
        if self.kind == "labwc":
            return ["labwc", "-s", shlex.join(command)]
        return command


def plan_launch(
    mode: str, session: wayland.Session | None, which: Callable[[str], str | None], explicit_display: bool = False
) -> LaunchPlan | None:
    """Where to show the page, or None when there is nowhere. `session` is the running compositor, if one was found."""
    if mode in ("auto", "existing"):
        if session is not None:
            return LaunchPlan("existing", f"the running one at {session.socket}", session.env())
        if mode == "existing" or explicit_display:
            return None
    for compositor in ("cage", "labwc") if mode in ("auto", "cage") else (mode,):
        if mode in ("auto", compositor) and which(compositor):
            return LaunchPlan(compositor, f"started {compositor}")
    return None


def on_console_vt() -> bool:
    """True when stdin is a Linux virtual terminal (/dev/tty1 ...), where a compositor can be started."""
    try:
        return re.fullmatch(r"/dev/tty\d+", os.ttyname(0)) is not None
    except OSError:
        return False


# ---------------------------------------------------------------------------------------------------------------
# Memory


@dataclass(frozen=True)
class ProcessMemory:
    pid: int
    kind: str  # browser, renderer, gpu-process, utility, zygote ...
    kb: int


@dataclass(frozen=True)
class MemorySample:
    processes: tuple[ProcessMemory, ...]

    @property
    def total_kb(self) -> int:
        return sum(p.kb for p in self.processes)

    def by_kind(self) -> dict[str, int]:
        totals: dict[str, int] = defaultdict(int)
        for process in self.processes:
            totals[process.kind] += process.kb
        return dict(totals)


@dataclass
class MemoryTracker:
    """The largest sample seen, the latest, and the lowest MemAvailable."""

    peak: MemorySample | None = None
    last: MemorySample | None = None
    min_available_kb: int | None = None

    def add(self, sample: MemorySample, available_kb: int | None = None) -> None:
        self.last = sample
        if self.peak is None or sample.total_kb > self.peak.total_kb:
            self.peak = sample
        if available_kb is not None and (self.min_available_kb is None or available_kb < self.min_available_kb):
            self.min_available_kb = available_kb


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def list_processes(proc_root: str = PROC_ROOT) -> dict[int, tuple[int, str]]:
    """pid -> (parent pid, command name), from /proc/<pid>/stat."""
    found: dict[int, tuple[int, str]] = {}
    try:
        names = os.listdir(proc_root)
    except OSError:
        return found
    for name in names:
        if not name.isdigit():
            continue
        text = _read(Path(proc_root, name, "stat"))
        if not text:
            continue
        # "pid (comm) S ppid ...": the name may contain spaces and brackets, so split at the last ")".
        close = text.rfind(")")
        open_ = text.find("(")
        fields = text[close + 2 :].split()
        if close < 0 or open_ < 0 or len(fields) < 2 or not fields[1].isdigit():
            continue
        found[int(name)] = (int(fields[1]), text[open_ + 1 : close])
    return found


def _cmdline(proc_root: str, pid: int) -> list[str]:
    text = _read(Path(proc_root, str(pid), "cmdline")) or ""
    return [part for part in text.split("\x00") if part]


def _process_kb(proc_root: str, pid: int) -> int | None:
    """PSS from smaps_rollup, else the resident set from status."""
    for filename, key in (("smaps_rollup", "Pss"), ("status", "VmRSS")):
        match = re.search(rf"^{key}:\s*(\d+)\s*kB", _read(Path(proc_root, str(pid), filename)) or "", re.MULTILINE)
        if match:
            return int(match.group(1))
    return None


def sample_memory(root_pid: int, browser: str, proc_root: str = PROC_ROOT) -> MemorySample:
    """Memory of Chromium's processes among `root_pid` and its descendants."""
    processes = list_processes(proc_root)
    children: dict[int, list[int]] = defaultdict(list)
    for pid, (ppid, _comm) in processes.items():
        children[ppid].append(pid)
    wanted = os.path.basename(browser)
    found: list[ProcessMemory] = []
    queue = [root_pid]
    seen = set()
    while queue:
        pid = queue.pop()
        if pid in seen:
            continue
        seen.add(pid)
        queue.extend(children.get(pid, []))
        if pid not in processes:
            continue
        argv = _cmdline(proc_root, pid)
        if not (processes[pid][1].startswith("chrom") or (argv and os.path.basename(argv[0]) == wanted)):
            continue
        kb = _process_kb(proc_root, pid)
        if kb is None:
            continue
        kind = next((a.removeprefix("--type=") for a in argv if a.startswith("--type=")), "browser")
        found.append(ProcessMemory(pid, kind, kb))
    return MemorySample(tuple(sorted(found, key=lambda p: p.pid)))


def mem_available_kb(proc_root: str = PROC_ROOT) -> int | None:
    match = re.search(r"^MemAvailable:\s*(\d+)\s*kB", _read(Path(proc_root, "meminfo")) or "", re.MULTILINE)
    return int(match.group(1)) if match else None


def other_chromium_running(proc_root: str = PROC_ROOT) -> bool:
    return any(comm in CHROMIUM_NAMES for _ppid, comm in list_processes(proc_root).values())


# ---------------------------------------------------------------------------------------------------------------
# Results -> checks and tables


def _mib(kb: float) -> str:
    return f"{kb / 1024:.0f}"


def _phase(results: Mapping[str, Any], name: str) -> dict[str, Any] | None:
    for phase in results.get("phases") or []:
        if isinstance(phase, dict) and phase.get("name") == name:
            return phase
    return None


def _dropped_pct(phase: Mapping[str, Any]) -> float:
    """The share of the screen's refreshes that got no new frame: drawn frames plus dropped ones is every refresh."""
    dropped = phase.get("droppedFrames") or 0
    refreshes = (phase.get("frames") or 0) + dropped
    return 100 * dropped / refreshes if refreshes else 0.0


def _font_summary(fonts: list[dict[str, Any]]) -> str:
    weights: dict[str, list[str]] = {}
    for font in fonts:
        weights.setdefault(str(font.get("family")), []).append(str(font.get("weight")))
    return ", ".join(f"{family} {'/'.join(w)}" for family, w in weights.items())


def _rgb(value: Any) -> str:
    return f"rgb({', '.join(str(v) for v in value)})" if value else "unreadable"


def _check_gpu(results: Mapping[str, Any], section: Section) -> None:
    gpu = results.get("gpu") or {}
    renderer = str(gpu.get("renderer") or "unknown renderer")
    if not gpu.get("webgl"):
        section.add("GPU", Status.FAIL, "WebGL is not available")
    elif any(word in renderer.lower() for word in SOFTWARE_RENDERERS):
        section.add("GPU", Status.FAIL, f"drawing in software: the GPU is not being used ({renderer})")
    else:
        section.add("GPU", Status.PASS, f"WebGL on {renderer}")


def _check_screen(results: Mapping[str, Any], section: Section) -> None:
    viewport = results.get("viewport") or {}
    if viewport:
        scale = round(100 * float(viewport.get("stageScale") or 1))
        section.add(
            "Screen",
            Status.INFO,
            f"{viewport.get('width')}×{viewport.get('height')} at DPR {viewport.get('devicePixelRatio')}, "  # noqa: RUF001
            f"stage at {scale}%",
        )
    interval = results.get("refreshIntervalMs")
    if interval:
        section.fact("Refresh", f"{1000 / interval:.2f} Hz ({interval:g} ms)")


def _check_fonts(results: Mapping[str, Any], section: Section) -> None:
    fonts = [f for f in results.get("fonts") or [] if isinstance(f, dict)]
    bad = [f for f in fonts if f.get("status") != "loaded"]
    if not fonts:
        section.add("Fonts", Status.FAIL, "the page reported no fonts")
    elif bad:
        listed = ", ".join(f"{f.get('family')} {f.get('weight')} ({f.get('status')})" for f in bad)
        section.add("Fonts", Status.FAIL, f"not loaded: {listed}")
    else:
        section.add("Fonts", Status.PASS, f"{_font_summary(fonts)} loaded")


def _check_colour(results: Mapping[str, Any], section: Section) -> None:
    colour = results.get("colour") or {}
    for name, supported_key, pixel_key in (
        ("OKLCH colours", "oklchSupported", "oklchPixel"),
        ("color-mix() in OKLCH", "colorMixSupported", "colorMixPixel"),
    ):
        pixel = colour.get(pixel_key) or {}
        if not colour.get(supported_key):
            section.add(name, Status.FAIL, "this Chromium does not support it")
        elif pixel.get("ok"):
            section.add(name, Status.PASS, f"{pixel.get('css')} drew {_rgb(pixel.get('actual'))}")
        else:
            section.add(
                name,
                Status.FAIL,
                f"{pixel.get('css')}: expected {_rgb(pixel.get('expected'))}, got {_rgb(pixel.get('actual'))}",
            )


def _check_smoothness(results: Mapping[str, Any], section: Section) -> None:
    for name, phase_name, limit in (
        ("Month grid smoothness", "month", MONTH_DROPPED_MAX_PCT),
        ("Crossfade smoothness", "crossfade", CROSSFADE_DROPPED_MAX_PCT),
    ):
        phase = _phase(results, phase_name)
        if phase is None:
            section.add(name, Status.FAIL, f"the page did not report the {phase_name} phase")
            continue
        if not phase.get("frames"):
            # A photo phase shorter than one interval has no fades at all, which says nothing either way.
            section.add(name, Status.SKIP, "no frames measured (is --seconds longer than --photo-interval?)")
            continue
        pct = _dropped_pct(phase)
        worst = (phase.get("frameMs") or {}).get("max")
        detail = f"{phase.get('droppedFrames')} frames dropped, {pct:.1f}% of refreshes"
        if worst is not None:
            detail += f", worst {worst:g} ms"
        if phase_name == "crossfade" and phase.get("fades") is not None:
            detail += f", across {phase['fades']} fades"
        section.add(name, Status.PASS if pct <= limit else Status.FAIL, detail)


def _frame_table(results: Mapping[str, Any]) -> Table:
    rows = []
    for name in ("month", "photo", "crossfade"):
        label = FRAME_LABELS[name]
        phase = _phase(results, name)
        if phase is None:
            continue
        frame = phase.get("frameMs") or {}
        seconds = phase.get("seconds") or 0
        frames = phase.get("frames") or 0
        rows.append(
            [
                label,
                str(frames),
                f"{seconds:.1f}",
                f"{frames / seconds:.1f}" if seconds else "-",
                f"{frame.get('median', 0):.1f}",
                f"{frame.get('p95', 0):.1f}",
                f"{frame.get('p99', 0):.1f}",
                f"{frame.get('max', 0):.1f}",
                str(phase.get("droppedFrames", 0)),
                f"{_dropped_pct(phase):.1f}",
            ]
        )
    headers = ["Phase", "Frames", "Seconds", "Mean fps", "Median ms", "p95 ms", "p99 ms", "Worst ms", "Dropped"]
    return Table("Frame times", [*headers, "% of refreshes"], rows)


def _memory_parts(memory: MemoryTracker | None, section: Section) -> None:
    if memory is None or memory.peak is None:
        return
    peak = memory.peak
    section.add(
        "Memory", Status.INFO, f"peak {_mib(peak.total_kb)} MiB across {len(peak.processes)} Chromium processes"
    )
    last = memory.last.by_kind() if memory.last else {}
    peak_kinds = peak.by_kind()
    rows = [
        [kind, _mib(kb), _mib(last.get(kind, 0))] for kind, kb in sorted(peak_kinds.items(), key=lambda item: -item[1])
    ]
    rows.append(["Total", _mib(peak.total_kb), _mib(memory.last.total_kb if memory.last else 0)])
    section.tables.append(Table("Chromium memory (PSS)", ["Process", "Peak MiB", "End MiB"], rows))


def evaluate(results: Mapping[str, Any], memory: MemoryTracker | None, section: Section) -> None:
    """Adds the checks, facts, tables and notes for a results report (everything except "Page ran")."""
    if results.get("userAgent"):
        section.fact("Browser", str(results["userAgent"]))
    _check_gpu(results, section)
    _check_screen(results, section)
    _check_fonts(results, section)
    _check_colour(results, section)
    _check_smoothness(results, section)
    errors = [str(e) for e in results.get("errors") or []]
    if errors:
        more = f" (and {len(errors) - 3} more)" if len(errors) > 3 else ""
        section.add("Page errors", Status.FAIL, "; ".join(errors[:3]) + more)
    section.tables.append(_frame_table(results))
    _memory_parts(memory, section)
    heap = results.get("memory")
    if heap:
        section.notes.append(f"JS heap: {heap.get('jsHeapUsedMB')} MB used of {heap.get('jsHeapTotalMB')} MB.")
    if memory is not None and memory.min_available_kb is not None:
        section.notes.append(f"Lowest MemAvailable: {_mib(memory.min_available_kb)} MiB.")
    photos = results.get("photos") or {}
    decodes = sorted(float(d) for d in photos.get("decodeMs") or [] if isinstance(d, int | float))
    if decodes:
        median = decodes[len(decodes) // 2]
        section.notes.append(
            f"Photo decode ({photos.get('source', 'unknown')}, {len(decodes)} decodes): "
            f"median {median:.1f} ms, worst {decodes[-1]:.1f} ms."
        )
    section.notes.append(
        "Compare these numbers on the Pi 4 and the Pi 5 in the same mode; "
        "PR 4.2 checks the photo frame against the crossfade row."
    )


# ---------------------------------------------------------------------------------------------------------------
# The probe


@dataclass
class Outcome:
    results: bool
    seconds: float
    message: str = ""


def stop_process_group(proc: subprocess.Popen[bytes], sleep: Callable[[float], None]) -> None:
    """SIGTERM to the group, a grace period, then SIGKILL."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(proc.pid, sig)
        try:
            proc.wait(timeout=STOP_GRACE_SECONDS if sig == signal.SIGTERM else 5)
            return
        except subprocess.TimeoutExpired:
            continue


def _tail(path: str, lines: int = 5) -> str:
    text = _read(Path(path)) or ""
    return " | ".join(line.strip() for line in text.splitlines()[-lines:] if line.strip())


def wait_for_results(
    server: BenchServer,
    ctx: Context,
    deadline: float,
    proc: subprocess.Popen[bytes] | None = None,
    sample: Callable[[], None] | None = None,
) -> Outcome:
    """Waits for the page's results, sampling memory every 2 s, until the browser exits or `deadline` seconds pass."""
    started = ctx.monotonic()
    while True:
        if server.wait(SAMPLE_INTERVAL):
            if sample:
                sample()
            return Outcome(True, ctx.monotonic() - started)
        if sample:
            sample()
        if proc is not None and proc.poll() is not None and not server.done:
            return Outcome(False, ctx.monotonic() - started, f"exited:{proc.returncode}")
        if ctx.monotonic() - started > deadline:
            return Outcome(False, ctx.monotonic() - started, "deadline")


def _first_line(text: str) -> str:
    return next((line.strip() for line in text.splitlines() if line.strip()), "")


def _browser_version(browser: str, ctx: Context) -> str | None:
    try:
        result = ctx.runner([browser, "--version"], timeout=10)
    except (CommandMissing, CommandTimeout):
        return None
    return _first_line(result.stdout) or None


def _throttled(ctx: Context, section: Section) -> None:
    if not ctx.which("vcgencmd"):
        return
    try:
        result = ctx.runner(["vcgencmd", "get_throttled"], timeout=10)
    except (CommandMissing, CommandTimeout):
        return
    if result.ok and result.stdout.strip():
        section.fact("Throttled", result.stdout.strip())


def _temperature_fact(section: Section, start: float | None, end: float | None) -> None:
    if start is not None and end is not None:
        section.fact("CPU temperature", f"{start:.1f} → {end:.1f} °C")
    elif end is not None or start is not None:
        section.fact("CPU temperature", f"{(end if end is not None else start):.1f} °C")


def _read_proc_text(path: str) -> str | None:
    return system.read_text(path)


def run(args: argparse.Namespace, ctx: Context) -> Section:
    section = Section("Render probe")
    photos: list[Path] = []
    if args.photos is not None:
        try:
            photos = list_photos(args.photos)
        except OSError as error:
            section.add("Photos", Status.FAIL, f"cannot read {args.photos}: {error.strerror or error}")
            return section
        if len(photos) < 2:
            section.add("Photos", Status.FAIL, f"need at least 2 photos (jpg, jpeg, png, webp) in {args.photos}")
            return section
        section.add("Photos", Status.INFO, f"{len(photos)} from {args.photos}")

    command: list[str] | None = None
    plan: LaunchPlan | None = None
    browser = ""
    if not args.no_launch:
        browser = args.browser or ctx.which("chromium") or ctx.which("chromium-browser") or ""
        if not browser:
            section.add("Chromium", Status.FAIL, "not installed (sudo apt install chromium)")
            return section
        version = _browser_version(browser, ctx)
        section.add("Chromium", Status.PASS if version else Status.INFO, version or browser)
        if version:
            section.fact("Chromium", version)
        found = find_flags(args.flags)
        if found is None:
            where = args.flags or f"{INSTALLED_FLAGS[0]} or {repo_flags_file()}"
            section.add("Kiosk flags", Status.FAIL, f"cannot read {where}")
            return section
        flags, source = found
        section.add("Kiosk flags", Status.INFO, f"{len(flags)} flags from {source}")
        session = None
        if args.compositor in ("auto", "existing"):
            session = wayland.find_session(args.wayland_display, os.environ, os.getuid())
        plan = plan_launch(args.compositor, session, ctx.which, explicit_display=bool(args.wayland_display))
        if plan is None:
            if args.compositor in ("auto", "existing"):
                section.add(
                    "Compositor",
                    Status.FAIL,
                    "no Wayland session and no compositor to start: run this on the Pi's own console, "
                    "or as the kiosk user while the kiosk is running",
                )
            else:
                section.add("Compositor", Status.FAIL, f"{args.compositor} is not installed")
            return section
        section.add("Compositor", Status.INFO, plan.description)
        if plan.kind != "existing" and not on_console_vt():
            ctx.say("Warning: a compositor normally has to be started from the Pi's own console (a text login).")
        if other_chromium_running():
            section.add(
                "Other Chromium",
                Status.INFO,
                "the kiosk's Chromium is running too, so these numbers include its work; "
                "stop it first for a clean baseline (see the README)",
            )

    config = build_config(args, photos)
    server = BenchServer(config, photos, on_progress=lambda phase, msg: ctx.say(f"{phase}: {msg}"))
    deadline = args.warmup + args.month_seconds + args.seconds + EXTRA_WAIT_SECONDS
    temperature_start = system.cpu_temperature()
    tracker = MemoryTracker()
    proc: subprocess.Popen[bytes] | None = None
    profile = log_path = None
    outcome = Outcome(False, 0.0, "deadline")
    try:
        url = server.start()
        if args.no_launch:
            ctx.say(f"Serving the benchmark page at {url} (open it in a browser; waiting up to {deadline:g} s)")
        else:
            assert plan is not None
            profile = tempfile.mkdtemp(prefix="hw-probe-chromium-")
            log_fd, log_path = tempfile.mkstemp(prefix="hw-probe-chromium-", suffix=".log")
            command = build_command(browser, flags, profile, url)
            ctx.say(f"Running Chromium on {url} (about {deadline - EXTRA_WAIT_SECONDS:g} s)")
            with os.fdopen(log_fd, "wb") as log:
                proc = subprocess.Popen(
                    plan.argv(command),
                    env={**os.environ, **plan.env},
                    stdin=subprocess.DEVNULL,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )

        def sample() -> None:
            if proc is not None:
                tracker.add(sample_memory(proc.pid, browser, PROC_ROOT), mem_available_kb(PROC_ROOT))

        outcome = wait_for_results(server, ctx, deadline, proc, sample)
    finally:
        if proc is not None:
            stop_process_group(proc, ctx.sleep)
        server.stop()
        if profile:
            shutil.rmtree(profile, ignore_errors=True)

    _temperature_fact(section, temperature_start, system.cpu_temperature())
    if not args.no_launch:
        _throttled(ctx, section)

    if not outcome.results or server.results is None:
        if outcome.message.startswith("exited:"):
            detail = f"Chromium exited with status {outcome.message.removeprefix('exited:')} before the page finished"
            if log_path and (tail := _tail(log_path)):
                detail += f": {tail}"
        else:
            detail = f"no results after {outcome.seconds:.0f} s"
        section.add("Page ran", Status.FAIL, detail)
    else:
        section.add("Page ran", Status.PASS, f"ran for {outcome.seconds:.0f} s")
        evaluate(server.results, tracker if tracker.peak else None, section)
    if log_path:
        with contextlib.suppress(OSError):
            os.unlink(log_path)
    return section
