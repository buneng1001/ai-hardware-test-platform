"""扫描验收目录中的 HTML、ZIP、SQLite 和日志，拒绝密钥及内部资产标识。"""

import argparse
import re
import sqlite3
import sys
import zipfile
from pathlib import Path


SECRET_PATTERNS = (
    re.compile(rb"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(rb"SILICONFLOW_API_KEY\s*=\s*[^\s#]+"),
    re.compile(rb"Authorization\s*:\s*Bearer\s+[^\s]+", re.IGNORECASE),
    re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
)
ASSET_MARKERS = ("原公司".encode(), b"internal-company-asset", b"proprietary-device")


def scan_bytes(label: str, content: bytes) -> list[str]:
    findings = []
    for pattern in SECRET_PATTERNS:
        if pattern.search(content):
            findings.append(f"{label}: 命中敏感字段模式 {pattern.pattern!r}")
    for marker in ASSET_MARKERS:
        if marker in content:
            findings.append(f"{label}: 命中公司资产标识 {marker!r}")
    return findings


def scan_path(path: Path) -> list[str]:
    if path.suffix.lower() == ".zip":
        try:
            with zipfile.ZipFile(path) as archive:
                findings = scan_bytes(str(path), "\n".join(archive.namelist()).encode())
                for name in archive.namelist():
                    findings.extend(scan_bytes(f"{path}!{name}", archive.read(name)))
                return findings
        except (OSError, zipfile.BadZipFile) as error:
            return [f"{path}: 无法读取 ZIP：{error}"]
    if path.suffix.lower() in {".db", ".sqlite", ".sqlite3"}:
        try:
            with sqlite3.connect(path) as connection:
                rows = connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
                content = "\n".join(str(row) for row in rows).encode()
                for (table,) in rows:
                    for row in connection.execute(f'SELECT * FROM "{table}"'):
                        content += repr(row).encode("utf-8", errors="replace")
                return scan_bytes(str(path), content)
        except (OSError, sqlite3.Error) as error:
            return [f"{path}: 无法读取 SQLite：{error}"]
    try:
        return scan_bytes(str(path), path.read_bytes())
    except OSError as error:
        return [f"{path}: 无法读取文件：{error}"]


def main() -> int:
    parser = argparse.ArgumentParser(description="扫描验收产物安全边界")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    files = (
        [args.path]
        if args.path.is_file()
        else [item for item in args.path.rglob("*") if item.is_file()]
    )
    findings = [finding for path in files for finding in scan_path(path)]
    if findings:
        print("\n".join(findings), file=sys.stderr)
        return 1
    print(f"安全扫描通过：已检查 {len(files)} 个产物。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
