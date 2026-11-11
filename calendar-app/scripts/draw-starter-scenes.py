"""Draws the starter scenes' art (architecture §6.6) as plain SVG.

The SVGs in server/assets/starter-scenes/ are what ships, and can be edited by
hand or in a drawing program. This script made them: shared helpers for the
bunting, balloons, snowflakes, eggs and so on, and one function per scene, with
the scattered confetti and snow from fixed seeds so a rerun gives the same
files. Run it from calendar-app after changing a scene, or to draw a new one:

    python3 scripts/draw-starter-scenes.py

Then look at the result on the wall with the visual tests
(test/visual/starter-scenes.spec.ts) and update their baselines.
"""
import math
import os
import random
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server', 'assets', 'starter-scenes')


def n(x):
    s = f"{x:.1f}"
    return s[:-2] if s.endswith('.0') else s


def svg(w, h, body, defs='', comment=''):
    head = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
    if comment:
        head += f'  <!-- {comment} -->\n'
    if defs:
        head += f'  <defs>\n{defs}  </defs>\n'
    return head + body + '</svg>\n'


def g(content, attrs=''):
    return f'  <g{(" " + attrs) if attrs else ""}>\n{content}  </g>\n'


# ---------------------------------------------------------------------------
# Shapes shared by the scenes


def quad(a, c, b, t):
    return tuple((1 - t) ** 2 * a[i] + 2 * (1 - t) * t * c[i] + t * t * b[i] for i in range(2))


def quad_angle(a, c, b, t):
    dx = 2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0])
    dy = 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1])
    return math.degrees(math.atan2(dy, dx))


def bunting(x0, x1, y, sag, count, colours, w=34, h=36, line='#8c7b66', width=4):
    """A swag of rounded flags between two points."""
    a, b = (x0, y), (x1, y)
    c = ((x0 + x1) / 2, y + 2 * sag)
    out = f'    <path d="M{n(x0)} {n(y)} Q{n(c[0])} {n(c[1])} {n(x1)} {n(y)}" fill="none" stroke="{line}" stroke-width="{width}" stroke-linecap="round"/>\n'
    for i in range(count):
        t = (i + 0.5) / count
        px, py = quad(a, c, b, t)
        ang = quad_angle(a, c, b, t)
        col = colours[i % len(colours)]
        hw = w / 2
        out += (f'    <path d="M{n(-hw)} 0 L{n(hw)} 0 L4 {n(h - 7)} Q0 {n(h)} -4 {n(h - 7)} Z" fill="{col}" '
                f'transform="translate({n(px)} {n(py)}) rotate({n(ang)})"/>\n')
    return out


def balloon(cx, cy, rx, ry, colour, string_to, sway=14, shine='#ffffff'):
    out = f'    <path d="M{n(cx)} {n(cy + ry + 8)} q{n(sway)} {n((string_to - cy - ry) * 0.25)} 0 {n((string_to - cy - ry) * 0.5)} t0 {n((string_to - cy - ry) * 0.5)}" fill="none" stroke="#9a8a78" stroke-width="3" stroke-linecap="round"/>\n'
    out += f'    <ellipse cx="{n(cx)}" cy="{n(cy)}" rx="{n(rx)}" ry="{n(ry)}" fill="{colour}"/>\n'
    out += f'    <path d="M{n(cx - 9)} {n(cy + ry + 10)} L{n(cx)} {n(cy + ry - 3)} L{n(cx + 9)} {n(cy + ry + 10)} Z" fill="{colour}"/>\n'
    out += f'    <ellipse cx="{n(cx - rx * 0.38)}" cy="{n(cy - ry * 0.4)}" rx="{n(rx * 0.17)}" ry="{n(ry * 0.26)}" fill="{shine}" opacity="0.4" transform="rotate(-24 {n(cx - rx * 0.38)} {n(cy - ry * 0.4)})"/>\n'
    return out


def present(x, y, w, h, box, ribbon, lid=None):
    lid = lid or box
    lh = max(10, h * 0.2)
    out = f'    <rect x="{n(x + 4)}" y="{n(y + lh - 2)}" width="{n(w - 8)}" height="{n(h - lh + 2)}" rx="6" fill="{box}"/>\n'
    out += f'    <rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(lh)}" rx="6" fill="{lid}"/>\n'
    rw = max(8, w * 0.14)
    out += f'    <rect x="{n(x + w / 2 - rw / 2)}" y="{n(y)}" width="{n(rw)}" height="{n(h)}" fill="{ribbon}"/>\n'
    bw = w * 0.26
    out += f'    <ellipse cx="{n(x + w / 2 - bw * 0.55)}" cy="{n(y - bw * 0.3)}" rx="{n(bw * 0.55)}" ry="{n(bw * 0.32)}" fill="{ribbon}" transform="rotate(-28 {n(x + w / 2 - bw * 0.55)} {n(y - bw * 0.3)})"/>\n'
    out += f'    <ellipse cx="{n(x + w / 2 + bw * 0.55)}" cy="{n(y - bw * 0.3)}" rx="{n(bw * 0.55)}" ry="{n(bw * 0.32)}" fill="{ribbon}" transform="rotate(28 {n(x + w / 2 + bw * 0.55)} {n(y - bw * 0.3)})"/>\n'
    out += f'    <circle cx="{n(x + w / 2)}" cy="{n(y - 2)}" r="{n(rw * 0.7)}" fill="{ribbon}"/>\n'
    return out


