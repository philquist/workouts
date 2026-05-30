#!/usr/bin/env python3
"""
make_icons.py — generate the app icon set (a barbell mark) into icons/,
using only the Python standard library (no Pillow required).

    python3 tools/make_icons.py
"""
import os, struct, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")

BG = (15, 17, 21, 255)        # #0f1115
ACCENT = (91, 140, 255, 255)  # #5b8cff
PLATE = (232, 234, 240, 255)  # #e8eaf0
CLEAR = (0, 0, 0, 0)

SS = 3  # supersampling factor for smooth edges


def blend(dst, src):
    sa = src[3] / 255.0
    if sa == 0:
        return dst
    if sa == 1:
        return src
    da = dst[3] / 255.0
    out_a = sa + da * (1 - sa)
    if out_a == 0:
        return CLEAR
    r = (src[0] * sa + dst[0] * da * (1 - sa)) / out_a
    g = (src[1] * sa + dst[1] * da * (1 - sa)) / out_a
    b = (src[2] * sa + dst[2] * da * (1 - sa)) / out_a
    return (int(round(r)), int(round(g)), int(round(b)), int(round(out_a * 255)))


class Canvas:
    def __init__(self, size):
        self.n = size
        self.px = [CLEAR] * (size * size)

    def set(self, x, y, color):
        if 0 <= x < self.n and 0 <= y < self.n:
            i = y * self.n + x
            self.px[i] = blend(self.px[i], color)

    def rrect(self, x0, y0, x1, y1, radius, color):
        r = radius
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                # rounded-corner test
                cx = min(max(x, x0 + r), x1 - r)
                cy = min(max(y, y0 + r), y1 - r)
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.set(x, y, color)

    def downsample(self, factor):
        n = self.n // factor
        out = [CLEAR] * (n * n)
        f2 = factor * factor
        for y in range(n):
            for x in range(n):
                r = g = b = a = 0
                for dy in range(factor):
                    for dx in range(factor):
                        p = self.px[(y * factor + dy) * self.n + (x * factor + dx)]
                        r += p[0]; g += p[1]; b += p[2]; a += p[3]
                out[y * n + x] = (r // f2, g // f2, b // f2, a // f2)
        c = Canvas(n)
        c.px = out
        return c

    def to_png(self):
        n = self.n
        raw = bytearray()
        for y in range(n):
            raw.append(0)  # filter: none
            for x in range(n):
                raw.extend(self.px[y * n + x])
        return _png_bytes(n, n, bytes(raw))


def _chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))


def _png_bytes(w, h, raw):
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    return sig + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def draw_barbell(size, rounded=True):
    S = size * SS
    c = Canvas(S)
    if rounded:
        c.rrect(0, 0, S - 1, S - 1, S * 0.22, BG)
    else:
        c.rrect(0, 0, S - 1, S - 1, 0, BG)

    cx = cy = S / 2
    bar_h, bar_w = S * 0.085, S * 0.62
    c.rrect(cx - bar_w / 2, cy - bar_h / 2, cx + bar_w / 2, cy + bar_h / 2, bar_h / 2, ACCENT)

    for off, ph_ratio, col in [(0.30, 0.34, PLATE), (0.40, 0.24, ACCENT)]:
        ph, pw = S * ph_ratio, S * 0.075
        for sign in (-1, 1):
            x = cx + sign * S * off
            c.rrect(x - pw / 2, cy - ph / 2, x + pw / 2, cy + ph / 2, pw * 0.4, col)

    cap_h, cap_w = S * 0.12, S * 0.05
    for sign in (-1, 1):
        x = cx + sign * S * 0.47
        c.rrect(x - cap_w / 2, cy - cap_h / 2, x + cap_w / 2, cy + cap_h / 2, cap_w * 0.4, PLATE)

    return c.downsample(SS)


def main():
    os.makedirs(ICONS, exist_ok=True)
    targets = [
        ("icon-192.png", 192, True),
        ("icon-512.png", 512, True),
        ("icon-maskable-512.png", 512, False),
        ("favicon-32.png", 32, True),
    ]
    for fname, size, rounded in targets:
        png = draw_barbell(size, rounded=rounded).to_png()
        with open(os.path.join(ICONS, fname), "wb") as fh:
            fh.write(png)
        print(f"wrote {fname} ({size}x{size}, {len(png)} bytes)")


if __name__ == "__main__":
    main()
