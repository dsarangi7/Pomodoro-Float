"""Generate the Pomodoro Float app and tray icons."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

S = 4  # supersampling factor
CANVAS = 512
W = CANVAS * S


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    grad = Image.new("RGB", (1, h))
    px = grad.load()
    for y in range(h):
        t = y / max(1, h - 1)
        # ease for a softer highlight near the top
        t = t**0.82
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return grad.resize((w, h), Image.Resampling.BILINEAR)


def ellipse(draw: ImageDraw.ImageDraw, box, fill):
    draw.ellipse(tuple(v * S for v in box), fill=fill)


def polygon(draw: ImageDraw.ImageDraw, points, fill):
    draw.polygon([(x * S, y * S) for x, y in points], fill=fill)


# Canvas at design scale (512) then multiplied for anti-aliasing.
canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))

# Coral rounded-square background.
bg = vertical_gradient((W, W), (255, 126, 100), (216, 60, 48)).convert("RGBA")
mask = rounded_mask(W, radius=118 * S)
canvas.alpha_composite(Image.composite(bg, Image.new("RGBA", (W, W), (0, 0, 0, 0)), mask))

d = ImageDraw.Draw(canvas)

# Soft top-left sheen.
sheen = Image.new("RGBA", (W, W), (0, 0, 0, 0))
sd = ImageDraw.Draw(sheen)
sd.ellipse((-220 * S, -280 * S, 420 * S, 260 * S), fill=(255, 255, 255, 38))
sheen = sheen.filter(ImageFilter.GaussianBlur(34 * S))
canvas.alpha_composite(Image.composite(sheen, Image.new("RGBA", (W, W), (0, 0, 0, 0)), mask))

cream = (255, 244, 230, 255)
leaf = (98, 190, 139, 255)
ink = (99, 37, 31, 255)

# Tomato body: a slightly squat circle.
ellipse(d, (136, 174, 376, 410), cream)

# A soft shadow under the tomato body for depth.
shadow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
shd = ImageDraw.Draw(shadow)
shd.ellipse((142 * S, 348 * S, 372 * S, 426 * S), fill=(124, 31, 25, 70))
shadow = shadow.filter(ImageFilter.GaussianBlur(12 * S))
canvas.alpha_composite(shadow)
# Repaint body above shadow.
ellipse(d, (136, 174, 376, 410), cream)

# Calyx: five pointed leaves.
polygon(
    d,
    [
        (256, 178),
        (286, 146),
        (294, 182),
        (330, 166),
        (314, 200),
        (352, 204),
        (310, 225),
        (256, 208),
        (202, 225),
        (160, 204),
        (198, 200),
        (182, 166),
        (218, 182),
    ],
    leaf,
)
# Stem.
polygon(d, [(246, 174), (266, 174), (272, 128), (260, 122)], (67, 148, 102, 255))
# Tiny leaf highlight.
polygon(d, [(256, 180), (280, 154), (290, 174), (274, 193)], (129, 215, 166, 255))

# Clock hands cut from the tomato: quarter-to ring, 25-minute nod.
ring_box = (198, 236, 314, 352)
d.arc(
    tuple(v * S for v in ring_box),
    start=-90,
    end=226,
    fill=ink,
    width=15 * S,
)
# Center pin and hand.
ellipse(d, (247, 285, 265, 303), ink)
polygon(d, [(252, 260), (260, 260), (264, 292), (248, 292)], ink)
# Hand cap.
ellipse(d, (244, 288, 268, 312), ink)

# Downsample to the final icon.
icon = canvas.resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)
icon.save(ASSETS / "icon.png", optimize=True)

# Multi-size Windows icon. Transparent margins keep it optically balanced.
sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
ico_images = []
for size in sizes:
    pad = round(size * 0.06)
    inner = size - pad * 2
    resized = icon.resize((inner, inner), Image.Resampling.LANCZOS)
    frame = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    frame.alpha_composite(resized, (pad, pad))
    ico_images.append(frame)
ico_images[-1].save(
    ASSETS / "icon.ico",
    format="ICO",
    sizes=[(s, s) for s in sizes],
    append_images=ico_images[:-1],
)

# A small monochrome mark for in-app usage.
mark = icon.resize((128, 128), Image.Resampling.LANCZOS)
mark.save(ASSETS / "mark.png", optimize=True)

print(f"Wrote {ASSETS / 'icon.png'}, {ASSETS / 'icon.ico'}, {ASSETS / 'mark.png'}")
