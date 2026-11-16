"""Turn a raw Codex sprite sheet (art/raw) into true low-resolution pixel art (src/assets).

Codex paints "pixel art" at high resolution with uneven pseudo-pixels. Each frame is cut out,
box-downscaled to its game resolution and snapped to a small palette, so it stays crisp when the
game samples it with nearest-neighbour filtering.

Usage:
  python3 tools/process-art.py <name> <rows> <cols> <height>
Writes src/assets/<name>.png (a uniform grid of frames, the tallest frame <height> px) and <name>.json.
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

RAW_DIRECTORY = Path("art/raw")
OUTPUT_DIRECTORY = Path("src/assets")
PALETTE_SIZE = 64
OPAQUE_ALPHA_THRESHOLD = 128
# A raw image counts as already transparent when this share of its pixels is see-through.
TRANSPARENT_SHARE = 0.05
MAGENTA_KEY_DISTANCE = 120
MIN_FRAME_PIXELS = 300
FRAME_PADDING = 1


def load_with_alpha(name: str) -> Image.Image:
    image = Image.open(RAW_DIRECTORY / f"{name}.png").convert("RGBA")
    pixels = np.asarray(image).astype(np.int32)
    if (pixels[..., 3] < 250).mean() > TRANSPARENT_SHARE:
        return image
    red, green, blue = pixels[..., 0], pixels[..., 1], pixels[..., 2]
    distance = np.sqrt((255 - red) ** 2 + green**2 + (255 - blue) ** 2)
    magenta_dominant = (red > green + 60) & (blue > green + 60) & (np.abs(red - blue) < 70)
    pixels[..., 3] = np.where((distance < MAGENTA_KEY_DISTANCE) | magenta_dominant, 0, 255)
    return Image.fromarray(pixels.astype(np.uint8), "RGBA")


def opaque_box(image: Image.Image) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(np.asarray(image)[..., 3] >= OPAQUE_ALPHA_THRESHOLD)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def pixelate(image: Image.Image, width: int, height: int) -> Image.Image:
    """Box-average down to the art grid, then snap colors to a palette and alpha to on/off."""
    small = image.resize((width, height), Image.Resampling.BOX)
    alpha = np.asarray(small)[..., 3]
    palette_image = small.convert("RGB").quantize(PALETTE_SIZE, Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    rgba = np.asarray(palette_image.convert("RGBA")).copy()
    rgba[..., 3] = np.where(alpha >= OPAQUE_ALPHA_THRESHOLD, 255, 0)
    return Image.fromarray(rgba, "RGBA")


def band_cuts(alpha: np.ndarray, count: int, axis: int) -> list[tuple[int, int]]:
    """Split opaque pixels into `count` bands along `axis`, cutting at the emptiest line near each even split."""
    profile = (alpha >= OPAQUE_ALPHA_THRESHOLD).sum(axis=axis)
    band_size = profile.shape[0] / count
    cuts = [0]
    for index in range(1, count):
        center = int(index * band_size)
        window = int(band_size * 0.35)
        low, high = center - window, center + window
        cuts.append(low + int(np.argmin(profile[low:high])))
    cuts.append(profile.shape[0])
    return list(zip(cuts[:-1], cuts[1:]))


def main() -> None:
    name, rows, columns, target_height = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    image = load_with_alpha(name)
    alpha = np.asarray(image)[..., 3]
    frames: list[Image.Image] = []
    for top, bottom in band_cuts(alpha, rows, axis=1):
        for left, right in band_cuts(alpha[top:bottom], columns, axis=0):
            cell = image.crop((left, top, right, bottom))
            if (np.asarray(cell)[..., 3] >= OPAQUE_ALPHA_THRESHOLD).sum() < MIN_FRAME_PIXELS:
                raise SystemExit(f"{name}: empty frame at rows {top}-{bottom}, columns {left}-{right}")
            frames.append(cell.crop(opaque_box(cell)))

    # One shared scale keeps every frame at the same art-pixel size.
    scale = target_height / max(frame.height for frame in frames)
    small_frames = [
        pixelate(frame, max(1, round(frame.width * scale)), max(1, round(frame.height * scale))) for frame in frames
    ]
    cell_width = max(frame.width for frame in small_frames) + FRAME_PADDING * 2
    cell_height = max(frame.height for frame in small_frames) + FRAME_PADDING * 2
    packed = Image.new("RGBA", (cell_width * columns, cell_height * rows), (0, 0, 0, 0))
    for index, frame in enumerate(small_frames):
        row, column = divmod(index, columns)
        # Bottom-center every frame so feet share one baseline.
        x = column * cell_width + (cell_width - frame.width) // 2
        y = row * cell_height + cell_height - FRAME_PADDING - frame.height
        packed.paste(frame, (x, y), frame)
    packed.save(OUTPUT_DIRECTORY / f"{name}.png")
    layout = {"rows": rows, "columns": columns, "cellWidth": cell_width, "cellHeight": cell_height}
    (OUTPUT_DIRECTORY / f"{name}.json").write_text(json.dumps(layout) + "\n")
    print(f"processed {name}", layout)


if __name__ == "__main__":
    main()