def drip(x, y, w, depth, bumps):
    """A wavy edge of icing hanging from y, across width w."""
    step = w / bumps
    d = f'M{n(x)} {n(y - 2)} L{n(x)} {n(y + depth * 0.4)}'
    for i in range(bumps):
        bx = x + i * step
        dd = depth if i % 2 == 0 else depth * 0.55
        d += f' Q{n(bx + step / 2)} {n(y + dd * 1.6)} {n(bx + step)} {n(y + depth * 0.4)}'
    d += f' L{n(x + w)} {n(y - 2)} Z'
    return d


def cake(cx, base, scale, sponge, icing, plate, candles):
    s = scale
    out = f'    <rect x="{n(cx - 130 * s)}" y="{n(base - 14 * s)}" width="{n(260 * s)}" height="{n(14 * s)}" rx="{n(7 * s)}" fill="{plate}"/>\n'
    # Bottom tier.
    out += f'    <rect x="{n(cx - 105 * s)}" y="{n(base - 100 * s)}" width="{n(210 * s)}" height="{n(88 * s)}" rx="{n(16 * s)}" fill="{sponge}"/>\n'
    out += f'    <path d="{drip(cx - 105 * s, base - 100 * s, 210 * s, 18 * s, 7)}" fill="{icing}"/>\n'
    # Top tier.
    out += f'    <rect x="{n(cx - 70 * s)}" y="{n(base - 168 * s)}" width="{n(140 * s)}" height="{n(72 * s)}" rx="{n(14 * s)}" fill="{sponge}"/>\n'
    out += f'    <path d="{drip(cx - 70 * s, base - 168 * s, 140 * s, 15 * s, 5)}" fill="{icing}"/>\n'
    # Sprinkles on the bottom tier.
    for i, (dx, dy, col) in enumerate([(-80, -45, '#5f94c4'), (-40, -30, '#f6b73c'), (10, -50, '#9a7bc4'), (55, -32, '#5f94c4'), (85, -52, '#f6b73c'), (-60, -60, '#e07a9a')]):
        out += f'    <rect x="{n(cx + dx * s)}" y="{n(base + dy * s)}" width="{n(12 * s)}" height="{n(5 * s)}" rx="{n(2.5 * s)}" fill="{col}" transform="rotate({(i * 47) % 90 - 45} {n(cx + dx * s)} {n(base + dy * s)})"/>\n'
    # Candles and flames.
    for i, col in enumerate(candles):
        x = cx + (i - (len(candles) - 1) / 2) * 34 * s
        out += f'    <rect x="{n(x - 6 * s)}" y="{n(base - 212 * s)}" width="{n(12 * s)}" height="{n(46 * s)}" rx="{n(6 * s)}" fill="{col}"/>\n'
        fy = base - 216 * s
        out += f'    <path d="M{n(x)} {n(fy)} Q{n(x - 10 * s)} {n(fy - 12 * s)} {n(x)} {n(fy - 30 * s)} Q{n(x + 10 * s)} {n(fy - 12 * s)} {n(x)} {n(fy)} Z" fill="#f6b73c"/>\n'
        out += f'    <path d="M{n(x)} {n(fy - 2 * s)} Q{n(x - 4 * s)} {n(fy - 9 * s)} {n(x)} {n(fy - 18 * s)} Q{n(x + 4 * s)} {n(fy - 9 * s)} {n(x)} {n(fy - 2 * s)} Z" fill="#fff1c9"/>\n'
    return out


def confetti(rng, regions, count, colours, size=1.0):
    out = ''
    total = sum(r[4] for r in regions)
    for _ in range(count):
        pick = rng.uniform(0, total)
        for x0, y0, x1, y1, wgt in regions:
            if pick <= wgt:
                break
            pick -= wgt
        x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
        col = rng.choice(colours)
        if rng.random() < 0.45:
            out += f'    <circle cx="{n(x)}" cy="{n(y)}" r="{n(rng.uniform(5, 8) * size)}" fill="{col}"/>\n'
        else:
            w, h = rng.uniform(18, 26) * size, rng.uniform(7, 9) * size
            out += f'    <rect x="{n(x - w / 2)}" y="{n(y - h / 2)}" width="{n(w)}" height="{n(h)}" rx="{n(h / 2)}" fill="{col}" transform="rotate({rng.randint(-80, 80)} {n(x)} {n(y)})"/>\n'
    return out


def snowflake(cx, cy, r, colour='#eef6fe', width=4, opacity=1.0):
    out = f'    <g stroke="{colour}" stroke-width="{n(width)}" stroke-linecap="round" fill="none" opacity="{n(opacity)}" transform="translate({n(cx)} {n(cy)})">\n'
    for k in range(6):
        a = k * 60
        out += f'      <path d="M0 0 L0 {n(-r)} M{n(-r * 0.3)} {n(-r * 0.75)} L0 {n(-r * 0.5)} L{n(r * 0.3)} {n(-r * 0.75)}" transform="rotate({a})"/>\n'
    out += '    </g>\n'
    return out


def snow(rng, regions, count, colour='#eef6fe'):
    out = ''
    total = sum(r[4] for r in regions)
    for _ in range(count):
        pick = rng.uniform(0, total)
        for x0, y0, x1, y1, wgt in regions:
            if pick <= wgt:
                break
            pick -= wgt
        out += f'    <circle cx="{n(rng.uniform(x0, x1))}" cy="{n(rng.uniform(y0, y1))}" r="{n(rng.uniform(2.5, 6))}" fill="{colour}" opacity="{n(rng.uniform(0.45, 0.9))}"/>\n'
    return out


