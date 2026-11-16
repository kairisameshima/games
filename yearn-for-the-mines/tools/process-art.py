"""Turn raw Codex images (art/raw) into true low-resolution pixel art (src/assets).

Codex paints "pixel art" at high resolution with uneven pseudo-pixels. Each asset is box-downscaled
to its game resolution and snapped to a small palette, so it renders crisp at integer zoom.

Usage:
  python3 tools/process-art.py backdrop <name> <width>             opaque, full frame
  python3 tools/process-art.py cutout <name> <width>               transparent, cropped to content
  python3 tools/process-art.py gallery <name> <width>              cutout plus <name>.json with the
                                                                   floor row and the dig face column
  python3 tools/process-art.py sheet <name> <rows> <cols> <height> transparent grid of frames; the
                                                                   tallest frame becomes <height> px
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
# Share of a row that must be opaque to count as gallery floor planks.
FLOOR_COVERAGE = 0.95
# Rows above the floor checked for the dig face, roughly a kid's body height.
KID_BODY_ROWS = 12


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


def scaled_height(image: Image.Image, width: int) -> int:
    return max(1, round(image.height * width / image.width))


def backdrop(name: str, width: int) -> None:
    image = Image.open(RAW_DIRECTORY / f"{name}.png").convert("RGBA")
    pixelate(image, width, scaled_height(image, width)).save(OUTPUT_DIRECTORY / f"{name}.png")


def cutout(name: str, width: int) -> None:
    image = load_with_alpha(name)
    cropped = image.crop(opaque_box(image))
    pixelate(cropped, width, scaled_height(cropped, width)).save(OUTPUT_DIRECTORY / f"{name}.png")


def widest_run_start(row: np.ndarray, from_x: int) -> int:
    best_start, best_length, start = from_x, 0, None
    for x in range(from_x, row.shape[0] + 1):
        opaque = x < row.shape[0] and row[x]
        if opaque and start is None:
            start = x
        elif not opaque and start is not None:
            if x - start > best_length:
                best_start, best_length = start, x - start
            start = None
    return best_start


def gallery(name: str, width: int) -> None:
    cutout(name, width)
    alpha = np.asarray(Image.open(OUTPUT_DIRECTORY / f"{name}.png"))[..., 3] > 0
    coverage = alpha.mean(axis=1)
    # The plank floor is the thickest band of fully covered rows. Truss beams below it are thinner.
    bands: list[tuple[int, int]] = []
    for y in np.nonzero(coverage >= FLOOR_COVERAGE)[0]:
        if bands and bands[-1][1] == y:
            bands[-1] = (bands[-1][0], y + 1)
        else:
            bands.append((int(y), int(y) + 1))
    floor_y = max(bands, key=lambda band: band[1] - band[0])[0]
    # The dig face is the widest opaque block in the right half of the rows where a kid stands.
    face_x = min(widest_run_start(alpha[y], alpha.shape[1] // 2) for y in range(floor_y - KID_BODY_ROWS, floor_y))
    (OUTPUT_DIRECTORY / f"{name}.json").write_text(json.dumps({"floorY": floor_y, "faceX": face_x}) + "\n")


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


def sheet(name: str, rows: int, columns: int, target_height: int) -> None:
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
        # Bottom-center every frame so feet and crate bottoms share one baseline.
        x = column * cell_width + (cell_width - frame.width) // 2
        y = row * cell_height + cell_height - FRAME_PADDING - frame.height
        packed.paste(frame, (x, y), frame)
    packed.save(OUTPUT_DIRECTORY / f"{name}.png")
    layout = {"rows": rows, "columns": columns, "cellWidth": cell_width, "cellHeight": cell_height}
    (OUTPUT_DIRECTORY / f"{name}.json").write_text(json.dumps(layout) + "\n")


def main() -> None:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    mode, name, *numbers = sys.argv[1:]
    sizes = [int(number) for number in numbers]
    if mode == "backdrop":
        backdrop(name, *sizes)
    elif mode == "cutout":
        cutout(name, *sizes)
    elif mode == "gallery":
        gallery(name, *sizes)
    elif mode == "sheet":
        sheet(name, *sizes)
    else:
        raise SystemExit(f"unknown mode {mode}; use backdrop, cutout, gallery or sheet")
    print(f"processed {name}")


if __name__ == "__main__":
    main()
