#!/usr/bin/env python3
"""验证桌面端滚动条修复已经进入最终构建产物。"""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

APP_BINARY_PATH = "CodingNS.app/Contents/MacOS/codingns-desktop"
DEFAULT_MIN_MACOS_SDK = "26.0"


def compute_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while True:
            chunk = file.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def load_css_files(dist_dir: Path) -> list[Path]:
    css_files = sorted((dist_dir / "assets").glob("*.css"))
    if not css_files:
        raise SystemExit(f"未找到 CSS 构建产物：{dist_dir / 'assets'}")
    return css_files


def ensure_scrollbar_fix_present(css_files: list[Path]) -> None:
    stable_pattern = re.compile(r"scrollbar-gutter\s*:\s*stable")
    removed_overlay_pattern = re.compile(r"overflow(?:-y)?\s*:\s*overlay")
    autohide_pattern = re.compile(r"data-scrollbar-autohide")
    transparent_track_pattern = re.compile(
        r"data-scrollbar-autohide[^\{]*::(?:-webkit-)?scrollbar-track\{[^}]*background\s*:\s*transparent",
        re.S,
    )
    transparent_thumb_pattern = re.compile(
        r"data-scrollbar-autohide[^\{]*::(?:-webkit-)?scrollbar-thumb\{[^}]*background\s*:\s*transparent",
        re.S,
    )
    scrolling_thumb_pattern = re.compile(
        r"data-scrollbar-autohide[^\{]*data-scrolling[^\{]*::(?:-webkit-)?scrollbar-thumb\{[^}]*background\s*:",
        re.S,
    )

    matched_files: list[Path] = []
    overlay_hits: list[Path] = []
    autohide_files: list[Path] = []
    transparent_track_files: list[Path] = []
    transparent_thumb_files: list[Path] = []
    scrolling_thumb_files: list[Path] = []

    for css_file in css_files:
        content = css_file.read_text(encoding="utf-8")
        if stable_pattern.search(content):
            matched_files.append(css_file)
        if removed_overlay_pattern.search(content):
            overlay_hits.append(css_file)
        if autohide_pattern.search(content):
            autohide_files.append(css_file)
        if transparent_track_pattern.search(content):
            transparent_track_files.append(css_file)
        if transparent_thumb_pattern.search(content):
            transparent_thumb_files.append(css_file)
        if scrolling_thumb_pattern.search(content):
            scrolling_thumb_files.append(css_file)

    if not matched_files:
        raise SystemExit("构建后的 CSS 中未找到 `scrollbar-gutter: stable`，说明修复没有进入 dist。")

    if overlay_hits:
        joined = ", ".join(str(path) for path in overlay_hits)
        raise SystemExit(f"构建后的 CSS 仍然包含 `overflow: overlay` 相关规则：{joined}")

    if not autohide_files:
        raise SystemExit("构建后的 CSS 中未找到 `data-scrollbar-autohide`，自动隐藏滚动条规则没有进入 dist。")

    if not transparent_track_files:
        raise SystemExit("构建后的 CSS 中未找到透明滚动条轨道规则。")

    if not transparent_thumb_files:
        raise SystemExit("构建后的 CSS 中未找到默认透明滚动条 thumb 规则。")

    if not scrolling_thumb_files:
        raise SystemExit("构建后的 CSS 中未找到滚动中才显示 thumb 的规则。")

    print("已确认构建后的 CSS 包含稳定 gutter 修复：")
    for css_file in matched_files:
        print(f"  - {css_file} sha256={compute_sha256(css_file)}")
    print("已确认构建后的 CSS 包含透明且自动隐藏的滚动条规则。")


def resolve_expected_css_assets(dist_dir: Path) -> list[str]:
    index_html = dist_dir / "index.html"
    if not index_html.is_file():
        raise SystemExit(f"未找到构建入口文件：{index_html}")

    content = index_html.read_text(encoding="utf-8")
    matches = re.findall(r'href="/assets/([^"]+\.css)"', content)
    if not matches:
        raise SystemExit("dist/index.html 中未找到 CSS 资源引用。")

    return matches


def parse_version(value: str) -> tuple[int, ...]:
    parts = tuple(int(part) for part in re.findall(r"\d+", value))
    return parts or (0,)


