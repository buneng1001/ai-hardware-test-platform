import type {
  FactReport,
  ReportAnalysis,
  ReportHistoryItem,
} from "../factReportsApi";

export function factReport(overrides: Partial<FactReport> = {}): FactReport {
  return {
    id: 5,
    test_group_id: 21,
    product_version_id: 11,
    automation_execution_id: 3,
    manual_batch_ids: [1],
    created_at: "2026-10-30T10:00:00+00:00",
    lifecycle_status: "current",
    attachment_summary: {
      attachment_count: 0,
      total_size_bytes: 0,
      attachments: [],
    },
    snapshot: {
      basic_information: {
        project_name: "IRIS",
        product_name: "Recorder",
        product_version: "EVT1",
        test_group: "EVT1 基础回归",
        generated_at: "2026-10-30T10:00:00+00:00",
        contains: "自动化和人工结果",
        automation_execution: {
          id: 3,
          execution_number: 3,
          status: "completed",
          execution_mode: "data_driven_simulation",
          started_at: "2026-10-30T09:00:00+00:00",
          completed_at: "2026-10-30T09:00:10+00:00",
        },
        manual_batches: [
          { id: 1, batch_number: 1, created_at: "2026-10-30T09:30:00+00:00" },
        ],
      },
      warnings: [],
      stage_progress: {
        conclusion: "建议暂缓并补充验证",
        basis: ["失败 1 项"],
      },
      ai_analysis: {
        status: "not_configured",
        message: "AI 未配置；事实报告已按确定性记录生成。",
      },
      scope_overview: {
        original_case_count: 2,
        module_count: 1,
        automation_case_count: 1,
        manual_case_count: 1,
        counts: { passed: 0, failed: 1, blocked: 0, not_executed: 1 },
      },
      modules: [
        {
          name: "采集",
          conclusion: "建议暂缓并补充验证",
          counts: { passed: 0, failed: 1, blocked: 0, not_executed: 1 },
          records: [
            {
              case_number: "SRC-001",
              title: "录制",
              module: "采集",
              test_item: "录制",
              source: "自动化",
              status: "failed",
              message: "确定性检查实际结果：video_drop；未满足用例预期。",
              executed_at: null,
            },
          ],
        },
      ],
      cross_module_issues: [],
    },
    analysis: {
      status: "not_configured",
      message: "AI 分析未启用",
      output: null,
    },
    ...overrides,
  };
}

export function reportHistoryItem(
  id: number,
  status = "current",
  occurredAt = "2026-10-30T10:00:00+00:00",
): ReportHistoryItem {
  return {
    record_type: "fact_report",
    id,
    label: `最终报告 #${id}`,
    status,
    occurred_at: occurredAt,
  };
}

export function completedAnalysis(): ReportAnalysis {
  return {
    status: "completed",
    message: "AI 分析已完成",
    output: {
      risks: [
        {
          content: "优先人工复核失败与结果不一致项。",
          evidence_refs: ["stage_progress"],
        },
      ],
      additional_verifications: [
        {
          content: "补充验证录制中断后的文件完整性。",
          evidence_refs: ["module:0"],
        },
      ],
      regression_recommendations: [
        {
          content: "下一版本回归录制恢复用例。",
          evidence_refs: ["record:0:0"],
        },
      ],
      stage_recommendation: {
        suggestion: "请依据已保存事实报告补充验证后，再决定是否推进阶段。",
        content: "阶段建议仅作为参考，不构成强制质量门禁。",
        evidence_refs: ["stage_progress"],
      },
    },
  };
}

export function reportAttachmentSummary(): FactReport["attachment_summary"] {
  return {
    attachment_count: 2,
    total_size_bytes: 3072,
    attachments: [
      {
        id: 20,
        filename: "shot.png",
        content_type: "image/png",
        size_bytes: 2048,
        storage_status: "stored",
        usage_status: "used",
      },
      {
        id: 21,
        filename: "log.txt",
        content_type: "text/plain",
        size_bytes: 1024,
        storage_status: "stored",
        usage_status: "used",
      },
    ],
  };
}