def fir(cx, base, h, colours=('#2f6b5a', '#3d8a6e', '#4f9f7f'), trunk='#6b4a35', snowcap=None):
    """A fir of three rounded tiers, `h` tall from its base."""
    out = f'    <rect x="{n(cx - h * 0.06)}" y="{n(base - h * 0.14)}" width="{n(h * 0.12)}" height="{n(h * 0.14)}" rx="{n(h * 0.03)}" fill="{trunk}"/>\n'
    tiers = [(0.12, 0.5, 0.46), (0.36, 0.4, 0.37), (0.58, 0.42, 0.27)]
    for i, (lift, th, hw) in enumerate(tiers):
        yb = base - h * lift
        yt = yb - h * th
        w = h * hw
        col = colours[i]
        out += (f'    <path d="M{n(cx)} {n(yt)} Q{n(cx + w * 0.15)} {n(yt + 4)} {n(cx + w)} {n(yb - 8)} '
                f'Q{n(cx + w + 6)} {n(yb)} {n(cx + w - 10)} {n(yb)} L{n(cx - w + 10)} {n(yb)} '
                f'Q{n(cx - w - 6)} {n(yb)} {n(cx - w)} {n(yb - 8)} Q{n(cx - w * 0.15)} {n(yt + 4)} {n(cx)} {n(yt)} Z" fill="{col}"/>\n')
        if snowcap:
            out += (f'    <path d="M{n(cx)} {n(yt)} Q{n(cx + w * 0.1)} {n(yt + 2)} {n(cx + w * 0.42)} {n(yt + th * h * 0.38)} '
                    f'Q{n(cx + w * 0.22)} {n(yt + th * h * 0.3)} {n(cx)} {n(yt + th * h * 0.36)} Q{n(cx - w * 0.22)} {n(yt + th * h * 0.3)} {n(cx - w * 0.42)} {n(yt + th * h * 0.38)} '
                    f'Q{n(cx - w * 0.1)} {n(yt + 2)} {n(cx)} {n(yt)} Z" fill="{snowcap}"/>\n')
    return out


def star(cx, cy, r, colour, rot=0):
    pts = []
    for k in range(10):
        rr = r if k % 2 == 0 else r * 0.48
        a = math.radians(-90 + k * 36 + rot)
        pts.append(f'{n(cx + rr * math.cos(a))},{n(cy + rr * math.sin(a))}')
    return f'    <polygon points="{" ".join(pts)}" fill="{colour}" stroke="{colour}" stroke-width="{n(r * 0.18)}" stroke-linejoin="round"/>\n'


def lights(x0, x1, y, sag, count, colours, seed=0):
    """A swag of fairy lights: a dark wire and glowing bulbs hanging from it."""
    a, b = (x0, y), (x1, y)
    c = ((x0 + x1) / 2, y + 2 * sag)
    out = f'    <path d="M{n(x0)} {n(y)} Q{n(c[0])} {n(c[1])} {n(x1)} {n(y)}" fill="none" stroke="#0a1b2e" stroke-width="4" stroke-linecap="round"/>\n'
    for i in range(count):
        t = (i + 0.5) / count
        px, py = quad(a, c, b, t)
        col = colours[i % len(colours)]
        tilt = 14 if i % 2 == 0 else -14
        out += f'    <g transform="translate({n(px)} {n(py)}) rotate({tilt})">\n'
        out += f'      <circle cx="0" cy="18" r="20" fill="url(#bulb-glow)"/>\n'
        out += f'      <rect x="-4" y="0" width="8" height="7" rx="2" fill="#2a3f55"/>\n'
        out += f'      <ellipse cx="0" cy="17" rx="7.5" ry="11" fill="{col}"/>\n'
        out += f'      <ellipse cx="-2.5" cy="13" rx="2" ry="3.5" fill="#ffffff" opacity="0.55"/>\n'
        out += '    </g>\n'
    return out


BULB_GLOW = ('    <radialGradient id="bulb-glow" cx="0.5" cy="0.5" r="0.5">\n'
             '      <stop offset="0" stop-color="#fff3c4" stop-opacity="0.45"/>\n'
             '      <stop offset="1" stop-color="#fff3c4" stop-opacity="0"/>\n'
             '    </radialGradient>\n')


def bauble(cx, top, length, r, colour, band, rng=None):
    out = f'    <path d="M{n(cx)} {n(top)} L{n(cx)} {n(top + length)}" stroke="#d7eaff" stroke-width="3" stroke-linecap="round" opacity="0.7"/>\n'
    cy = top + length + r + 6
    out += f'    <rect x="{n(cx - r * 0.3)}" y="{n(top + length)}" width="{n(r * 0.6)}" height="{n(r * 0.36)}" rx="3" fill="#c9a24c"/>\n'
    out += f'    <circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="{colour}"/>\n'
    out += f'    <path d="M{n(cx - r)} {n(cy)} Q{n(cx - r / 2)} {n(cy - r * 0.28)} {n(cx)} {n(cy)} T{n(cx + r)} {n(cy)}" fill="none" stroke="{band}" stroke-width="{n(r * 0.16)}" stroke-linecap="round"/>\n'
    out += f'    <ellipse cx="{n(cx - r * 0.38)}" cy="{n(cy - r * 0.4)}" rx="{n(r * 0.18)}" ry="{n(r * 0.26)}" fill="#ffffff" opacity="0.4" transform="rotate(-30 {n(cx - r * 0.38)} {n(cy - r * 0.4)})"/>\n'
    return out


