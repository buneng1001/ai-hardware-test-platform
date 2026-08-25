import csv
import hashlib
import io
import json
import re
import subprocess
import zipfile
from pathlib import Path
from typing import cast

import imageio_ffmpeg
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.database import get_data_dir
from app.manual_attachments import get_manual_attachment_path
from app.report import ReportDocument, _get_run, _render_html, _report_document
from app.run_models import Artifact, ManualCheckResult, RunRecord

router = APIRouter(tags=["evidence"])

MAX_SAMPLE_BYTES = 5 * 1024 * 1024
MAX_SAMPLE_TOTAL_BYTES = 10 * 1024 * 1024
SAMPLE_DURATION_SECONDS = 1
SENSITIVE_PATTERNS = (
    re.compile(r"(?i)(authorization\s*:\s*)[^\r\n,]+"),
    re.compile(r"(?i)(x-auth-token\s*[:=]\s*)[^\r\n,]+"),
    re.compile(r"(?i)(api[_ -]?key\s*[:=]\s*)[^\s,;]+"),
    re.compile(r"(?i)\bsk-[a-z0-9_-]{8,}\b"),
)


def _sanitize_text(value: str) -> str:
    """导出前过滤认证头和常见密钥形式，避免人工输入污染交付物。"""
    sanitized = value
    for pattern in SENSITIVE_PATTERNS:
        sanitized = pattern.sub(lambda match: f"{match.group(1) if match.lastindex else ''}[REDACTED]", sanitized)
    return sanitized


def _sanitize(value: object) -> object:
    if isinstance(value, str):
        return _sanitize_text(value)
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, dict):
        return {_sanitize_text(str(key)): _sanitize(item) for key, item in value.items()}
    return value


