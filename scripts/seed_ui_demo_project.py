"""在独立验收数据库创建可重复使用的 UI 演示项目和版本。

只写入仓库 data/acceptance，绝不修改正式运行数据；再次运行不会产生重复项目。
本脚本不会伪造测试结果、执行记录或报告，后续页面在未导入数据时展示真实空状态。

用法：从仓库根目录执行
    backend\\.venv\\Scripts\\python.exe scripts\\seed_ui_demo_project.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACCEPTANCE_DATA = ROOT / "data" / "acceptance"
ACCEPTANCE_DATA.mkdir(parents=True, exist_ok=True)

# 明确固定到 UI 验收数据；覆盖当前 shell 的 APP_DATA_DIR，避免误写正式数据目录。
os.environ["APP_DATA_DIR"] = str(ACCEPTANCE_DATA)
sys.path.insert(0, str(ROOT / "backend"))

from app.project_models import ProductVersionCreate, ProjectCreate  # noqa: E402
from app.project_workspace import (  # noqa: E402
    create_product_version,
    create_project,
    get_project,
    list_projects,
)

PROJECT_NAME = "UI 验收演示项目"
VERSION = "UI-DEMO-1"

def main() -> None:
    existing = next((item for item in list_projects(search=PROJECT_NAME) if item.name == PROJECT_NAME), None)
    if existing is None:
        project = create_project(
            ProjectCreate(
                name=PROJECT_NAME,
                product_name="智能穿戴设备（演示）",
                description="仅用于查看平台页面与操作流程；非真实测试项目，不代表任何实际执行结论。",
            )
        )
        print(f"已创建演示项目：{PROJECT_NAME} (id={project.id})")
    else:
        project = get_project(existing.id)
        print(f"演示项目已存在，复用：{PROJECT_NAME} (id={project.id})")

    current = next((v for v in project.product_versions if v.version == VERSION), None)
    if current is None:
        current = create_product_version(
            project.id,
            ProductVersionCreate(
                version=VERSION,
                name="UI 界面检查",
                description="仅用于逐页浏览 01-05；未导入业务数据时会显示对应空状态。",
            ),
        )
        print(f"已创建演示版本：{VERSION} (id={current.id})")
    else:
        print(f"演示版本已存在，复用：{VERSION} (id={current.id})")
    print("接下来运行 .\\scripts\\dev.ps1，打开前端，点击「开启平台」并选择「UI 验收演示项目」。")

if __name__ == "__main__":
    main()