def egg_path(cx, cy, w, h):
    top, bot = cy - h / 2, cy + h / 2
    return (f'M{n(cx)} {n(top)} C{n(cx + w * 0.42)} {n(top)} {n(cx + w * 0.54)} {n(cy + h * 0.12)} {n(cx + w * 0.5)} {n(cy + h * 0.2)} '
            f'C{n(cx + w * 0.46)} {n(bot - h * 0.02)} {n(cx + w * 0.2)} {n(bot)} {n(cx)} {n(bot)} '
            f'C{n(cx - w * 0.2)} {n(bot)} {n(cx - w * 0.46)} {n(bot - h * 0.02)} {n(cx - w * 0.5)} {n(cy + h * 0.2)} '
            f'C{n(cx - w * 0.54)} {n(cy + h * 0.12)} {n(cx - w * 0.42)} {n(top)} {n(cx)} {n(top)} Z')


EGG_STYLES = [
    ('#f4b8c8', '#ffffff', 'zigzag'),
    ('#f6d36b', '#f29e6b', 'dots'),
    ('#c8b4e4', '#ffffff', 'bands'),
    ('#a8d8b9', '#f6d36b', 'zigzag'),
    ('#a8cbe8', '#f4b8c8', 'dots'),
    ('#f7c59f', '#7fae8a', 'bands'),
]


def egg(cx, cy, w, h, style, eid, rot=0):
    fill, deco, kind = style
    out = f'    <g transform="rotate({n(rot)} {n(cx)} {n(cy)})">\n'
    out += f'      <path d="{egg_path(cx, cy, w, h)}" fill="{fill}"/>\n'
    out += f'      <g clip-path="url(#{eid})">\n'
    sw = max(3, w * 0.09)
    if kind == 'zigzag':
        y = cy + h * 0.02
        zz = f'M{n(cx - w)} {n(y)}'
        steps = 8
        for i in range(steps):
            x = cx - w + (i + 1) * (2 * w / steps)
            zz += f' L{n(x)} {n(y + (-h * 0.08 if i % 2 == 0 else h * 0.08))}'
        out += f'        <path d="{zz}" fill="none" stroke="{deco}" stroke-width="{n(sw)}" stroke-linejoin="round" stroke-linecap="round"/>\n'
    elif kind == 'dots':
        for dx, dy in [(-0.22, -0.18), (0.18, -0.06), (-0.12, 0.14), (0.26, 0.24), (0.0, -0.32), (-0.3, 0.32)]:
            out += f'        <circle cx="{n(cx + dx * w)}" cy="{n(cy + dy * h)}" r="{n(w * 0.08)}" fill="{deco}"/>\n'
    else:
        for dy in (-0.16, 0.12):
            out += f'        <rect x="{n(cx - w)}" y="{n(cy + dy * h)}" width="{n(2 * w)}" height="{n(h * 0.09)}" fill="{deco}"/>\n'
    out += '      </g>\n'
    out += f'      <ellipse cx="{n(cx - w * 0.2)}" cy="{n(cy - h * 0.22)}" rx="{n(w * 0.09)}" ry="{n(h * 0.12)}" fill="#ffffff" opacity="0.45" transform="rotate(-20 {n(cx - w * 0.2)} {n(cy - h * 0.22)})"/>\n'
    out += '    </g>\n'
    defs = f'    <clipPath id="{eid}"><path d="{egg_path(cx, cy, w, h)}"/></clipPath>\n'
    return out, defs


def daisy(cx, cy, r, petal='#ffffff', centre='#f6c544'):
    out = ''
    for k in range(8):
        out += f'    <ellipse cx="{n(cx)}" cy="{n(cy - r * 0.62)}" rx="{n(r * 0.26)}" ry="{n(r * 0.48)}" fill="{petal}" transform="rotate({k * 45} {n(cx)} {n(cy)})"/>\n'
    out += f'    <circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r * 0.32)}" fill="{centre}"/>\n'
    return out


def tulip(x, base, h, colour, leaf='#7fa36a'):
    top = base - h
    out = f'    <path d="M{n(x)} {n(base)} Q{n(x + 4)} {n(base - h * 0.5)} {n(x)} {n(top + 20)}" fill="none" stroke="{leaf}" stroke-width="7" stroke-linecap="round"/>\n'
    out += f'    <path d="M{n(x)} {n(base - 6)} Q{n(x - 34)} {n(base - h * 0.32)} {n(x - 20)} {n(base - h * 0.62)} Q{n(x - 6)} {n(base - h * 0.32)} {n(x)} {n(base - 6)} Z" fill="{leaf}"/>\n'
    out += (f'    <path d="M{n(x - 20)} {n(top)} L{n(x - 10)} {n(top + 12)} L{n(x)} {n(top - 2)} L{n(x + 10)} {n(top + 12)} L{n(x + 20)} {n(top)} '
            f'Q{n(x + 24)} {n(top + 34)} {n(x)} {n(top + 40)} Q{n(x - 24)} {n(top + 34)} {n(x - 20)} {n(top)} Z" fill="{colour}" stroke="{colour}" stroke-width="4" stroke-linejoin="round"/>\n')
    return out


