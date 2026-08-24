"""兼容当前沙箱的 pytest 本地临时目录替代方案。

默认 tmp_path 使用 tempfile.mkdtemp，在当前 Windows 沙箱下创建的目录无法被同进程再次
访问。本 fixture 改用 os.mkdir 在项目内创建可写临时目录，并把清理失败视为可接受的沙箱
限制而不中断测试。
"""

import shutil
import uuid
from pathlib import Path

import pytest


@pytest.fixture
def tmp_path() -> Path:
    """提供函数级可写临时目录，使用 os.mkdir 避免 tempfile 的权限问题。"""
    base = Path(__file__).parent.parent / "tmp"
    base.mkdir(parents=True, exist_ok=True)
    path = base / f"pytest-{uuid.uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)
