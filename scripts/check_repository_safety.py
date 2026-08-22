import re
import subprocess
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SENSITIVE_FILE_NAMES = {".env", "id_rsa", "id_ed25519"}
SENSITIVE_SUFFIXES = {".key", ".p12", ".pfx", ".pem"}
SECRET_PATTERNS = {
    "OpenAI 风格密钥": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "非空硅基流动密钥": re.compile(r"(?m)^SILICONFLOW_API_KEY[ \t]*=[ \t]*[^\s#]+"),
    "私钥正文": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
}


def tracked_files() -> list[Path]:
    """只扫描 Git 将提交的文件，避免依赖缓存造成误报。"""
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return [REPOSITORY_ROOT / line for line in result.stdout.splitlines() if line]


def find_violations(paths: list[Path]) -> list[str]:
    violations: list[str] = []
    for path in paths:
        relative_path = path.relative_to(REPOSITORY_ROOT).as_posix()
        if (
            path.name in SENSITIVE_FILE_NAMES
            or path.suffix.lower() in SENSITIVE_SUFFIXES
        ):
            violations.append(f"禁止提交敏感文件: {relative_path}")
            continue

        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(content):
                violations.append(f"疑似{label}: {relative_path}")

    return violations


def main() -> int:
    try:
        violations = find_violations(tracked_files())
    except (OSError, subprocess.SubprocessError) as error:
        print(f"安全扫描环境错误: {error}", file=sys.stderr)
        return 2

    if violations:
        print("\n".join(violations), file=sys.stderr)
        return 1

    print("安全扫描通过：未发现常见密钥形态或高风险文件。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