def daffodil(x, base, h, leaf='#7fa36a'):
    top = base - h
    out = f'    <path d="M{n(x)} {n(base)} Q{n(x - 6)} {n(base - h * 0.5)} {n(x + 4)} {n(top + 10)}" fill="none" stroke="{leaf}" stroke-width="7" stroke-linecap="round"/>\n'
    out += f'    <path d="M{n(x)} {n(base - 6)} Q{n(x + 30)} {n(base - h * 0.4)} {n(x + 22)} {n(base - h * 0.7)} Q{n(x + 6)} {n(base - h * 0.4)} {n(x)} {n(base - 6)} Z" fill="{leaf}"/>\n'
    cx, cy = x + 4, top
    for k in range(6):
        out += f'    <ellipse cx="{n(cx)}" cy="{n(cy - 15)}" rx="9" ry="16" fill="#f8d55c" transform="rotate({k * 60} {n(cx)} {n(cy)})"/>\n'
    out += f'    <circle cx="{n(cx)}" cy="{n(cy)}" r="11" fill="#f29e4c"/>\n'
    out += f'    <circle cx="{n(cx)}" cy="{n(cy)}" r="5" fill="#f8d55c"/>\n'
    return out


def bunny(cx, base, s, fur='#efe6d8', shade='#e2d6c4', inner='#f4b8c8'):
    """A sitting bunny seen from the side, facing left."""
    out = ''
    # Ears, behind the head.
    out += f'    <ellipse cx="{n(cx - 14 * s)}" cy="{n(base - 178 * s)}" rx="{n(15 * s)}" ry="{n(46 * s)}" fill="{shade}" transform="rotate(-8 {n(cx - 14 * s)} {n(base - 178 * s)})"/>\n'
    out += f'    <ellipse cx="{n(cx - 40 * s)}" cy="{n(base - 182 * s)}" rx="{n(16 * s)}" ry="{n(50 * s)}" fill="{fur}" transform="rotate(-18 {n(cx - 40 * s)} {n(base - 182 * s)})"/>\n'
    out += f'    <ellipse cx="{n(cx - 40 * s)}" cy="{n(base - 180 * s)}" rx="{n(7 * s)}" ry="{n(36 * s)}" fill="{inner}" transform="rotate(-18 {n(cx - 40 * s)} {n(base - 180 * s)})"/>\n'
    # Body and haunch.
    out += f'    <ellipse cx="{n(cx + 10 * s)}" cy="{n(base - 56 * s)}" rx="{n(72 * s)}" ry="{n(58 * s)}" fill="{fur}"/>\n'
    out += f'    <ellipse cx="{n(cx + 36 * s)}" cy="{n(base - 40 * s)}" rx="{n(44 * s)}" ry="{n(40 * s)}" fill="{shade}"/>\n'
    # Tail.
    out += f'    <circle cx="{n(cx + 84 * s)}" cy="{n(base - 62 * s)}" r="{n(18 * s)}" fill="#ffffff"/>\n'
    # Foot.
    out += f'    <ellipse cx="{n(cx - 10 * s)}" cy="{n(base - 8 * s)}" rx="{n(40 * s)}" ry="{n(10 * s)}" fill="{shade}"/>\n'
    # Head.
    out += f'    <ellipse cx="{n(cx - 42 * s)}" cy="{n(base - 116 * s)}" rx="{n(44 * s)}" ry="{n(38 * s)}" fill="{fur}"/>\n'
    out += f'    <circle cx="{n(cx - 58 * s)}" cy="{n(base - 124 * s)}" r="{n(5.5 * s)}" fill="#3d3328"/>\n'
    out += f'    <ellipse cx="{n(cx - 84 * s)}" cy="{n(base - 108 * s)}" rx="{n(6 * s)}" ry="{n(4.5 * s)}" fill="{inner}"/>\n'
    out += f'    <ellipse cx="{n(cx - 52 * s)}" cy="{n(base - 102 * s)}" rx="{n(10 * s)}" ry="{n(6 * s)}" fill="{inner}" opacity="0.6"/>\n'
    return out


def grass(x0, x1, y, depth, colour, blade=26, rng=None, jitter=8):
    """A strip of grass whose top edge is a row of soft blades, filled down to y + depth."""
    d = f'M{n(x0)} {n(y + depth)} L{n(x0)} {n(y)}'
    x = x0
    i = 0
    while x < x1:
        bx = min(x1, x + blade)
        h = (rng.uniform(0.6, 1.0) if rng else 1) * jitter * 2
        d += f' Q{n(x + blade * 0.35)} {n(y - h)} {n(x + blade * 0.5)} {n(y - h * 1.1)} Q{n(x + blade * 0.6)} {n(y - h * 0.3)} {n(bx)} {n(y)}'
        x = bx
        i += 1
    d += f' L{n(x1)} {n(y + depth)} Z'
    return f'    <path d="{d}" fill="{colour}"/>\n'


def write(name, content):
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as fh:
        fh.write(content)


# ---------------------------------------------------------------------------
# Birthday: the `warm` palette keeps the display's own theme, light or dark,
# so the ground is transparent and only the decorations are drawn.

PARTY = ['#f4a8c0', '#f6b73c', '#8fb8e0', '#f6a06b', '#b49ad8', '#9cc49a']


