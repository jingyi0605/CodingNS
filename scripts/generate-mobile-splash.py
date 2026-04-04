#!/usr/bin/env python3
"""根据项目图标生成移动端深色科技感启动图。"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


@dataclass(frozen=True)
class Variant:
    """单个启动图规格。"""

    filename: str
    width: int
    height: int
    platform: str
    orientation: str


VARIANTS = (
    Variant("ios-splash-portrait-dark.png", 1290, 2796, "ios", "portrait"),
    Variant("ios-splash-landscape-dark.png", 2796, 1290, "ios", "landscape"),
    Variant("android-splash-portrait-dark.png", 1440, 3200, "android", "portrait"),
    Variant("android-splash-landscape-dark.png", 3200, 1440, "android", "landscape"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成 iOS / Android 启动图")
    parser.add_argument(
        "--icon",
        default="/Users/jackson/Code/CodingNS/apps/desktop/src-tauri/icons/icon.ico",
        help="源图标路径，默认使用桌面端 ico",
    )
    parser.add_argument(
        "--output-dir",
        default="/Users/jackson/Code/CodingNS/apps/user-app/src-tauri/mobile-splash",
        help="输出目录",
    )
    return parser.parse_args()


def hex_to_rgba(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4)) + (alpha,)


def mix(a: tuple[int, int, int], b: tuple[int, int, int], ratio: float) -> tuple[int, int, int]:
    ratio = max(0.0, min(1.0, ratio))
    return tuple(round(a[index] * (1 - ratio) + b[index] * ratio) for index in range(3))


def point_on_hexagon(center: tuple[float, float], radius: float, index: int, rotation: float) -> tuple[float, float]:
    angle = math.radians(rotation + index * 60 - 30)
    return center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle)


def build_hexagon(center: tuple[float, float], radius: float, rotation: float = 0) -> list[tuple[float, float]]:
    return [point_on_hexagon(center, radius, index, rotation) for index in range(6)]


def add_vertical_gradient(
    canvas: Image.Image,
    top_color: tuple[int, int, int],
    bottom_color: tuple[int, int, int],
) -> None:
    draw = ImageDraw.Draw(canvas)
    width, height = canvas.size
    for y in range(height):
        ratio = y / max(1, height - 1)
        draw.line((0, y, width, y), fill=mix(top_color, bottom_color, ratio) + (255,))


def add_linear_glow(
    canvas: Image.Image,
    bbox: tuple[int, int, int, int],
    color: tuple[int, int, int],
    blur_radius: int,
    alpha: int,
) -> None:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.ellipse(bbox, fill=color + (alpha,))
    overlay = overlay.filter(ImageFilter.GaussianBlur(blur_radius))
    canvas.alpha_composite(overlay)


def add_background_grid(
    canvas: Image.Image,
    cell_size: int,
    color: tuple[int, int, int],
    alpha: int,
) -> None:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = canvas.size
    for x in range(0, width, cell_size):
        draw.line((x, 0, x, height), fill=color + (alpha,), width=1)
    for y in range(0, height, cell_size):
        draw.line((0, y, width, y), fill=color + (alpha,), width=1)
    overlay = overlay.filter(ImageFilter.GaussianBlur(0.4))
    canvas.alpha_composite(overlay)


def add_diagonal_scanlines(
    canvas: Image.Image,
    spacing: int,
    color: tuple[int, int, int],
    alpha: int,
) -> None:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = canvas.size
    start = -height
    while start < width:
        draw.line((start, 0, start + height, height), fill=color + (alpha,), width=2)
        start += spacing
    overlay = overlay.filter(ImageFilter.GaussianBlur(1.6))
    canvas.alpha_composite(overlay)


def add_hexagon_glow(
    canvas: Image.Image,
    center: tuple[int, int],
    radius: int,
    accent: tuple[int, int, int],
    secondary: tuple[int, int, int],
) -> None:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    outer = build_hexagon(center, radius * 1.08, rotation=0)
    inner = build_hexagon(center, radius * 0.92, rotation=0)
    mid = build_hexagon(center, radius * 0.72, rotation=30)

    draw.line(outer + [outer[0]], fill=accent + (210,), width=max(4, radius // 36), joint="curve")
    draw.line(inner + [inner[0]], fill=secondary + (150,), width=max(2, radius // 48), joint="curve")
    draw.line(mid + [mid[0]], fill=accent + (70,), width=max(2, radius // 56), joint="curve")

    for index, point in enumerate(outer):
        other = outer[(index + 2) % len(outer)]
        draw.line((point, other), fill=accent + (30,), width=max(1, radius // 80))

    overlay = overlay.filter(ImageFilter.GaussianBlur(max(8, radius // 20)))
    canvas.alpha_composite(overlay)

    crisp = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    crisp_draw = ImageDraw.Draw(crisp)
    crisp_draw.line(outer + [outer[0]], fill=accent + (180,), width=max(3, radius // 42), joint="curve")
    crisp_draw.line(inner + [inner[0]], fill=secondary + (110,), width=max(2, radius // 60), joint="curve")
    canvas.alpha_composite(crisp)


def add_circuit_traces(
    canvas: Image.Image,
    center: tuple[int, int],
    radius: int,
    accent: tuple[int, int, int],
    orientation: str,
) -> None:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = canvas.size
    left, right = int(center[0] - radius * 1.3), int(center[0] + radius * 1.3)
    top, bottom = int(center[1] - radius * 1.3), int(center[1] + radius * 1.3)
    line_width = max(3, radius // 70)

    anchors = [
        ((left, center[1]), (int(width * 0.08), center[1])),
        ((right, center[1]), (int(width * 0.92), center[1])),
        ((center[0], top), (center[0], int(height * 0.08))),
        ((center[0], bottom), (center[0], int(height * 0.92))),
    ]
    if orientation == "landscape":
        anchors.extend(
            [
                ((right, int(center[1] - radius * 0.46)), (int(width * 0.88), int(height * 0.2))),
                ((right, int(center[1] + radius * 0.46)), (int(width * 0.88), int(height * 0.8))),
            ]
        )
    else:
        anchors.extend(
            [
                ((int(center[0] - radius * 0.46), bottom), (int(width * 0.22), int(height * 0.88))),
                ((int(center[0] + radius * 0.46), bottom), (int(width * 0.78), int(height * 0.88))),
            ]
        )

    for start, end in anchors:
        mid_x = int((start[0] + end[0]) / 2)
        path = [start, (mid_x, start[1]), (mid_x, end[1]), end]
        draw.line(path, fill=accent + (90,), width=line_width)
        for point in (start, end):
            size = max(8, radius // 18)
            draw.ellipse(
                (point[0] - size, point[1] - size, point[0] + size, point[1] + size),
                fill=accent + (125,),
            )

    overlay = overlay.filter(ImageFilter.GaussianBlur(max(4, radius // 60)))
    canvas.alpha_composite(overlay)


def add_panel_shapes(
    canvas: Image.Image,
    center: tuple[int, int],
    accent: tuple[int, int, int],
    secondary: tuple[int, int, int],
    orientation: str,
) -> None:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = canvas.size

    if orientation == "portrait":
        panels = [
            (
                int(width * 0.08),
                int(height * 0.15),
                int(width * 0.92),
                int(height * 0.28),
                accent + (22,),
                secondary + (70,),
            ),
            (
                int(width * 0.16),
                int(height * 0.73),
                int(width * 0.84),
                int(height * 0.84),
                secondary + (18,),
                accent + (60,),
            ),
        ]
    else:
        panels = [
            (
                int(width * 0.48),
                int(height * 0.14),
                int(width * 0.9),
                int(height * 0.36),
                accent + (20,),
                secondary + (68,),
            ),
            (
                int(width * 0.52),
                int(height * 0.56),
                int(width * 0.9),
                int(height * 0.82),
                secondary + (16,),
                accent + (54,),
            ),
        ]

    radius = max(18, min(width, height) // 24)
    for x1, y1, x2, y2, fill_color, stroke_color in panels:
        draw.rounded_rectangle((x1, y1, x2, y2), radius=radius, fill=fill_color, outline=stroke_color, width=2)

    for index in range(5):
        cx = int(width * (0.18 + index * 0.16))
        cy = int(height * 0.12)
        dot = max(5, min(width, height) // 120)
        draw.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill=accent + (120,))

    overlay = overlay.filter(ImageFilter.GaussianBlur(0.8))
    canvas.alpha_composite(overlay)


def resize_icon(icon: Image.Image, size: int) -> Image.Image:
    return icon.resize((size, size), Image.Resampling.LANCZOS)


def add_icon_with_glow(
    canvas: Image.Image,
    icon: Image.Image,
    center: tuple[int, int],
    size: int,
    accent: tuple[int, int, int],
) -> None:
    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    mask = Image.new("L", canvas.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    radius = int(size * 0.78)
    mask_draw.ellipse((center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius), fill=220)
    glow.paste(accent + (180,), (0, 0), mask.filter(ImageFilter.GaussianBlur(radius // 3)))
    canvas.alpha_composite(glow)

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_mask = Image.new("L", canvas.size, 0)
    shadow_draw = ImageDraw.Draw(shadow_mask)
    shadow_radius = int(size * 0.56)
    shadow_draw.ellipse(
        (
            center[0] - shadow_radius,
            center[1] - shadow_radius + size // 7,
            center[0] + shadow_radius,
            center[1] + shadow_radius + size // 7,
        ),
        fill=180,
    )
    shadow.paste((0, 0, 0, 150), (0, 0), shadow_mask.filter(ImageFilter.GaussianBlur(size // 6)))
    canvas.alpha_composite(shadow)

    icon_image = resize_icon(icon, size)
    x = center[0] - size // 2
    y = center[1] - size // 2
    canvas.alpha_composite(icon_image, (x, y))


def add_light_particles(
    canvas: Image.Image,
    center: tuple[int, int],
    radius: int,
    accent: tuple[int, int, int],
    secondary: tuple[int, int, int],
) -> None:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = canvas.size
    particles = [
        (center[0] - radius * 0.94, center[1] - radius * 0.82, accent, 0.05),
        (center[0] + radius * 0.88, center[1] - radius * 0.55, secondary, 0.07),
        (center[0] + radius * 0.52, center[1] + radius * 0.88, accent, 0.06),
        (center[0] - radius * 0.5, center[1] + radius * 0.98, secondary, 0.08),
        (width * 0.18, height * 0.18, secondary, 0.04),
        (width * 0.84, height * 0.76, accent, 0.05),
    ]
    for x, y, color, ratio in particles:
        size = max(8, int(min(width, height) * ratio))
        draw.ellipse((x - size, y - size, x + size, y + size), fill=color + (180,))
    overlay = overlay.filter(ImageFilter.GaussianBlur(max(4, radius // 70)))
    canvas.alpha_composite(overlay)


def add_center_beam(
    canvas: Image.Image,
    center: tuple[int, int],
    accent: tuple[int, int, int],
    secondary: tuple[int, int, int],
    orientation: str,
) -> None:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = canvas.size
    if orientation == "portrait":
        beam_box = (
            int(width * 0.08),
            center[1] - int(height * 0.035),
            int(width * 0.92),
            center[1] + int(height * 0.035),
        )
    else:
        beam_box = (
            center[0] - int(width * 0.06),
            int(height * 0.08),
            center[0] + int(width * 0.06),
            int(height * 0.92),
        )
    draw.rounded_rectangle(beam_box, radius=max(20, min(width, height) // 30), fill=accent + (55,))
    overlay = overlay.filter(ImageFilter.GaussianBlur(max(14, min(width, height) // 18)))
    canvas.alpha_composite(overlay)

    crisp = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    crisp_draw = ImageDraw.Draw(crisp)
    if orientation == "portrait":
        y = center[1]
        crisp_draw.line((int(width * 0.14), y, int(width * 0.86), y), fill=secondary + (110,), width=max(2, height // 420))
    else:
        x = center[0]
        crisp_draw.line((x, int(height * 0.14), x, int(height * 0.86)), fill=secondary + (110,), width=max(2, width // 700))
    crisp = crisp.filter(ImageFilter.GaussianBlur(2))
    canvas.alpha_composite(crisp)


def add_texture(canvas: Image.Image, accent: tuple[int, int, int]) -> None:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    width, height = canvas.size
    pixels = overlay.load()
    step_x = max(12, width // 150)
    step_y = max(12, height // 150)
    for y in range(0, height, step_y):
        for x in range(0, width, step_x):
            ratio = ((x * 17 + y * 31) % 100) / 100
            alpha = 8 if ratio > 0.82 else 0
            if alpha:
                pixels[x, y] = accent + (alpha,)
    overlay = overlay.filter(ImageFilter.GaussianBlur(1.2))
    canvas.alpha_composite(overlay)


def build_variant(icon: Image.Image, variant: Variant) -> Image.Image:
    if variant.platform == "ios":
        top = hex_to_rgba("#06101E")[:3]
        bottom = hex_to_rgba("#010409")[:3]
        accent = hex_to_rgba("#16B7FF")[:3]
        secondary = hex_to_rgba("#6A73FF")[:3]
    else:
        top = hex_to_rgba("#041218")[:3]
        bottom = hex_to_rgba("#01060B")[:3]
        accent = hex_to_rgba("#11E3D2")[:3]
        secondary = hex_to_rgba("#1E8CFF")[:3]

    canvas = Image.new("RGBA", (variant.width, variant.height), (0, 0, 0, 255))
    add_vertical_gradient(canvas, top, bottom)
    add_linear_glow(
        canvas,
        (
            int(variant.width * -0.05),
            int(variant.height * -0.1),
            int(variant.width * 0.55),
            int(variant.height * 0.45),
        ),
        accent,
        blur_radius=max(60, min(variant.width, variant.height) // 8),
        alpha=68,
    )
    add_linear_glow(
        canvas,
        (
            int(variant.width * 0.4),
            int(variant.height * 0.5),
            int(variant.width * 1.05),
            int(variant.height * 1.05),
        ),
        secondary,
        blur_radius=max(70, min(variant.width, variant.height) // 7),
        alpha=56,
    )

    add_background_grid(canvas, cell_size=max(56, min(variant.width, variant.height) // 12), color=accent, alpha=18)
    add_diagonal_scanlines(canvas, spacing=max(120, min(variant.width, variant.height) // 4), color=secondary, alpha=12)
    add_texture(canvas, accent)

    center = (
        int(variant.width * 0.5) if variant.orientation == "portrait" else int(variant.width * 0.36),
        int(variant.height * 0.43) if variant.orientation == "portrait" else int(variant.height * 0.5),
    )
    icon_size = int(min(variant.width, variant.height) * (0.36 if variant.orientation == "portrait" else 0.42))
    ring_radius = int(icon_size * 0.92)

    add_center_beam(canvas, center, accent, secondary, variant.orientation)
    add_panel_shapes(canvas, center, accent, secondary, variant.orientation)
    add_hexagon_glow(canvas, center, ring_radius, accent, secondary)
    add_circuit_traces(canvas, center, ring_radius, accent, variant.orientation)
    add_light_particles(canvas, center, ring_radius, accent, secondary)
    add_icon_with_glow(canvas, icon, center, icon_size, accent)

    vignette = Image.new("L", canvas.size, 0)
    vignette_draw = ImageDraw.Draw(vignette)
    vignette_draw.ellipse(
        (
            int(variant.width * -0.12),
            int(variant.height * -0.1),
            int(variant.width * 1.12),
            int(variant.height * 1.1),
        ),
        fill=255,
    )
    vignette = ImageChops.invert(vignette).filter(ImageFilter.GaussianBlur(max(60, min(variant.width, variant.height) // 8)))
    dark_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 84))
    canvas.paste(dark_layer, (0, 0), vignette)
    return canvas


def save_outputs(icon_path: Path, output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    icon = Image.open(icon_path).convert("RGBA")
    results: list[Path] = []
    for variant in VARIANTS:
        image = build_variant(icon, variant)
        target = output_dir / variant.filename
        image.save(target, "PNG", optimize=True)
        results.append(target)
    return results


def export_ios_launch_assets(output_dir: Path) -> list[Path]:
    asset_dir = Path("/Users/jackson/Code/CodingNS/apps/user-app/src-tauri/gen/apple/Assets.xcassets/LaunchSplash.imageset")
    asset_dir.mkdir(parents=True, exist_ok=True)

    portrait = Image.open(output_dir / "ios-splash-portrait-dark.png").convert("RGBA")
    landscape = Image.open(output_dir / "ios-splash-landscape-dark.png").convert("RGBA")

    exported = []
    def flatten_to_jpg(image: Image.Image) -> Image.Image:
        background = Image.new("RGB", image.size, hex_to_rgba("#020814")[:3])
        background.paste(image, mask=image.getchannel("A"))
        return background

    targets = [
        ("launch-splash-portrait@3x.jpg", flatten_to_jpg(portrait)),
        ("launch-splash-portrait@2x.jpg", flatten_to_jpg(portrait.resize((860, 1864), Image.Resampling.LANCZOS))),
        ("launch-splash-landscape@3x.jpg", flatten_to_jpg(landscape)),
        ("launch-splash-landscape@2x.jpg", flatten_to_jpg(landscape.resize((1864, 860), Image.Resampling.LANCZOS))),
    ]

    for filename, image in targets:
        target = asset_dir / filename
        image.save(target, "JPEG", quality=94, optimize=True)
        exported.append(target)

    contents = {
        "images": [
            {
                "filename": "launch-splash-portrait@2x.jpg",
                "idiom": "universal",
                "scale": "2x",
            },
            {
                "filename": "launch-splash-portrait@3x.jpg",
                "idiom": "universal",
                "scale": "3x",
            },
            {
                "filename": "launch-splash-portrait@2x.jpg",
                "idiom": "universal",
                "scale": "2x",
                "width-class": "any",
                "height-class": "regular",
            },
            {
                "filename": "launch-splash-portrait@3x.jpg",
                "idiom": "universal",
                "scale": "3x",
                "width-class": "any",
                "height-class": "regular",
            },
            {
                "filename": "launch-splash-landscape@2x.jpg",
                "idiom": "universal",
                "scale": "2x",
                "width-class": "any",
                "height-class": "compact",
            },
            {
                "filename": "launch-splash-landscape@3x.jpg",
                "idiom": "universal",
                "scale": "3x",
                "width-class": "any",
                "height-class": "compact",
            },
        ],
        "info": {"author": "xcode", "version": 1},
    }
    contents_path = asset_dir / "Contents.json"
    contents_path.write_text(json.dumps(contents, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    exported.append(contents_path)
    return exported


def export_android_launch_assets(output_dir: Path) -> list[Path]:
    drawable_dir = Path("/Users/jackson/Code/CodingNS/apps/user-app/src-tauri/gen/android/app/src/main/res/drawable-nodpi")
    drawable_dir.mkdir(parents=True, exist_ok=True)

    exported = []
    mappings = [
        ("android-splash-portrait-dark.png", "splash_screen_portrait.png"),
        ("android-splash-landscape-dark.png", "splash_screen_landscape.png"),
    ]
    for src_name, target_name in mappings:
        image = Image.open(output_dir / src_name).convert("RGBA")
        target = drawable_dir / target_name
        image.save(target, "PNG", optimize=True)
        exported.append(target)
    return exported


def main() -> None:
    args = parse_args()
    icon_path = Path(args.icon).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not icon_path.exists():
        raise FileNotFoundError(f"找不到源图标: {icon_path}")

    results = save_outputs(icon_path, output_dir)
    results.extend(export_ios_launch_assets(output_dir))
    results.extend(export_android_launch_assets(output_dir))
    for result in results:
        print(result)


if __name__ == "__main__":
    main()
