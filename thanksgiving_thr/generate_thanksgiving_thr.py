"""Thanksgiving sand-table patterns (.thr), v2: filled/texture-based designs.

Techniques
- Star-shaped regions are filled with continuous spirals (contour fill) or
  radial zig-zags (vein fill). Dense grooves read dark against smooth sand.
- Travel moves are routed through areas that a later fill will plow over.
- `avoid` pushes a path around a circle so a region (e.g. the turkey head)
  stays untouched while the path remains continuous.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
PREV = os.path.join(OUT, "previews")
os.makedirs(PREV, exist_ok=True)
STEP = 0.003
TAU = 2 * math.pi


# ------------------------------------------------------------------ core
class Path:
    def __init__(self):
        self.pts = [np.zeros(2)]

    @property
    def last(self):
        return self.pts[-1]

    def add(self, arr):
        self.pts.extend(np.asarray(arr, float))

    def to(self, p):
        self.pts.append(np.asarray(p, float))


def densify(pts):
    res = [pts[0]]
    for a, b in zip(pts[:-1], pts[1:]):
        k = int(np.linalg.norm(b - a) / STEP)
        if k:
            t = np.linspace(0, 1, k + 2)[1:-1, None]
            res.extend(a + (b - a) * t)
        res.append(b)
    return np.array(res)


def avoid(pts, circles):
    pts = np.array(pts, float)
    for cx, cy, r in circles:
        d = pts - (cx, cy)
        n = np.hypot(d[:, 0], d[:, 1])
        m = n < r
        n[n == 0] = 1e-9
        pts[m] = np.array((cx, cy)) + d[m] / n[m, None] * r
    return pts


class Shape:
    """Star-shaped region: centre c, polar radius function rf(phi), rotation."""

    def __init__(self, c, rf, rot=0.0, scale=1.0):
        self.c, self.rf, self.rot, self.scale = np.array(c, float), rf, rot, scale
        self.rmax = scale * max(rf(np.linspace(0, TAU, 720)))

    def at(self, phi, s=1.0):
        phi = np.asarray(phi, float)
        r = self.scale * s * self.rf(phi)
        a = phi + self.rot
        return np.stack([self.c[0] + r * np.cos(a), self.c[1] + r * np.sin(a)], -1)

    def spiral(self, bands, phi0):
        """Continuous spiral through scale bands [(s_from, s_to, spacing), ...].
        Returns (points, end_phi)."""
        out, phi = [], phi0
        for s0, s1, sp in bands:
            turns = max(abs(s1 - s0) * self.rmax / sp, 0.25)
            n = int(turns * TAU * self.rmax * max(s0, s1) / STEP) + 20
            u = np.linspace(0, 1, n)
            ph = phi + TAU * turns * u
            s = s0 + (s1 - s0) * u
            r = self.scale * s * self.rf(ph)
            a = ph + self.rot
            out.append(np.c_[self.c[0] + r * np.cos(a), self.c[1] + r * np.sin(a)])
            phi = ph[-1]
        return np.vstack(out), phi

    def outline(self, phi0, turns=1.0):
        n = int(turns * TAU * self.rmax / STEP) + 20
        ph = phi0 + TAU * turns * np.linspace(0, 1, n)
        return self.at(ph)

    def rays(self, phi0, count, s_in=0.08):
        """Radial zig-zag (vein) fill, one full turn starting/ending on the edge."""
        ph = phi0 + np.linspace(0, TAU, count * 2 + 1)
        s = np.where(np.arange(len(ph)) % 2 == 0, 1.0, s_in)
        return densify(np.vstack([self.at(p, si) for p, si in zip(ph, s)]))


def ellipse(a, b, tear=0.0):
    return lambda p: a * b / np.sqrt((b * np.cos(p)) ** 2 + (a * np.sin(p)) ** 2) * (1 + tear * np.cos(p))


def circle(r):
    return lambda p: np.full_like(np.asarray(p, float), r)


def polar_poly(verts_deg_r, mirror=True):
    """Piecewise-linear polar outline; angles measured from 'up', mirrored."""
    v = list(verts_deg_r)
    if mirror:
        v = v + [(360 - d, r) for d, r in reversed(v[1:-1])]
    v = v + [(360, v[0][1])]
    d = np.radians([x[0] for x in v])
    r = np.array([x[1] for x in v])
    return lambda p: np.interp(np.mod(math.pi / 2 - np.asarray(p, float), TAU), d, r)


def bezier(p0, p1, p2, p3, n=None):
    p0, p1, p2, p3 = map(np.asarray, (p0, p1, p2, p3))
    n = n or int((np.linalg.norm(p1 - p0) + np.linalg.norm(p2 - p1) + np.linalg.norm(p3 - p2)) / STEP) + 2
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def arc(r, a0, a1, c=(0, 0)):
    n = max(4, int(abs(a1 - a0) * r / STEP))
    a = np.linspace(a0, a1, n)
    return np.c_[c[0] + r * np.cos(a), c[1] + r * np.sin(a)]


def ang(p):
    return math.atan2(p[1], p[0])


# ------------------------------------------------------------------ output
def write(name, title, pts):
    pts = densify(np.array(pts, float))
    rho = np.hypot(pts[:, 0], pts[:, 1])
    over = rho > 1
    pts[over] /= rho[over, None]
    rho = np.minimum(rho, 1)
    theta = np.arctan2(pts[:, 0], pts[:, 1])
    small = rho < 1e-6
    if small.any() and (~small).any():
        idx = np.where(~small)[0]
        theta[small] = np.interp(np.where(small)[0], idx, theta[idx])
    theta = np.unwrap(theta)
    rho[0] = 0.0
    assert rho[-1] > 0.999, (name, rho[-1])
    rho[-1] = 1.0
    # drop collinear-ish redundant points to keep files lean
    keep = [0]
    for i in range(1, len(theta) - 1):
        if abs(theta[i] - theta[keep[-1]]) > 0.004 or abs(rho[i] - rho[keep[-1]]) > 0.002:
            keep.append(i)
    keep.append(len(theta) - 1)
    theta, rho = theta[keep], rho[keep]
    with open(os.path.join(OUT, name + ".thr"), "w") as f:
        f.write(f"# {title}\n# Thanksgiving sand table pattern - starts at center, ends at rim\n")
        for t, r in zip(theta, rho):
            f.write(f"{t:.5f} {r:.5f}\n")
    render(name, theta, rho)
    print(f"{name}: {len(theta)} points")


def render(name, theta, rho, size=900, ball=0.017):
    """Approximate a sand table: grooves with a shadow and a highlight edge."""
    rng = np.random.default_rng(1)
    base = np.array([226, 205, 165], np.uint8)
    noise = rng.normal(0, 6, (size, size, 1))
    img = Image.fromarray(np.clip(base + noise, 0, 255).astype(np.uint8))
    c, R = size / 2, size / 2 - 14
    # fine interpolation in polar space, like the table itself
    th = np.interp(np.linspace(0, len(theta) - 1, len(theta) * 3), np.arange(len(theta)), theta)
    rh = np.interp(np.linspace(0, len(rho) - 1, len(rho) * 3), np.arange(len(rho)), rho)
    xy = np.c_[c + R * rh * np.sin(th), c - R * rh * np.cos(th)]
    w = max(3, int(ball * R))
    layer = Image.new("L", (size, size), 0)
    ImageDraw.Draw(layer).line([tuple(p) for p in xy], fill=255, width=w, joint="curve")
    groove = np.array(layer.filter(ImageFilter.GaussianBlur(w * 0.35)), float) / 255
    # Lighting from top-left: derivative of the groove mask
    gy, gx = np.gradient(groove)
    light = np.clip((gx + gy) * 6, -1, 1)
    arr = np.array(img, float)
    arr *= (1 - 0.22 * groove)[..., None]
    arr += (light * 55)[..., None]
    yy, xx = np.mgrid[0:size, 0:size]
    outside = (xx - c) ** 2 + (yy - c) ** 2 > (R + 6) ** 2
    arr[outside] = (60, 42, 28)
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(os.path.join(PREV, name + ".png"))


# ------------------------------------------------------------------ turkey
def turkey():
    p = Path()
    head_c, head_r = np.array((0.0, 0.1)), 0.17
    hub = np.array((0.0, -0.28))
    body = Shape((0.0, -0.3), ellipse(0.31, 0.33))
    head_guard = [(head_c[0], head_c[1], head_r + 0.012)]

    # Head first (centre of table is inside it): eyes, beak, wattle, outline.
    for ex in (-0.06, 0.06):
        eye = Shape(head_c + (ex, 0.05), circle(0.032))
        pts, _ = eye.spiral([(0.0, 1.0, 0.008)], 0.0)
        p.to(pts[0]); p.add(pts)
    beak = Shape(head_c + (0.0, -0.025), polar_poly([(0, 0.035), (60, 0.03), (120, 0.04), (180, 0.075)]), scale=1.3)
    pts, _ = beak.spiral([(1.0, 0.0, 0.007)], math.pi / 2)
    p.to(pts[0]); p.add(pts)
    wattle = Shape(head_c + (0.045, -0.085), ellipse(0.028, 0.065, 0.0), rot=0.25)
    pts, _ = wattle.spiral([(0.0, 1.0, 0.008)], 0.0)
    p.to(pts[0]); p.add(pts)
    hs = Shape(head_c, circle(head_r))
    p.to(hs.at(-math.pi / 2)); p.add(hs.outline(-math.pi / 2, 2.0))
    p.to(hub)

    # Tail feathers: back layer banded, front layer solid. Each starts/ends in the body.
    def feather(alpha, d, a, b, bands):
        u = np.array((math.cos(alpha), math.sin(alpha)))
        f = Shape(hub + u * d, ellipse(a, b, 0.12), rot=alpha)
        start = f.at(math.pi)
        p.to(start)
        pts, end = f.spiral(bands, math.pi)
        p.add(avoid(pts, head_guard))
        p.add(avoid(densify(np.vstack([pts[-1:], f.at(math.pi)])), head_guard))
        p.to(hub)

    for k, al in enumerate(np.radians(np.linspace(8, 172, 9))):
        feather(al, 0.6, 0.38, 0.1, [(1.0, 0.82, 0.026), (0.82, 0.62, 0.09), (0.62, 0.0, 0.03)])
    for k, al in enumerate(np.radians(np.linspace(18.25, 161.75, 8))):
        feather(al, 0.47, 0.22, 0.055, [(1.0, 0.0, 0.045)])

    # Legs (drawn before the body so their tops get buried).
    for lx in (-0.1, 0.1):
        knee = np.array((lx * 1.15, -0.72))
        p.to((lx, -0.5)); p.to(knee)
        for dx in (-0.07, 0.0, 0.07):
            p.to(knee + (dx, -0.09)); p.to(knee)
        p.to((lx + 0.015 * np.sign(lx), -0.5))
    p.to(hub)

    # Body: contour spiral from the centre outward, flowing around the head.
    pts, end = body.spiral([(0.0, 1.0, 0.026)], -math.pi / 2 - TAU * body.rmax / 0.026)
    p.to(pts[0]); p.add(avoid(pts, head_guard))
    p.add(avoid(body.outline(end, 1.0), head_guard))

    # Ground: rolling grass line, then off to the rim.
    p.to((0.0, -0.84))
    x = np.linspace(0, -0.5, 300)
    p.add(np.c_[x, -0.84 + 0.02 * np.sin(x * 60)])
    x = np.linspace(-0.5, 0.5, 600)
    p.add(np.c_[x, -0.84 + 0.02 * np.sin(x * 60)])
    p.to((0.5, -0.86)); p.to(np.array((0.5, -0.86)) / np.hypot(0.5, -0.86))
    write("thanksgiving_turkey", "Turkey Strut", p.pts)


# ------------------------------------------------------------------ pumpkin
def pumpkin():
    p = Path()
    cy = -0.12
    lobes = [(-0.4, 0.25, 0.43), (0.4, 0.25, 0.43), (-0.21, 0.26, 0.47), (0.21, 0.26, 0.47), (0.0, 0.25, 0.5)]
    for i, (x, rx, ry) in enumerate(lobes):
        s = Shape((x, cy), ellipse(rx, ry))
        phi0 = 0.0 if x <= 0 else math.pi           # enter on the side facing the middle
        p.to(s.at(phi0))
        pts, _ = s.spiral([(1.0, 0.92, 0.012), (0.92, 0.0, 0.034)], phi0)
        p.add(pts)
        p.to((0.0, cy))
    # Stem: tapered, densely filled.
    top = np.array((0.0, cy + 0.47))
    stem = Shape(top + (0.015, 0.1), polar_poly([(0, 0.1), (20, 0.1), (50, 0.045), (130, 0.05), (165, 0.12), (180, 0.12)], mirror=True), rot=-0.15)
    p.to((0.0, cy + 0.2)); p.to(stem.at(-math.pi / 2))
    pts, _ = stem.spiral([(1.0, 0.0, 0.009)], -math.pi / 2)
    p.add(pts)
    p.to(stem.at(-0.2))
    # Curly tendril.
    t = np.linspace(0, 1, 900)
    a = math.pi + t * 5 * math.pi
    r = 0.13 * (1 - 0.85 * t)
    p.add(bezier(p.last, p.last + (0.12, 0.05), (0.26, 0.48), (0.3, 0.45)))
    p.add(np.c_[0.3 + 0.13 + r * np.cos(a), 0.45 + r * np.sin(a)])
    # Leaf (vein fill) on the left.
    leaf = Shape((-0.3, cy + 0.6), polar_poly([(0, 0.17), (25, 0.1), (45, 0.14), (75, 0.08), (100, 0.12), (150, 0.06), (180, 0.04)]), rot=0.9)
    p.add(bezier(p.last, (0.3, 0.62), (0.0, 0.62), leaf.at(-math.pi / 2 - 0.9 + math.pi * 0)))
    p.add(leaf.rays(-math.pi / 2, 28, 0.1))
    p.add(leaf.outline(-math.pi / 2, 1.0))
    # Harvest border: two braided rings.
    a0 = ang(p.last)
    p.to(0.86 * np.array((math.cos(a0), math.sin(a0))))
    a = a0 + np.linspace(0, TAU, 9000)
    for ph in (0.0, math.pi):
        r = 0.9 + 0.04 * np.sin(30 * (a - a0) + ph)
        p.add(np.c_[r * np.cos(a), r * np.sin(a)])
        p.to(0.86 * np.array((math.cos(a0), math.sin(a0))))
    p.to((math.cos(a0), math.sin(a0)))
    write("thanksgiving_pumpkin", "Harvest Pumpkin", p.pts)


# ------------------------------------------------------------------ maple leaves
MAPLE = polar_poly([(0, 1.0), (7, 0.66), (12, 0.72), (21, 0.5), (29, 0.38), (37, 0.6), (41, 0.56),
                    (50, 0.95), (58, 0.6), (64, 0.66), (75, 0.46), (86, 0.33), (95, 0.5), (100, 0.47),
                    (111, 0.64), (124, 0.4), (145, 0.27), (168, 0.17), (180, 0.15)])


def maple_leaves():
    p = Path()
    leaves = [  # x, y, scale, rotation(deg, ccw), style
        (0.02, 0.0, 0.36, 8, "contour"),
        (-0.42, 0.45, 0.27, 28, "rays"),
        (0.45, 0.42, 0.25, -32, "contour"),
        (0.55, -0.3, 0.22, -70, "rays"),
        (-0.05, -0.62, 0.2, 170, "contour"),
        (-0.55, -0.25, 0.22, 60, "rays"),
        (0.0, 0.72, 0.15, -10, "rays"),
    ]
    for i, (x, y, sc, rot, style) in enumerate(leaves):
        rr = math.radians(rot)
        lf = Shape((x, y), MAPLE, rot=rr, scale=sc)
        entry = lf.at(math.pi / 2)  # tip of the top lobe
        if i == 0:
            p.to(lf.at(math.pi / 2, 0.4))
            p.to(entry)
        else:
            d = entry - p.last
            nrm = np.array((-d[1], d[0]))
            p.add(bezier(p.last, p.last + 0.35 * d + 0.25 * nrm, entry - 0.35 * d + 0.25 * nrm, entry))
        if style == "contour":
            pts, _ = lf.spiral([(1.0, 0.85, 0.012), (0.85, 0.0, 0.028)], math.pi / 2)
            p.add(pts)
        else:
            p.add(lf.rays(math.pi / 2, 60, 0.06))
            p.add(lf.outline(math.pi / 2, 1.0))
            p.add(lf.outline(math.pi / 2, 1.0))
            p.to(lf.c)
        # midrib down and out along the stem
        stem_base = lf.at(-math.pi / 2)
        dn = np.array((math.sin(rr), -math.cos(rr)))
        side = np.array((math.cos(rr), math.sin(rr)))
        p.to(stem_base)
        p.add(bezier(stem_base, stem_base + dn * 0.2 * sc, stem_base + dn * 0.4 * sc + side * 0.06 * sc,
                     stem_base + dn * 0.6 * sc + side * 0.12 * sc))
    # Final gust: spiral out to the rim.
    a0 = ang(p.last)
    r0 = np.hypot(*p.last)
    t = np.linspace(0, 1, 3000)
    a = a0 + t * 1.5 * math.pi
    r = r0 + (1 - r0) * t ** 1.5
    p.add(np.c_[r * np.cos(a), r * np.sin(a)])
    write("thanksgiving_maple_leaves", "Falling Maple Leaves", p.pts)


# ------------------------------------------------------------------ cornucopia
def cornucopia():
    p = Path()
    s = np.linspace(0, 1, 9000)
    sx = 0.6 - 0.95 * s + 0.12 * np.sin(math.pi * s)
    sy = 0.3 - 0.32 * s - 0.24 * np.sin(math.pi * s * 0.9)
    R = 0.022 + 0.25 * s ** 1.5
    w = TAU * 22 * s
    k = int(np.argmin(np.hypot(sx, sy)))
    p.to((sx[k], sy[k]))
    p.add(np.c_[sx[k::-1], sy[k::-1]])
    # curled tip
    t = np.linspace(0, 1, 700)
    a = -math.pi / 2 + t * 3.2 * math.pi
    rr = 0.02 + 0.1 * t
    curl = np.c_[sx[0] + 0.02 + rr * np.cos(a), sy[0] + 0.11 + rr * np.sin(a)][::-1]
    p.to(curl[0]); p.add(curl); p.to((sx[0], sy[0]))
    # ribbed horn; a second pass offset by half a loop thickens the weave
    p.add(np.c_[sx + R * np.cos(w), sy + 1.1 * R * np.sin(w)])
    # Fruit spilling out (back to front), each one entered from the mouth side.
    def blob(shape, bands, phi0=0.0, guard=None):
        p.to(shape.at(phi0))
        pts, _ = shape.spiral(bands, phi0)
        p.add(avoid(pts, guard) if guard else pts)
    for gx, gy in [(-0.5, 0.2), (-0.6, 0.26), (-0.6, 0.13), (-0.7, 0.2), (-0.7, 0.07), (-0.8, 0.13), (-0.79, 0.0)]:
        blob(Shape((gx, gy), circle(0.058)), [(1.0, 0.0, 0.011)], 0.0, [(gx - 0.02, gy + 0.02, 0.016)])
    p.add(bezier(p.last, (-0.75, 0.3), (-0.55, 0.38), (-0.45, 0.33)))   # vine
    p.to((-0.55, 0.0))
    # apple with highlight
    blob(Shape((-0.6, -0.27), polar_poly([(0, 0.13), (20, 0.15), (90, 0.16), (160, 0.15), (180, 0.14)])),
         [(1.0, 0.0, 0.026)], math.pi / 2)
    p.to((-0.6, -0.12)); p.to((-0.57, -0.06)); p.to((-0.6, -0.12))
    # small gourd
    for rx in (0.17, 0.12, 0.06):
        g = Shape((-0.25, -0.48), ellipse(rx, 0.1))
        p.to(g.at(math.pi / 2)); p.add(g.outline(math.pi / 2, 1.0))
    p.to((-0.25, -0.38)); p.to((-0.23, -0.33)); p.to((-0.25, -0.38))
    # wheat stalks fanning out of the mouth
    for tip in ((-0.35, 0.55), (-0.2, 0.6)):
        base = np.array((-0.25, 0.1))
        tip = np.array(tip)
        p.to(base); p.to(tip)
        d = (tip - base) / np.linalg.norm(tip - base)
        nrm = np.array((-d[1], d[0]))
        for j in range(6):
            c = tip - d * (0.02 + 0.035 * j)
            for sd in (1, -1):
                p.to(c); p.to(c + d * 0.04 + nrm * sd * 0.035); p.to(c)
        p.to(base)
    # table and frame
    p.to((-0.25, -0.6)); p.to((-0.8, -0.6)); p.to((0.8, -0.6))
    a0 = ang((0.8, -0.6))
    p.add(arc(0.95, a0, a0 + TAU)); p.to((math.cos(a0), math.sin(a0)))
    write("thanksgiving_cornucopia", "Horn of Plenty", p.pts)


# ------------------------------------------------------------------ sunflower
def sunflower():
    p = Path()
    disk = 0.3
    n = 26
    for i in range(n):
        al = math.pi / 2 + i * TAU / n
        u = np.array((math.cos(al), math.sin(al)))
        for (d, a, b, bands) in ([(0.6, 0.31, 0.075, [(1.0, 0.0, 0.03)])] if True else []):
            f = Shape(u * d, ellipse(a, b, 0.18), rot=al)
            p.to(f.at(math.pi))
            pts, _ = f.spiral(bands, math.pi)
            p.add(pts)
            p.to(f.at(math.pi))
        # short accent petal between the main ones, in the back
        al2 = al + math.pi / n
        u2 = np.array((math.cos(al2), math.sin(al2)))
        f2 = Shape(u2 * 0.47, ellipse(0.2, 0.05, 0.15), rot=al2)
        p.to(f2.at(math.pi)); p.add(f2.outline(math.pi, 1.0))
        p.to(u2 * 0.15)
    # Seed head: crossing log-spiral parastichies (21 one way, 34 the other).
    r0, r1 = 0.02, disk
    for count, sgn in ((21, 1), (34, -1)):
        rr = np.linspace(r0, r1, 400)
        k = sgn * 1.4
        for j in range(count):
            off = j * TAU / count
            a = off + k * np.log(rr / r0)
            pts = np.c_[rr * np.cos(a), rr * np.sin(a)]
            if j % 2:
                pts = pts[::-1]
            if j:
                if j % 2:   # move along the rim
                    p.add(arc(r1, ang(p.last), ang(p.last) + ((ang(pts[0]) - ang(p.last)) % TAU)))
                else:       # move around the tiny centre circle
                    p.add(arc(r0, ang(p.last), ang(p.last) + ((ang(pts[0]) - ang(p.last)) % TAU)))
            else:
                p.to(pts[0])
            p.add(pts)
        p.to(np.zeros(2) + (r0, 0))
    p.add(arc(r1, 0, 0))
    p.to((r1, 0)); p.add(arc(r1, 0, 2 * TAU)); p.add(arc(r1 + 0.012, 0, TAU))
    # out between two petals to a scalloped frame
    a0 = math.pi / 2 + math.pi / n * 0 + TAU / n * 0.5 + TAU / n * 6
    p.add(arc(r1 + 0.012, TAU, TAU + (a0 % TAU)))
    p.to(0.93 * np.array((math.cos(a0), math.sin(a0))))
    a = a0 + np.linspace(0, TAU, 9000)
    r = 0.93 + 0.035 * np.abs(np.sin(n * (a - a0) / 2 * 2))
    p.add(np.c_[r * np.cos(a), r * np.sin(a)])
    p.to((math.cos(a0), math.sin(a0)))
    write("thanksgiving_sunflower", "Harvest Sunflower", p.pts)


# ------------------------------------------------------------------ wheat wreath
def wheat_wreath():
    p = Path()
    # Centre: a dense "harvest moon" spiral.
    moon = Shape((0, 0), circle(0.22))
    pts, end = moon.spiral([(0.0, 1.0, 0.016)], 0.0)
    p.add(pts)
    n = 14
    for i in range(n):
        al = end + i * TAU / n
        u = np.array((math.cos(al), math.sin(al)))
        nrm = np.array((-u[1], u[0]))
        p.add(arc(0.22, ang(p.last), ang(p.last) + ((al - ang(p.last)) % TAU)))
        # curved stalk
        tip = u * 0.86 + nrm * 0.12
        ctrl = u * 0.55
        stalk = bezier(u * 0.22, ctrl, ctrl + nrm * 0.05, tip)
        p.add(stalk)
        # filled grains down the head of the stalk, both sides
        for j, idx in enumerate(np.linspace(len(stalk) - 1, len(stalk) * 0.62, 8).astype(int)):
            c = stalk[idx]
            d = stalk[min(idx + 5, len(stalk) - 1)] - stalk[max(idx - 5, 0)]
            d /= np.linalg.norm(d)
            for sd in (1, -1):
                ga = math.atan2(d[1], d[0]) + sd * 0.55
                g = Shape(c + 0.04 * np.array((math.cos(ga), math.sin(ga))), ellipse(0.042, 0.017, 0.2), rot=ga)
                p.to(g.at(math.pi))
                gp, _ = g.spiral([(1.0, 0.0, 0.007)], math.pi)
                p.add(gp)
                p.to(c)
            # awns
            if j < 4:
                for sd in (1, -1):
                    aa = math.atan2(d[1], d[0]) + sd * 0.35
                    p.to(c + 0.11 * np.array((math.cos(aa), math.sin(aa)))); p.to(c)
        p.add(stalk[::-1])
    # leafy vine ring and exit
    a0 = ang(p.last)
    p.to(0.95 * np.array((math.cos(a0), math.sin(a0))))
    a = a0 + np.linspace(0, TAU, 9000)
    r = 0.95 + 0.025 * np.sin(42 * (a - a0))
    p.add(np.c_[r * np.cos(a), r * np.sin(a)])
    p.to((math.cos(a0), math.sin(a0)))
    write("thanksgiving_wheat_wreath", "Wheat Wreath", p.pts)


for fn in (turkey, pumpkin, maple_leaves, cornucopia, sunflower, wheat_wreath):
    fn()