def birthday():
    rng = random.Random(7)
    # Tile.
    t = cake(60, 112, 0.42, '#f4a8c0', '#fff6f0', '#c8a07e', ['#5f94c4', '#e07a9a', '#9a7bc4'])
    write('birthday/tile.svg', svg(120, 120, g(t), comment='A birthday cake. Square and transparent, for the corner of a calendar tile.'))

    # Landscape.
    body = ''
    body += g(bunting(620, 1590, 4, 7, 11, PARTY) + bunting(1590, 2560, 4, 7, 11, PARTY[3:] + PARTY[:3]))
    body += g(confetti(rng, [
        (2522, 120, 2556, 1380, 5),   # the right-hand margin
        (760, 1402, 2550, 1436, 6),   # under the grid
        (8, 160, 40, 1100, 3),        # the left-hand margin
        (700, 120, 740, 1380, 2),     # the gap between the panel and the grid
    ], 60, PARTY))
    # The party, in the corner below the today panel.
    party = ''
    party += '    <rect x="16" y="1398" width="720" height="60" rx="20" fill="#c8a07e"/>\n'
    party += present(46, 1300, 110, 100, '#8fb8e0', '#fff6f0')
    party += present(170, 1338, 80, 62, '#f4a8c0', '#fff6f0')
    party += present(560, 1322, 92, 78, '#f6b73c', '#f6a06b')
    party += cake(400, 1400, 0.95, '#f4a8c0', '#fff6f0', '#e9d5c0', ['#5f94c4', '#e07a9a', '#9a7bc4', '#f6b73c'])
    party += balloon(680, 1250, 44, 54, '#e07a9a', 1398, 10)
    party += balloon(612, 1220, 38, 48, '#8fb8e0', 1322, -8)
    party += balloon(248, 1240, 36, 46, '#b49ad8', 1338, 8)
    body += g(party)
    write('birthday/full.svg', svg(2560, 1440, body, comment='Birthday, 2560×1440. The ground is transparent, so the display\'s own theme shows through. The cake and presents sit in the corner below the today panel, the bunting along the top, and confetti in the margins.'))

    # Portrait.
    rng = random.Random(8)
    body = ''
    body += g(bunting(580, 1060, 4, 7, 7, PARTY))
    body += g(confetti(rng, [
        (1402, 180, 1436, 2480, 5),
        (6, 180, 36, 2480, 5),
        (40, 2516, 1400, 2552, 4),
        (560, 100, 1000, 140, 1),
    ], 55, PARTY))
    corner = ''
    corner += present(1100, 74, 74, 62, '#f6b73c', '#f6a06b')
    corner += present(1186, 90, 60, 46, '#8fb8e0', '#fff6f0')
    corner += balloon(1320, 56, 34, 42, '#e07a9a', 150, 8)
    corner += balloon(1388, 76, 30, 38, '#b49ad8', 150, -6)
    corner += '    <rect x="1080" y="134" width="360" height="22" rx="11" fill="#c8a07e"/>\n'
    body += g(corner)
    write('birthday/full-portrait.svg', svg(1440, 2560, body, comment='Birthday, 1440×2560, transparent like the landscape one. On a portrait wall only the top strip beside the title, the margins and a band at the very bottom show, so the presents and balloons sit in the top right corner.'))


# ---------------------------------------------------------------------------
# Christmas: the `frost` palette, so a deep blue night.

