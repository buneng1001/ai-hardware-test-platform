import json
from pathlib import Path

from app.run_models import Artifact


def read_fault_truth(artifacts: list[Artifact], data_dir: Path) -> dict:
    """从运行产物清单读取生成前保存的故障真值。"""
    truth_artifact = next(artifact for artifact in artifacts if artifact.kind == "fault_truth")
    return json.loads((data_dir / truth_artifact.path).read_text(encoding="utf-8"))
