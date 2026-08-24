from app.run_models import BasicCheck, EvaluationResult, RunConfigurationSnapshot, TimeAlignmentResult


def evaluate_run(
    checks: list[BasicCheck],
    alignment: TimeAlignmentResult | None,
    snapshot: RunConfigurationSnapshot,
) -> EvaluationResult:
    """按快照中的静态阈值判定；摸底模式只返回分布，不输出合格性结论。"""
    failed_checks = sum(check.status == "failed" for check in checks)
    metrics: dict[str, float | int] = {
        "check_count": len(checks),
        "failed_check_count": failed_checks,
    }
    if alignment is not None and alignment.post_alignment:
        metrics["max_alignment_residual_ms"] = max(
            metric["max_residual_ms"] for metric in alignment.post_alignment.values()
        )

    configuration = snapshot.evaluation
    if configuration.mode == "baseline_analysis":
        return EvaluationResult(
            mode=configuration.mode,
            threshold_source=configuration.threshold_source,
            thresholds=configuration.thresholds,
            conclusion="not_applicable",
            is_product_commitment=False,
            metrics=metrics,
            summary="摸底分析模式仅展示检测结果分布和趋势，不产生合格性结论。",
        )

    within_thresholds = True
    if "max_failed_checks" in configuration.thresholds:
        within_thresholds &= failed_checks <= configuration.thresholds["max_failed_checks"]
    if "max_alignment_residual_ms" in configuration.thresholds and "max_alignment_residual_ms" in metrics:
        within_thresholds &= metrics["max_alignment_residual_ms"] <= configuration.thresholds[
            "max_alignment_residual_ms"
        ]
    conclusion = "passed" if within_thresholds else "failed"
    mode_label = "需求验收" if configuration.mode == "requirements_acceptance" else "工程目标"
    commitment = configuration.mode == "requirements_acceptance"
    summary = f"{mode_label}模式：{'达到判定条件' if within_thresholds else '未达到判定条件'}。"
    if not commitment:
        summary += "该结论仅用于 POC/EVT 工程目标，不代表产品承诺。"
    return EvaluationResult(
        mode=configuration.mode,
        threshold_source=configuration.threshold_source,
        thresholds=configuration.thresholds,
        conclusion=conclusion,
        is_product_commitment=commitment,
        metrics=metrics,
        summary=summary,
    )