def christmas():
    rng = random.Random(25)
    # Tile.
    t = fir(60, 116, 104, snowcap='#eef6fe')
    t += '    <circle cx="44" cy="80" r="5" fill="#e8786b"/><circle cx="74" cy="72" r="5" fill="#f6c544"/><circle cx="62" cy="54" r="4.5" fill="#92bce8"/><circle cx="80" cy="92" r="4.5" fill="#92bce8"/><circle cx="50" cy="96" r="4.5" fill="#f6c544"/>\n'
    t += star(60, 14, 11, '#f6c544')
    write('christmas/tile.svg', svg(120, 120, g(t), comment='A Christmas tree. Square and transparent, for the corner of a calendar tile.'))

    defs = ('    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">\n'
            '      <stop offset="0" stop-color="#0c2238"/>\n'
            '      <stop offset="0.6" stop-color="#112d48"/>\n'
            '      <stop offset="1" stop-color="#1f4a6e"/>\n'
            '    </linearGradient>\n'
            '    <radialGradient id="moon-glow" cx="0.5" cy="0.5" r="0.5">\n'
            '      <stop offset="0" stop-color="#d7eaff" stop-opacity="0.35"/>\n'
            '      <stop offset="1" stop-color="#d7eaff" stop-opacity="0"/>\n'
            '    </radialGradient>\n' + BULB_GLOW)
    COLS = ['#f6c544', '#e8786b', '#9cc49a', '#b5d8fd', '#f2a7c3']

    body = '  <rect width="2560" height="1440" fill="url(#sky)"/>\n'
    body += g(snow(rng, [
        (760, 4, 2556, 40, 4),
        (2520, 100, 2556, 1390, 4),
        (6, 170, 40, 1150, 3),
        (700, 110, 744, 1390, 2),
        (20, 1150, 740, 1300, 3),
    ], 140))
    body += g(snowflake(2538, 260, 16, opacity=0.8) + snowflake(2540, 700, 13, opacity=0.7) + snowflake(2536, 1120, 17, opacity=0.8)
              + snowflake(22, 420, 13, opacity=0.6) + snowflake(24, 880, 15, opacity=0.7) + snowflake(722, 640, 12, opacity=0.6))
    body += g(lights(640, 1600, -6, 6, 13, COLS) + lights(1600, 2560, -6, 6, 13, COLS[2:] + COLS[:2]))
    # The moon, low in the corner below the panel.
    scene = '    <circle cx="140" cy="1230" r="150" fill="url(#moon-glow)"/>\n    <circle cx="140" cy="1230" r="52" fill="#eef6fe"/>\n    <circle cx="124" cy="1218" r="9" fill="#d7eaff"/>\n    <circle cx="156" cy="1246" r="6" fill="#d7eaff"/>\n'
    # Snowy hills: the far one runs the width of the wall, the near one fills the corner.
    scene += '    <path d="M0 1440 L0 1392 Q300 1360 640 1384 Q1100 1410 1600 1392 Q2100 1374 2560 1396 L2560 1440 Z" fill="#b5d8fd"/>\n'
    scene += '    <path d="M0 1440 L0 1350 Q220 1316 460 1340 Q640 1358 760 1376 Q820 1386 900 1410 Q1300 1430 1800 1418 Q2200 1410 2560 1420 L2560 1440 Z" fill="#eef6fe"/>\n'
    scene += fir(70, 1360, 150, colours=('#1d5a4c', '#24685a', '#2f7a68'), snowcap='#eef6fe')
    scene += fir(700, 1388, 120, colours=('#1d5a4c', '#24685a', '#2f7a68'), snowcap='#eef6fe')
    # The big tree, with its baubles and star.
    tx, tb, th = 460, 1384, 180
    scene += fir(tx, tb, th, snowcap=None)
    # Garlands, then baubles, placed as fractions of the tree's height (up from the base) and half-width.
    for (u0, v0), (u1, v1) in [((-0.62, 0.3), (0.6, 0.38)), ((-0.42, 0.6), (0.4, 0.66))]:
        scene += f'    <path d="M{n(tx + u0 * th * 0.46)} {n(tb - v0 * th)} Q{n(tx)} {n(tb - (v0 + v1) / 2 * th + 18)} {n(tx + u1 * th * 0.46)} {n(tb - v1 * th)}" fill="none" stroke="#f6c544" stroke-width="5" stroke-linecap="round" opacity="0.9"/>\n'
    for u, v, col in [(-0.5, 0.24, '#e8786b'), (0.42, 0.28, '#f6c544'), (0.05, 0.36, '#92bce8'), (-0.25, 0.5, '#f6c544'), (0.3, 0.54, '#e8786b'), (-0.1, 0.72, '#92bce8'), (0.18, 0.8, '#f6c544'), (0.62, 0.17, '#92bce8'), (-0.66, 0.16, '#f6c544')]:
        scene += f'    <circle cx="{n(tx + u * th * 0.46)}" cy="{n(tb - v * th)}" r="9" fill="{col}"/>\n'
    scene += star(tx, tb - th - 4, 20, '#f6c544')
    scene += present(318, 1340, 70, 52, '#e8786b', '#eef6fe')
    scene += present(538, 1350, 60, 44, '#92bce8', '#e8786b')
    scene += present(394, 1360, 50, 34, '#f6c544', '#e8786b')
    body += g(scene)
    write('christmas/full.svg', svg(2560, 1440, body, defs, comment='Christmas, 2560×1440, on the frost palette\'s deep blue. The top left, where the month title sits, is plain sky. The tree, the moon and the snowy hills fill the corner below the today panel, fairy lights hang along the top and snow falls in the margins.'))

    # Portrait.
    rng = random.Random(26)
    body = '  <rect width="1440" height="2560" fill="url(#sky)"/>\n'
    body += g(snow(rng, [
        (560, 8, 1060, 150, 3),
        (1404, 180, 1436, 2490, 4),
        (6, 180, 36, 2490, 4),
    ], 110))
    body += g(snowflake(1420, 420, 14, opacity=0.8) + snowflake(1420, 1180, 12, opacity=0.7) + snowflake(1420, 1980, 15, opacity=0.8)
              + snowflake(20, 760, 12, opacity=0.6) + snowflake(20, 1560, 14, opacity=0.7) + snowflake(20, 2300, 12, opacity=0.6))
    body += g(lights(580, 1080, -6, 6, 7, COLS))
    corner = ''
    for i, (bx, length, r, col, band) in enumerate([(1120, 34, 28, '#e8786b', '#f6c544'), (1214, 70, 24, '#92bce8', '#eef6fe'), (1300, 22, 30, '#f6c544', '#e8786b'), (1388, 56, 24, '#9cc49a', '#eef6fe')]):
        corner += bauble(bx, 0, length, r, col, band)
    body += g(corner)
    ground = '    <path d="M0 2560 L0 2512 Q360 2496 720 2514 Q1080 2530 1440 2508 L1440 2560 Z" fill="#eef6fe"/>\n'
    body += g(ground)
    write('christmas/full-portrait.svg', svg(1440, 2560, body, defs, comment='Christmas, 1440×2560. Only the top strip, the margins and a thin band at the bottom show on a portrait wall, so baubles hang in the top right corner beside the title and the lights run along the top.'))


# ---------------------------------------------------------------------------
# Easter: the `sage` palette, so a pale spring green.

SPRING = ['#f6d36b', '#f4b8c8', '#c8b4e4', '#a8d8b9', '#a8cbe8', '#f7c59f']


