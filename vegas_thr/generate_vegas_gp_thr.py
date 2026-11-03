"""Las Vegas Grand Prix sand-table pattern (.thr).

Reuses the drawing toolkit from ../thanksgiving_thr/generate_thanksgiving_thr.py.
Usage: python3 generate_vegas_gp_thr.py OUTPUT_DIR
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_lib = open(os.path.join(HERE, "..", "thanksgiving_thr", "generate_thanksgiving_thr.py")).read()
exec(_lib[: _lib.index("for fn in (turkey")])  # Path, Shape, write, fills, etc.

import numpy as np  # noqa: E402

GROUND = -0.42


def zigzag_x(x0, x1, bottom, top, spacing):
    """Vertical zig-zag fill of the x-monotone region bottom(x) < y < top(x)."""
    xs = np.arange(x0, x1 + 1e-9, spacing / 2)
    pts = []
    for i, x in enumerate(xs):
        ys = (bottom(x), top(x)) if i % 2 == 0 else (top(x), bottom(x))
        pts += [(x, ys[0]), (x, ys[1])]
    return densify(np.array(pts))


def zigzag_y(y0, y1, half_width, spacing, cx=0.0):
    """Horizontal zig-zag fill of a shape symmetric about x=cx, swept from y0 to y1."""
    ys = np.arange(y0, y1 - 1e-9 if y1 < y0 else y1 + 1e-9, spacing / 2 * np.sign(y1 - y0))
    pts = []
    for i, y in enumerate(ys):
        w = half_width(y)
        xs = (cx - w, cx + w) if i % 2 == 0 else (cx + w, cx - w)
        pts += [(xs[0], y), (xs[1], y)]
    return densify(np.array(pts))


# Single-stroke capitals in a 0.6 x 1 box; each starts on the baseline.
LETTERS = {
    "L": [(0, 0), (0, 1), (0, 0), (0.6, 0)],
    "A": [(0, 0), (0.3, 1), (0.6, 0), (0.45, 0.5), (0.15, 0.5), (0.45, 0.5), (0.6, 0)],
    "S": [(0.15, 0), (0.45, 0), (0.6, 0.15), (0.6, 0.35), (0.45, 0.5), (0.15, 0.5), (0, 0.65),
          (0, 0.85), (0.15, 1), (0.45, 1), (0.6, 0.85)],
    "V": [(0.3, 0), (0, 1), (0.3, 0), (0.6, 1), (0.3, 0)],
    "E": [(0, 0), (0, 1), (0.6, 1), (0, 1), (0, 0.5), (0.45, 0.5), (0, 0.5), (0, 0), (0.6, 0)],
    "G": [(0.45, 0), (0.15, 0), (0, 0.15), (0, 0.85), (0.15, 1), (0.45, 1), (0.6, 0.85),
          (0.45, 1), (0.15, 1), (0, 0.85), (0, 0.15), (0.15, 0), (0.45, 0), (0.6, 0.15),
          (0.6, 0.45), (0.35, 0.45), (0.6, 0.45), (0.6, 0.15), (0.45, 0)],
}


def text(p, word, x0, y0, h, gap=0.35):
    """Write a word; travel between letters rides an underline at y0 - 0.15h."""
    ul = y0 - 0.15 * h
    p.to((x0, ul))
    x = x0
    for ch in word:
        stroke = np.array(LETTERS[ch], float) * h + (x, y0)
        p.to((stroke[0][0], ul)); p.to(stroke[0])
        p.add(densify(stroke))
        p.add(densify(stroke[::-1]))
        p.to((stroke[0][0], ul))
        x += (0.6 + gap) * h
    p.to((x - gap * h, ul))


def burst(p, c, r, rays, toward=None):
    """Firework: radial rays with bead tips. Enters/leaves at the centre.
    If `toward` is given, one ray points at it so the hop to the next burst rides that ray."""
    c = np.array(c)
    a0 = 0.2 if toward is None else ang(np.array(toward) - c)
    for i in range(rays):
        a = a0 + (i + 1) * TAU / rays
        rr = r * (1.0 if i % 2 else 0.72)
        u = np.array((math.cos(a), math.sin(a)))
        p.to(c + u * r * 0.18)
        p.to(c + u * rr)
        bead = Shape(c + u * (rr + 0.014), circle(0.014))
        p.add(bead.outline(a + math.pi, 1.0))
        p.to(c + u * r * 0.18)
    p.to(c)


def vegas():
    p = Path()
    spire = np.array((0.0, 0.47))

    # 1. Fireworks launched from the tower spire (trail bases get buried by the tower).
    A, B, C = (-0.34, 0.64), (0.0, 0.8), (0.34, 0.64)
    p.to(spire); p.to(B)
    burst(p, B, 0.12, 14, A); p.to(A)
    burst(p, A, 0.17, 18, B); p.to(B)
    burst(p, B, 0.12, 14, C); p.to(C)
    burst(p, C, 0.17, 18, B); p.to(B)
    p.to(spire)

    # 2. Eiffel tower: solid horizontal-zig-zag fill with a light arch at its feet.
    half = lambda y: 0.006 + 0.2 * max(0.0, (0.47 - y) / 0.89) ** 2.4
    tower = zigzag_y(0.47, GROUND, half, 0.02)
    p.add(avoid(tower, [(0.0, GROUND, 0.1)]))
    for y in (-0.3, -0.12, 0.18):                    # observation decks
        w = half(y) + 0.03
        p.to((-w, y)); p.to((w, y)); p.to((-w, y))
        p.to((-half(y - 0.03), y - 0.03))
    p.to((-0.2, GROUND))

    # 3. Low skyline, left half then right half (tower in between).
    rng = np.random.default_rng(7)
    for side in (-1, 1):
        xs = np.arange(0.2, 0.9, 0.07)
        pts = [(side * 0.2, GROUND)]
        for x in xs:
            h = GROUND + rng.uniform(0.1, 0.27)
            pts += [(side * x, pts[-1][1]), (side * x, h)]
        pts += [(side * 0.9, pts[-1][1]), (side * 0.9, GROUND)]
        if side < 0:
            p.add(densify(np.array(pts)))
            p.to((-0.2, GROUND)); p.to((0.2, GROUND))   # ground under the tower
        else:
            p.add(densify(np.array(pts)))

    # 4. High Roller observation wheel.
    wc, wr = np.array((0.52, 0.12)), 0.25
    p.to((0.66, GROUND)); p.to(wc); p.to((0.38, GROUND)); p.to(wc)  # A-frame legs
    for k in range(16):
        a = k * TAU / 16
        p.to(wc + wr * np.array((math.cos(a), math.sin(a))))
        cabin = Shape(wc + (wr + 0.025) * np.array((math.cos(a), math.sin(a))), circle(0.02))
        pts, _ = cabin.spiral([(1.0, 0.0, 0.008)], a + math.pi)
        p.to(pts[0]); p.add(pts); p.to(wc + wr * np.array((math.cos(a), math.sin(a))))
        p.to(wc)
    p.add(Shape(wc, circle(0.03)).spiral([(0.0, 1.0, 0.008)], 0.0)[0])
    p.to(wc + (wr, 0))
    p.add(arc(wr, 0, TAU, wc)); p.add(arc(wr - 0.02, 0, TAU, wc))

    # 5. Welcome sign. Text rides two full-width dividers so no stray travel lines.
    sc = np.array((-0.5, 0.1))
    p.to((0.38, GROUND)); p.to((-0.38, GROUND))
    for lx in (0.1, -0.1):
        p.to(sc + (lx, GROUND - sc[1])); p.to(sc + (lx, -0.18))
        p.to(sc + (lx, GROUND - sc[1]))
    W, H = 0.33, 0.18
    shape = np.array([(-W, 0.02), (-W + 0.07, H), (W - 0.07, H), (W, 0.02), (W - 0.08, -H),
                      (-W + 0.08, -H), (-W, 0.02)])
    inner = shape * 0.9
    def edge_x(y, side):
        # x of the inner outline at height y on the given side (-1 left, +1 right)
        pts = inner if side < 0 else inner * (-1, 1)
        ys, xs = pts[[5, 0, 1], 1], pts[[5, 0, 1], 0]
        return side * -np.interp(y, ys, -xs) if side > 0 else np.interp(y, ys, xs)
    p.to(sc + (-0.1, -0.18)); p.to(sc + inner[5])
    # VEGAS row, left -> right
    yv = -0.11
    p.to(sc + (edge_x(yv - 0.015, -1), yv - 0.015))
    text(p, "VEGAS", sc[0] - 0.235, sc[1] + yv, 0.1)
    p.to(sc + (-edge_x(yv - 0.015, -1), yv - 0.015))
    # up the right inner edge, LAS row right -> left
    yl = 0.06
    p.to(sc + (-edge_x(0.02, -1), 0.02)); p.to(sc + (-edge_x(yl - 0.01, -1), yl - 0.01))
    p.to(sc + (0.13, yl - 0.01))
    text(p, "LAS", sc[0] - 0.115, sc[1] + yl, 0.075)
    p.to(sc + (edge_x(yl - 0.01, -1), yl - 0.01)); p.to(sc + inner[0])
    # inner outline, then beaded outer outline
    p.add(densify(sc + inner))
    outline = densify(sc + shape)
    p.to(outline[0])
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(outline, axis=0).T))]
    next_bulb = 0.0
    for i, q in enumerate(outline):
        p.to(q)
        if seg[i] >= next_bulb:
            p.add(Shape(q + (0, 0.012), circle(0.012)).outline(-math.pi / 2, 1.0))
            p.to(q)
            next_bulb += 0.05
    p.to(sc + shape[1]); p.to(sc + (0, H)); p.to(sc + (0, H + 0.08))
    star = Shape(sc + (0, H + 0.15), lambda ph: 0.035 + 0.045 * np.abs(np.cos(4 * ph)) ** 3)
    p.add(star.rays(-math.pi / 2, 40, 0.1)); p.add(star.outline(-math.pi / 2))
    p.to(sc + (0, H + 0.08)); p.to(sc + (0, H)); p.to(sc + shape[2]); p.to(sc + shape[3])
    p.to(sc + shape[4]); p.to(sc + (0.1, -H)); p.to(sc + (0.1, GROUND - sc[1]))

    # 6. F1 car in side profile (facing right), solid fill; tyres drawn on top.
    top_pts = [(-0.62, -0.16), (-0.551, -0.16), (-0.549, -0.3), (-0.4, -0.29), (-0.24, -0.25),
               (-0.16, -0.19), (-0.08, -0.19), (-0.05, -0.22), (-0.02, -0.195), (0.03, -0.225),
               (0.08, -0.27), (0.3, -0.31), (0.5, -0.35), (0.56, -0.33), (0.62, -0.37)]
    bot_pts = [(-0.62, -0.25), (-0.551, -0.25), (-0.549, -0.38), (0.48, -0.38), (0.5, -0.405),
               (0.62, -0.405)]
    tx, ty = np.array(top_pts).T
    bx, by = np.array(bot_pts).T
    top = lambda x: np.interp(x, tx, ty)
    bot = lambda x: np.interp(x, bx, by)
    DY = -0.28
    ty, by = ty + DY, by + DY
    TRACK = GROUND + DY
    wheels = [((-0.4, TRACK + 0.1), 0.1), ((0.38, TRACK + 0.088), 0.088)]
    p.to((-0.62, bot(-0.62)))
    body = zigzag_x(-0.62, 0.62, bot, top, 0.016)
    p.add(avoid(body, [(c[0], c[1], r + 0.008) for c, r in wheels]))
    # halo + helmet visor
    p.add(bezier(p.last, (0.5, -0.58), (0.12, -0.48), (0.05, -0.495)))
    p.add(bezier((0.05, -0.495), (0.0, -0.45), (-0.07, -0.45), (-0.09, -0.47)))
    p.to((-0.09, -0.47)); p.to((-0.1, -0.58))
    for (c, r) in wheels:
        tyre = Shape(c, circle(r))
        p.to(tyre.at(math.pi / 2))
        pts, end = tyre.spiral([(1.0, 0.45, 0.012)], math.pi / 2)
        p.add(pts)
        hub = Shape(c, circle(r * 0.2))
        p.to(hub.at(end)); p.add(hub.spiral([(1.0, 0.0, 0.008)], end)[0])
        p.to(tyre.at(-math.pi / 2))

    # 7. Speed lines behind the car, kerb blocks along the track, exit.
    p.to((-0.63, TRACK + 0.04))
    for k, y in enumerate((TRACK + 0.04, TRACK + 0.1, TRACK + 0.16, TRACK + 0.22)):
        xl = -math.sqrt(0.97 ** 2 - y * y) + 0.03
        p.to((-0.64, y)); p.to((xl, y)); p.to((-0.64, y))
    p.to((-0.64, TRACK))
    xe = math.sqrt(0.97 ** 2 - TRACK ** 2)
    p.to((-xe, TRACK)); p.to((xe, TRACK))
    ky0, ky1 = TRACK - 0.05, TRACK - 0.11
    xe2 = math.sqrt(0.97 ** 2 - ky1 ** 2) - 0.02
    p.to((xe2, ky0)); p.to((-xe2, ky0))
    xs = np.arange(-xe2, xe2 - 0.07, 0.14)
    for x in xs:   # filled kerb blocks with gaps between
        p.add(zigzag_x(x, x + 0.07, lambda _: ky1, lambda _: ky0, 0.014))
        p.to((p.last[0], ky1)); p.to((x + 0.14, ky1))
    p.to((-xe2, ky1)) if False else None
    p.to((0.0, ky1)); p.to((0.0, -1.0))
    write("las_vegas_grand_prix", "Las Vegas Grand Prix", p.pts)


if __name__ == "__main__":
    vegas()
