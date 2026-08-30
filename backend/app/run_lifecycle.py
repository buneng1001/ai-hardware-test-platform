"""运行队列的执行、取消检查和启动恢复。"""

import json
import subprocess
from collections.abc import Callable

from app.database import get_data_dir, open_database
from app.evaluation import evaluate_run
from app.imu_checks import run_imu_checks
from app.normal_generator import generate_normal_artifacts
from app.resource_checks import run_resource_checks
from app.run_models import RunRecord
from app.run_storage import (
    event,
    get_run,
    imported_artifacts,
    is_imported_task,
    not_run_check,
    now,
    save_active_run,
    save_cancelled_evidence,
)
from app.storage_checks import run_storage_checks
from app.time_alignment import align_fixed_offset, align_imported_data, align_linear_drift, build_frame_imu_alignment
from app.video_checks import run_video_checks


def stop_requested(record: RunRecord, application_stopping: Callable[[], bool]) -> bool:
    if application_stopping():
        return True
    current = get_run(record.id)
    if current and current.status == "cancelled":
        save_cancelled_evidence(record)
        return True
    return False


def process_run(run_id: int, application_stopping: Callable[[], bool]) -> None:
    """在单工作线程中执行一个运行，并在阶段边界响应取消或关闭。"""
    record = get_run(run_id)
    if record is None or record.status != "queued" or application_stopping():
        return
    try:
        record.status = "generating_data"
        record.events.append(event("generating_data"))
        if not save_active_run(record):
            return
        if is_imported_task(record.collection_task_id):
            record.artifacts = imported_artifacts(record.collection_task_id)
            record.generation_metadata = None
        else:
            record.artifacts, record.generation_metadata = generate_normal_artifacts(
                get_data_dir() / "runs" / str(record.id), record.configuration_snapshot
            )
        if stop_requested(record, application_stopping):
            return
        record.status = "running_checks"
        record.events.append(event("running_checks"))
        if not save_active_run(record):
            return
        if is_imported_task(record.collection_task_id):
            record.checks = [
                *run_video_checks(record.artifacts, get_data_dir(), record.configuration_snapshot),
                *run_imu_checks(record.artifacts, get_data_dir(), record.configuration_snapshot),
            ]
            if not any(a.kind == "device_status" for a in record.artifacts):
                record.checks += [
                    not_run_check("storage_exhaustion", "storage", "缺少设备状态证据，未执行"),
                    not_run_check("storage_premature_stop", "storage", "缺少设备状态证据，未执行"),
                ]
            if not any(a.kind == "device_log" for a in record.artifacts):
                record.checks.append(not_run_check("storage_log_correlation", "storage", "缺少设备日志证据，未执行"))
        else:
            record.checks = [
                *run_video_checks(record.artifacts, get_data_dir(), record.configuration_snapshot),
                *run_imu_checks(record.artifacts, get_data_dir(), record.configuration_snapshot),
                *run_storage_checks(record.artifacts, get_data_dir(), record.configuration_snapshot),
                *(
                    run_resource_checks(record.artifacts, get_data_dir(), record.configuration_snapshot)
                    if record.configuration_snapshot.scenario == "temperature_combination"
                    else []
                ),
            ]
        if record.configuration_snapshot.scenario == "temperature_combination":
            channel = record.configuration_snapshot.random_seed % record.configuration_snapshot.video.channels + 1
            refs = {
                "video_frame_drop": ["fault_truth:video_frame_drop", f"video:camera_{channel}:temperature_window"],
                "imu_missing_samples": ["fault_truth:imu_missing_sample", "imu:temperature_window"],
                "imu_interval_distribution": ["fault_truth:imu_missing_sample", "imu:temperature_window"],
            }
            for check in record.checks:
                check.evidence_refs = refs.get(check.name, check.evidence_refs)
        record.alignment_result = (
            align_imported_data(record.artifacts, get_data_dir(), record.configuration_snapshot)
            if is_imported_task(record.collection_task_id)
            else align_fixed_offset(record.artifacts, get_data_dir(), record.configuration_snapshot)
            or align_linear_drift(record.artifacts, get_data_dir(), record.configuration_snapshot)
        )
        if record.alignment_result is not None:
            artifact, summary = build_frame_imu_alignment(
                record.artifacts,
                get_data_dir(),
                record.configuration_snapshot,
                record.alignment_result,
                get_data_dir() / "runs" / str(record.id) if is_imported_task(record.collection_task_id) else None,
            )
            record.artifacts.append(artifact)
            record.alignment_result = record.alignment_result.model_copy(update={"frame_imu_alignment": summary})
        record.evaluation_result = evaluate_run(record.checks, record.alignment_result, record.configuration_snapshot)
        if stop_requested(record, application_stopping):
            return
        record.status = "summarizing_results"
        record.events.append(event("summarizing_results"))
        if not save_active_run(record) or stop_requested(record, application_stopping):
            return
        record.status = "completed"
        record.completed_at = now()
        record.events.append(event("completed"))
        save_active_run(record)
    except (KeyError, OSError, RuntimeError, TypeError, ValueError, subprocess.SubprocessError):
        record.status = "failed"
        record.completed_at = now()
        record.error = "运行处理失败，请检查输入数据和配置"
        record.events.append(event("failed"))
        save_active_run(record)


def recover_unfinished_runs() -> None:
    """应用启动时把上次进程遗留的非终态运行标记为异常中断。"""
    recovered_at = now()
    with open_database() as connection:
        rows = connection.execute(
            "SELECT id, events FROM runs WHERE status IN ("
            "'queued','generating_data','running_checks','summarizing_results')"
        ).fetchall()
        for row in rows:
            events = json.loads(row["events"])
            events.append(event("interrupted").model_dump(mode="json"))
            connection.execute(
                "UPDATE runs SET status='interrupted', events=?, completed_at=?, error=? WHERE id=?",
                (json.dumps(events), recovered_at.isoformat(), "应用重启时检测到未完成运行", row["id"]),
            )