def easter():
    rng = random.Random(4)
    # Tile.
    defs = ''
    t = ''
    e, d = egg(44, 72, 46, 60, EGG_STYLES[0], 'tile-egg-a', -12)
    t += e
    defs += d
    e, d = egg(80, 78, 40, 52, EGG_STYLES[1], 'tile-egg-b', 10)
    t += e
    defs += d
    t += grass(8, 112, 100, 18, '#8fa073', blade=13, rng=rng, jitter=6)
    write('easter/tile.svg', svg(120, 120, g(t), defs, comment='Two painted eggs in the grass. Square and transparent, for the corner of a calendar tile.'))

    sky = ('    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">\n'
           '      <stop offset="0" stop-color="#f5fbea"/>\n'
           '      <stop offset="1" stop-color="#e4f1cf"/>\n'
           '    </linearGradient>\n')

    # Landscape.
    defs = sky
    body = '  <rect width="2560" height="1440" fill="url(#sky)"/>\n'
    body += g(bunting(620, 1590, 4, 7, 11, SPRING) + bunting(1590, 2560, 4, 7, 11, SPRING[3:] + SPRING[:3]))
    edge = ''
    for y in (300, 760, 1180):
        edge += daisy(2540, y, 18)
    for y in (420, 900):
        edge += daisy(22, y, 16)
    edge += daisy(722, 760, 14)
    body += g(edge)
    scene = ''
    scene += '    <path d="M0 1440 L0 1300 Q200 1262 420 1290 Q640 1320 800 1380 Q860 1398 940 1406 L940 1440 Z" fill="#ccdbb2"/>\n'
    scene += tulip(60, 1350, 140, '#f4b8c8') + tulip(118, 1356, 112, '#c8b4e4') + daffodil(680, 1366, 120) + tulip(730, 1380, 100, '#f7c59f')
    scene += bunny(320, 1398, 0.92)
    eggs = [(520, 1370, 50, 64, 0, -10), (580, 1378, 44, 56, 1, 12), (466, 1388, 38, 50, 2, 6), (196, 1380, 42, 54, 3, -8)]
    for i, (cx, cy, w, h, st, rot) in enumerate(eggs):
        e, d = egg(cx, cy, w, h, EGG_STYLES[st], f'egg-{i}', rot)
        scene += e
        defs += d
    scene += grass(0, 2560, 1398, 50, '#aebf92', blade=30, rng=rng, jitter=9)
    # Eggs hidden in the grass under the grid.
    for i, (cx, st, rot) in enumerate([(980, 4, 8), (1360, 5, -10), (1720, 0, 6), (2140, 3, -6), (2460, 1, 10)]):
        e, d = egg(cx, 1410, 30, 38, EGG_STYLES[st], f'grass-egg-{i}', rot)
        scene += e
        defs += d
    for x in (860, 1180, 1540, 1900, 2300):
        scene += daisy(x, 1408, 10)
    # The front grass hides the bottoms of the eggs.
    scene += grass(0, 2560, 1424, 20, '#8fa073', blade=24, rng=rng, jitter=6)
    body += g(scene)
    write('easter/full.svg', svg(2560, 1440, body, defs, comment='Easter, 2560×1440, on the sage palette\'s pale green. The top left, where the month title sits, is plain. The bunny, its eggs and the flowers fill the corner below the today panel, more eggs hide in the grass along the bottom, and bunting hangs along the top.'))

    # Portrait.
    rng = random.Random(5)
    defs = sky
    body = '  <rect width="1440" height="2560" fill="url(#sky)"/>\n'
    body += g(bunting(580, 1060, 4, 7, 7, SPRING))
    edge = ''
    for y in (480, 1240, 2040):
        edge += daisy(1420, y, 15)
    for y in (820, 1640, 2380):
        edge += daisy(20, y, 14)
    body += g(edge)
    corner = '    <path d="M1460 18 Q1300 30 1180 70 Q1120 92 1080 132" fill="none" stroke="#8c7b66" stroke-width="9" stroke-linecap="round"/>\n'
    corner += '    <path d="M1250 46 Q1230 80 1236 108" fill="none" stroke="#8c7b66" stroke-width="6" stroke-linecap="round"/>\n'
    for bx, by in [(1400, 20), (1330, 38), (1162, 84), (1098, 122), (1236, 110)]:
        corner += daisy(bx, by, 13, petal='#f9d9e2', centre='#f6c544')
    for i, (cx, top, length, st) in enumerate([(1360, 30, 40, 0), (1290, 50, 64, 2), (1140, 96, 18, 1)]):
        corner += f'    <path d="M{cx} {top} L{cx} {top + length}" stroke="#c8b4e4" stroke-width="3" stroke-linecap="round"/>\n'
        e, d = egg(cx, top + length + 26, 36, 48, EGG_STYLES[st], f'hanging-egg-{i}')
        corner += e
        defs += d
    body += g(corner)
    ground = grass(0, 1440, 2516, 50, '#aebf92', blade=28, rng=rng, jitter=8)
    for i, (cx, st, rot) in enumerate([(180, 4, 8), (520, 5, -10), (900, 0, 6), (1260, 3, -6)]):
        e, d = egg(cx, 2530, 26, 32, EGG_STYLES[st], f'grass-egg-{i}', rot)
        ground += e
        defs += d
    body += g(ground)
    write('easter/full-portrait.svg', svg(1440, 2560, body, defs, comment='Easter, 1440×2560. Only the top strip, the margins and a thin band at the bottom show on a portrait wall, so a blossom branch with hanging eggs reaches into the top right corner beside the title.'))


birthday()
christmas()
easter()
