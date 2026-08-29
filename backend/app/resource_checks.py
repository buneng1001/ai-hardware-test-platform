"""资源指标和设备日志的跨证据窗口检查。"""

import csv
from pathlib import Path

from app.artifact_io import read_fault_truth
from app.run_models import Artifact, BasicCheck, RunConfigurationSnapshot

COMBINATION_REFS = [
    "fault_truth:temperature_combination",
    "device_status:temperature_window",
    "device_log:temperature_window",
]


def run_resource_checks(
    artifacts: list[Artifact], data_dir: Path, snapshot: RunConfigurationSnapshot
) -> list[BasicCheck]:
    """从设备状态与日志计算温升及同窗口关联，不推断根因。"""
    truth = read_fault_truth(artifacts, data_dir)
    fault = next((item for item in truth["faults"] if item["type"] == "temperature_rise"), None)
    status_path = data_dir / next(artifact.path for artifact in artifacts if artifact.kind == "device_status")
    log_path = data_dir / next(artifact.path for artifact in artifacts if artifact.kind == "device_log")
    rows = _read_status(status_path)
    temperatures = [float(row["temperature_c"]) for row in rows]
    window = _temperature_window(rows)
    temperature_rise = _temperature_rise_check(temperatures, window, fault)
    window_correlation = _window_correlation_check(rows, window, fault)
    log_correlation = _log_correlation_check(log_path, window, fault)
    return [temperature_rise, window_correlation, log_correlation]


def _temperature_rise_check(
    temperatures: list[float], window: tuple[float, float] | None, fault: dict | None
) -> BasicCheck:
    start = temperatures[0] if temperatures else 0.0
    end = max(temperatures) if temperatures else 0.0
    rising = window is not None and end - start >= 10.0
    expected = bool(fault and fault["expected_check"] == "temperature_rise")
    return BasicCheck(
        name="temperature_rise",
        category="resource",
        status="failed" if rising else "passed",
        message=f"温度从 {start:.1f} °C 升至 {end:.1f} °C" if rising else "未检测到显著温升",
        metrics={"start_temperature_c": start, "maximum_temperature_c": end, "rise_c": round(end - start, 1)},
        anomaly_windows=[{"start_s": window[0], "end_s": window[1]}] if rising and window else [],
        truth_comparison="matched" if rising and expected else ("missed" if expected else "not_applicable"),
        evidence_refs=COMBINATION_REFS if fault else [],
    )


def _window_correlation_check(
    rows: list[dict[str, str]], window: tuple[float, float] | None, fault: dict | None
) -> BasicCheck:
    in_window = [
        row
        for row in rows
        if window
        and window[0]
        <= float(row["relative_timestamp_s"] if "relative_timestamp_s" in row else row["timestamp_s"])
        <= window[1]
    ]
    rising = len(in_window) >= 2 and float(in_window[-1]["temperature_c"]) > float(in_window[0]["temperature_c"])
    expected = bool(fault)
    return BasicCheck(
        name="temperature_window_correlation",
        category="resource",
        status="failed" if rising else "passed",
        message="温升资源指标与组合故障窗口重合；这只是时间相关性" if rising else "温升窗口未形成关联证据",
        metrics={"samples_in_window": len(in_window)},
        anomaly_windows=[{"start_s": window[0], "end_s": window[1]}] if rising and window else [],
        truth_comparison="matched" if rising and expected else ("missed" if expected else "not_applicable"),
        evidence_refs=COMBINATION_REFS if fault else [],
    )


def _log_correlation_check(path: Path, window: tuple[float, float] | None, fault: dict | None) -> BasicCheck:
    lines = path.read_text(encoding="utf-8").splitlines()
    matched = [line for line in lines if window and window[0] <= float(line.split()[0]) <= window[1]]
    expected = bool(fault)
    return BasicCheck(
        name="temperature_log_correlation",
        category="log",
        status="failed" if len(matched) >= 2 else "passed",
        message=f"异常窗口内找到 {len(matched)} 条设备日志事件；这只是时间相关性"
        if len(matched) >= 2
        else "异常窗口内未找到足够设备日志事件",
        metrics={"matched_event_count": len(matched)},
        anomaly_windows=[{"start_s": window[0], "end_s": window[1]}] if len(matched) >= 2 and window else [],
        truth_comparison="matched" if len(matched) >= 2 and expected else ("missed" if expected else "not_applicable"),
        evidence_refs=COMBINATION_REFS if fault else [],
    )


def _read_status(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as file:
        return list(csv.DictReader(file))


def _temperature_window(rows: list[dict[str, str]]) -> tuple[float, float] | None:
    """从相邻资源样本的温度变化独立识别温升窗口。"""
    candidates = []
    for previous, current in zip(rows, rows[1:], strict=False):
        if float(current["temperature_c"]) - float(previous["temperature_c"]) >= 10.0:
            candidates.append(
                (
                    float(
                        previous["relative_timestamp_s"]
                        if "relative_timestamp_s" in previous
                        else previous["timestamp_s"]
                    ),
                    float(
                        current["relative_timestamp_s"]
                        if "relative_timestamp_s" in current
                        else current["timestamp_s"]
                    ),
                )
            )
    return candidates[-1] if candidates else None
