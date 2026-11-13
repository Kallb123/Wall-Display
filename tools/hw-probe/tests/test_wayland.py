from hw_probe.wayland import Output, Session, find_session, parse_wlopm, parse_wlr_randr

WLR_RANDR = """\
HDMI-A-1 "Samsung Electric Company M80F HNAXA00000 (HDMI-A-1)"
  Make: Samsung Electric Company
  Model: M80F
  Physical size: 700x390 mm
  Enabled: yes
  Modes:
    3840x2160 px, 60.000000 Hz (preferred)
    2560x1440 px, 59.951002 Hz (current)
    1920x1080 px, 60.000000 Hz
  Position: 0,0
  Transform: normal
  Scale: 1.000000
HDMI-A-2 "Unknown (HDMI-A-2)"
  Enabled: no
  Modes:
    1920x1080 px, 60.000000 Hz (preferred)
"""


def sockets(*paths: str):
    return lambda path: path in paths


def test_session_env():
    session = Session("/run/user/1000/wayland-0")
    assert session.env() == {"WAYLAND_DISPLAY": "/run/user/1000/wayland-0", "XDG_RUNTIME_DIR": "/run/user/1000"}


def test_explicit_full_path():
    found = find_session("/run/user/1000/wayland-1", {}, 1000, is_socket=sockets("/run/user/1000/wayland-1"))
    assert found == Session("/run/user/1000/wayland-1")


def test_explicit_name_uses_runtime_dir_from_environ():
    found = find_session("wayland-2", {"XDG_RUNTIME_DIR": "/tmp/rt"}, 1000, is_socket=sockets("/tmp/rt/wayland-2"))
    assert found == Session("/tmp/rt/wayland-2")


def test_explicit_that_is_not_a_socket_is_none_even_if_others_exist():
    found = find_session(
        "/nope", {}, 1000, list_dir=lambda d: ["wayland-0"], is_socket=sockets("/run/user/1000/wayland-0")
    )
    assert found is None


def test_environ_wayland_display_name():
    environ = {"WAYLAND_DISPLAY": "wayland-0"}
    found = find_session(None, environ, 1000, is_socket=sockets("/run/user/1000/wayland-0"))
    assert found == Session("/run/user/1000/wayland-0")


def test_environ_full_path():
    environ = {"WAYLAND_DISPLAY": "/x/wl"}
    assert find_session(None, environ, 1, is_socket=sockets("/x/wl")) == Session("/x/wl")


def test_scan_picks_first_sorted_socket_and_skips_locks():
    listing = ["wayland-1.lock", "bus", "wayland-1", "wayland-0.lock", "wayland-0", "wayland-10"]
    seen: list[str] = []

    def list_dir(path: str) -> list[str]:
        seen.append(path)
        return listing

    found = find_session(
        None, {}, 1000, list_dir=list_dir, is_socket=sockets("/run/user/1000/wayland-0", "/run/user/1000/wayland-1")
    )
    assert found == Session("/run/user/1000/wayland-0")
    assert seen == ["/run/user/1000"]


def test_scan_skips_non_sockets_and_nothing_found():
    assert find_session(None, {}, 1000, list_dir=lambda d: ["wayland-0"], is_socket=lambda p: False) is None
    assert find_session(None, {}, 1000, list_dir=lambda d: [], is_socket=lambda p: True) is None


def test_stale_environ_falls_back_to_scan():
    found = find_session(
        None,
        {"WAYLAND_DISPLAY": "wayland-9"},
        1000,
        list_dir=lambda d: ["wayland-0"],
        is_socket=sockets("/run/user/1000/wayland-0"),
    )
    assert found == Session("/run/user/1000/wayland-0")


def test_parse_wlr_randr():
    assert parse_wlr_randr(WLR_RANDR) == [
        Output("HDMI-A-1", True, "2560x1440 @ 59.951 Hz"),
        Output("HDMI-A-2", False, None),
    ]


def test_parse_wlr_randr_empty_and_garbage():
    assert parse_wlr_randr("") == []
    assert parse_wlr_randr("\n\n") == []


def test_parse_wlopm():
    assert parse_wlopm("HDMI-A-1 on\nHDMI-A-2 off\n") == [
        Output("HDMI-A-1", True, None),
        Output("HDMI-A-2", False, None),
    ]
    assert parse_wlopm("usage: wlopm\n") == []