def is_version_ge(actual: str, minimum: str) -> bool:
    actual_parts = parse_version(actual)
    minimum_parts = parse_version(minimum)
    size = max(len(actual_parts), len(minimum_parts))
    actual_parts += (0,) * (size - len(actual_parts))
    minimum_parts += (0,) * (size - len(minimum_parts))
    return actual_parts >= minimum_parts


def read_macos_binary_sdks(binary_path: Path) -> list[str]:
    completed = subprocess.run(
        ["otool", "-l", str(binary_path)],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return re.findall(r"^\s*sdk\s+([0-9][0-9.]+)", completed.stdout, re.MULTILINE)


def ensure_binary_linked_sdk(binary_path: Path, minimum_sdk: str) -> None:
    sdks = read_macos_binary_sdks(binary_path)

    if not sdks:
        raise SystemExit(f"无法从桌面二进制读取链接 SDK：{binary_path}")

    failed = [sdk for sdk in sdks if not is_version_ge(sdk, minimum_sdk)]

    if failed:
        raise SystemExit(
            f"桌面二进制链接的 macOS SDK 版本过低：{', '.join(failed)} < {minimum_sdk}"
        )

    print(f"已确认桌面二进制链接 macOS SDK 符合要求：{', '.join(sdks)} >= {minimum_sdk}")


def ensure_app_archive_present(app_archive: Path, expected_css_assets: list[str], minimum_sdk: str) -> None:
    if not app_archive.is_file():
        raise SystemExit(f"未找到桌面 updater app 归档：{app_archive}")

    binary_content: bytes | None = None
    binary_bytes: bytes | None = None
    with tarfile.open(app_archive, "r:gz") as archive:
        members = archive.getnames()
        required_entries = {
            "CodingNS.app/Contents/Info.plist",
            APP_BINARY_PATH,
        }

        missing_entries = sorted(required_entries.difference(members))
        if missing_entries:
            joined = ", ".join(missing_entries)
            raise SystemExit(f"桌面 updater app 归档缺少关键文件：{joined}")

        binary_member = archive.extractfile(APP_BINARY_PATH)
        if binary_member is None:
            raise SystemExit("无法读取桌面二进制，无法确认 app 是否引用当前前端构建。")

        binary_bytes = binary_member.read()
        binary_content = binary_bytes

    if binary_content is None:
        raise SystemExit("未能读取桌面二进制内容。")

    if binary_bytes is None:
        raise SystemExit("未能读取桌面二进制内容，无法校验链接 SDK。")

    with tempfile.TemporaryDirectory(prefix="codingns-macos-binary-") as temp_dir:
        binary_path = Path(temp_dir) / "codingns-desktop"
        binary_path.write_bytes(binary_bytes)
        binary_path.chmod(0o755)
        ensure_binary_linked_sdk(binary_path, minimum_sdk)

    missing_css_assets = [
        asset_name for asset_name in expected_css_assets if asset_name.encode("utf-8") not in binary_content
    ]
    if missing_css_assets:
        joined = ", ".join(missing_css_assets)
        raise SystemExit(f"桌面 app 二进制未引用当前 dist 的 CSS 指纹：{joined}")

    print(f"已确认桌面 updater app 归档存在且结构完整：{app_archive}")
    print(f"  sha256={compute_sha256(app_archive)}")
    print("已确认桌面 app 二进制引用当前 dist 的 CSS 指纹：")
    for asset_name in expected_css_assets:
        print(f"  - {asset_name}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="验证桌面端滚动条修复构建产物")
    parser.add_argument("--dist-dir", type=Path, required=True, help="user-app dist 目录")
    parser.add_argument("--app-archive", type=Path, required=True, help="macOS updater app tar.gz 路径")
    parser.add_argument(
        "--min-macos-sdk",
        default=DEFAULT_MIN_MACOS_SDK,
        help=f"桌面二进制最低 macOS SDK 版本，默认 {DEFAULT_MIN_MACOS_SDK}",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    css_files = load_css_files(args.dist_dir)
    ensure_scrollbar_fix_present(css_files)
    expected_css_assets = resolve_expected_css_assets(args.dist_dir)
    ensure_app_archive_present(args.app_archive, expected_css_assets, args.min_macos_sdk)
    print("滚动条修复构建验证通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
