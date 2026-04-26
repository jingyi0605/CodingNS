#!/usr/bin/env python3
"""验证桌面端滚动条修复已经进入最终构建产物。"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import tarfile
from pathlib import Path

APP_BINARY_PATH = "CodingNS.app/Contents/MacOS/codingns-desktop"


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

    matched_files: list[Path] = []
    overlay_hits: list[Path] = []

    for css_file in css_files:
        content = css_file.read_text(encoding="utf-8")
        if stable_pattern.search(content):
            matched_files.append(css_file)
        if removed_overlay_pattern.search(content):
            overlay_hits.append(css_file)

    if not matched_files:
        raise SystemExit("构建后的 CSS 中未找到 `scrollbar-gutter: stable`，说明修复没有进入 dist。")

    if overlay_hits:
        joined = ", ".join(str(path) for path in overlay_hits)
        raise SystemExit(f"构建后的 CSS 仍然包含 `overflow: overlay` 相关规则：{joined}")

    print("已确认构建后的 CSS 包含稳定 gutter 修复：")
    for css_file in matched_files:
        print(f"  - {css_file} sha256={compute_sha256(css_file)}")


def resolve_expected_css_assets(dist_dir: Path) -> list[str]:
    index_html = dist_dir / "index.html"
    if not index_html.is_file():
        raise SystemExit(f"未找到构建入口文件：{index_html}")

    content = index_html.read_text(encoding="utf-8")
    matches = re.findall(r'href="/assets/([^"]+\.css)"', content)
    if not matches:
        raise SystemExit("dist/index.html 中未找到 CSS 资源引用。")

    return matches


def ensure_app_archive_present(app_archive: Path, expected_css_assets: list[str]) -> None:
    if not app_archive.is_file():
        raise SystemExit(f"未找到桌面 updater app 归档：{app_archive}")

    binary_content: bytes | None = None
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

        binary_content = binary_member.read()

    if binary_content is None:
        raise SystemExit("未能读取桌面二进制内容。")

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
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    css_files = load_css_files(args.dist_dir)
    ensure_scrollbar_fix_present(css_files)
    expected_css_assets = resolve_expected_css_assets(args.dist_dir)
    ensure_app_archive_present(args.app_archive, expected_css_assets)
    print("滚动条修复构建验证通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