def _json_bytes(value: object) -> bytes:
    return (json.dumps(_sanitize(value), ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _csv_bytes(headers: list[str], rows: list[list[object]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow([_sanitize_text(str(value)) for value in row])
    return output.getvalue().encode("utf-8")


def _safe_artifact_path(artifact: Artifact, data_dir: Path) -> Path:
    path = (data_dir / artifact.path).resolve()
    try:
        path.relative_to(data_dir.resolve())
    except ValueError as error:
        raise HTTPException(status_code=500, detail="运行产物路径不安全，无法导出证据包") from error
    if not path.is_file():
        raise HTTPException(status_code=500, detail=f"运行产物不存在：{artifact.path}")
    return path


def _sanitized_text_file(path: Path) -> bytes:
    """读取平台生成的文本产物；损坏的 UTF-8 直接让导出失败。"""
    text = path.read_text(encoding="utf-8")
    sanitized = _sanitize_text(text)
    if sanitized != text:
        raise HTTPException(status_code=422, detail=f"运行产物包含敏感字段：{path.name}")
    return text.encode("utf-8")


def _assert_binary_safe(content: bytes, name: str) -> None:
    """检查二进制交付物中的常见明文敏感标记，不尝试解析媒体格式。"""
    lowered = content.lower()
    markers = (b"authorization:", b"x-auth-token", b"api_key", b"api-key", b"sk-")
    if any(marker in lowered for marker in markers):
        raise HTTPException(status_code=422, detail=f"交付物包含敏感字段：{name}")


def _add_manual_results(files: dict[str, bytes], results: list[ManualCheckResult]) -> None:
    rows = [
        [
            result.id,
            result.name,
            result.status,
            result.actual_result or "",
            result.notes or "",
            result.executed_at.isoformat() if result.executed_at else "",
            result.attachment["filename"] if result.attachment else "",
        ]
        for result in results
    ]
    files["manual-check-results.csv"] = _csv_bytes(
        ["id", "name", "status", "actual_result", "notes", "executed_at", "attachment"], rows
    )


def _add_checks(files: dict[str, bytes], run: RunRecord) -> None:
    rows = [
        [
            check.name,
            check.category,
            check.status,
            check.truth_comparison,
            check.message,
            json.dumps(check.metrics, ensure_ascii=False),
            json.dumps(check.anomaly_windows, ensure_ascii=False),
            json.dumps(check.evidence_refs, ensure_ascii=False),
        ]
        for check in run.checks
    ]
    files["checks.csv"] = _csv_bytes(
        ["name", "category", "status", "truth_comparison", "message", "metrics", "anomaly_windows", "evidence_refs"],
        rows,
    )


def _add_artifacts(files: dict[str, bytes], run: RunRecord, data_dir: Path) -> list[str]:
    included_artifacts: list[str] = []
    names_by_kind = {
        "device_status": "device_status.csv",
        "device_log": "device.log",
        "fault_truth": "fault_truth.json",
    }
    for artifact in run.artifacts:
        if artifact.kind == "video":
            continue
        path = names_by_kind.get(artifact.kind, Path(artifact.path).name)
        files[path] = _sanitized_text_file(_safe_artifact_path(artifact, data_dir))
        included_artifacts.append(path)
    return included_artifacts


def _add_manual_attachments(files: dict[str, bytes], run: RunRecord) -> None:
    for result in run.manual_check_results:
        if not result.attachment:
            continue
        filename = str(result.attachment["filename"])
        path = get_manual_attachment_path(run.id, result.id, filename)
        if not path.is_file():
            raise HTTPException(status_code=500, detail=f"人工附件不存在：{filename}")
        if result.attachment["content_type"] == "text/plain":
            files[f"manual-attachments/{result.id}-{filename}"] = _sanitize_text(
                path.read_text(encoding="utf-8")
            ).encode("utf-8")
        else:
            content = path.read_bytes()
            _assert_binary_safe(content, filename)
            files[f"manual-attachments/{result.id}-{filename}"] = content


def _add_samples(files: dict[str, bytes], run: RunRecord, data_dir: Path, include_sample: bool) -> None:
    if not include_sample:
        return
    total = 0
    for artifact in run.artifacts:
        if artifact.kind != "video":
            continue
        path = _safe_artifact_path(artifact, data_dir)
        size = path.stat().st_size
        if size > MAX_SAMPLE_BYTES or total + size > MAX_SAMPLE_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="视频小样超过证据包大小保护")
        package_path = f"samples/{Path(artifact.path).stem}.sample{Path(artifact.path).suffix}"
        output_format = Path(artifact.path).suffix.removeprefix(".")
        command = [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-v",
            "error",
            "-i",
            str(path),
            "-t",
            str(SAMPLE_DURATION_SECONDS),
            "-an",
            "-c",
            "copy",
        ]
        if output_format == "mp4":
            command.extend(["-movflags", "frag_keyframe+empty_moov"])
        command.extend(["-f", output_format, "pipe:1"])
        try:
            sample = subprocess.run(command, check=True, capture_output=True).stdout
        except (OSError, subprocess.SubprocessError) as error:
            raise HTTPException(status_code=500, detail="视频小样提取失败") from error
        _assert_binary_safe(sample, package_path)
        if len(sample) > MAX_SAMPLE_BYTES or total + len(sample) > MAX_SAMPLE_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="视频小样超过证据包大小保护")
        files[package_path] = sample
        total += len(sample)


def _manifest(files: dict[str, bytes], run: RunRecord, include_sample: bool) -> dict[str, object]:
    entries = [
        {
            "path": path,
            "size_bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
        for path, content in sorted(files.items())
    ]
    return {
        "format": "verifiable-evidence-v1",
        "run_id": run.id,
        "included_video_sample": include_sample,
        "excluded_kinds": [] if include_sample else ["video"],
        "package_entries": sorted([*files, "evidence-manifest.json", "SHA256SUMS.txt"]),
        "files": entries,
    }


def _build_zip(run: RunRecord, include_sample: bool) -> bytes:
    report = _report_document(run)
    sanitized_report = ReportDocument.model_validate(_sanitize(report.model_dump(mode="json")))
    files: dict[str, bytes] = {
        "report.json": _json_bytes(sanitized_report.model_dump(mode="json")),
        "report.html": _render_html(sanitized_report).encode("utf-8"),
    }
    _add_checks(files, run)
    _add_manual_results(files, run.manual_check_results)
    _add_artifacts(files, run, get_data_dir())
    _add_manual_attachments(files, run)
    _add_samples(files, run, get_data_dir(), include_sample)

    manifest = _manifest(files, run, include_sample)
    files["evidence-manifest.json"] = _json_bytes(manifest)
    files["SHA256SUMS.txt"] = "".join(
        f"{entry['sha256']}  {entry['path']}\n" for entry in cast(list[dict[str, object]], manifest["files"])
    ).encode("utf-8")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, content in sorted(files.items()):
            archive.writestr(path, content)
    return output.getvalue()


@router.get("/api/runs/{run_id}/evidence.zip")
def get_evidence_zip(run_id: int, include_sample: bool = Query(default=False)) -> Response:
    run = _get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="运行记录不存在")
    if run.status != "completed":
        raise HTTPException(status_code=409, detail="只有已完成运行才能导出完整证据包")
    content = _build_zip(run, include_sample)
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="run-{run_id}-evidence.zip"'},
    )
