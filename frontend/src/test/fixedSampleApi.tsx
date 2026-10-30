import { vi } from "vitest";

import type { ProjectTrend } from "../projectsApi";
import { factReport, reportHistoryItem } from "./reportHarness";

const prototypeProject = {
  id: 1,
  name: "IRIS 头环",
  product_name: "多传感器记录设备",
  description: "Beta 测试项目",
  product_version_count: 1,
  created_at: "2026-10-01T08:00:00Z",
  updated_at: "2026-10-02T08:00:00Z",
};

const prototypeVersion = {
  id: 11,
  project_id: 1,
  version: "EVT1",
  name: "",
  description: "",
  created_at: "2026-10-01T08:10:00Z",
  updated_at: "2026-10-01T08:10:00Z",
};

/** 冻结版“测试用例表”页读取的真实原始用例样例。 */
const prototypeSourceCases = [
  {
    id: 1,
    import_record_id: 1,
    source_import_status: "active",
    case_number: "TC-REC-001",
    title: "短按录制键，确认开始录制",
    priority: "高",
    preconditions: "",
    input: "",
    steps: "确认设备处于待机状态\n短按录制键并观察录制指示",
    expected_result: "",
    test_type: "",
    module: "录制功能",
    test_item: "录制启动",
    test_result: "",
    test_record: "",
    pre_test_notes: "",
    planned_execution_time: "",
    attachment: "",
    software_version: "EVT1-0.2.0",
    selected: false,
  },
  {
    id: 2,
    import_record_id: 1,
    source_import_status: "active",
    case_number: "TC-POWER-003",
    title: "设备断电后数据保存状态",
    priority: "中",
    preconditions: "",
    input: "",
    steps: "在设备录制过程中断开电源",
    expected_result: "",
    test_type: "",
    module: "电源管理",
    test_item: "断电恢复",
    test_result: "",
    test_record: "",
    pre_test_notes: "",
    planned_execution_time: "",
    attachment: "",
    software_version: "EVT1-0.2.0",
    selected: false,
  },
];

/** 冻结版“测试数据”页读取的真实数据包样例。 */
const prototypeDataPackage = {
  id: 7,
  package_number: "DP-000007",
  source_task_id: 3,
  source_task_name: "EVT1 录制采集",
  source_run_id: 12,
  source_run_execution_number: 2,
  source_type: "generated",
  data_kind: "normal",
  fault_type: null,
  version_fingerprint: "abc123def456789",
  generated_at: "2026-10-03T08:00:00Z",
  validation_status: "passed",
  validation_message: "数据包文件、视频和 IMU 通道已通过完整性校验",
  channels: ["camera_1", "camera_2"],
  timestamps: { first_raw_device_timestamp_ns: 1700000000000000000 },
  integrity: {
    status: "passed",
    checked_file_count: 3,
    missing_files: [],
    size_mismatches: [],
  },
  eligible_for_test_group: true,
  has_newer_source_result: false,
  recommended_source_run_id: null,
  files: [],
};

/** 冻结版“测试组设置”页读取的真实测试组样例。 */
const prototypeAutomationCase = {
  id: 1,
  product_version_id: 11,
  source_test_case_id: 1,
  source_case_number: "TC-REC-001",
  case_number: "AUTO-000001",
  title: "短按录制键，确认开始录制",
  input: "",
  steps: "确认设备处于待机状态",
  expected_result: "开始录制",
  conversion_status: "candidate",
  confidence: "low",
  review_note: "规则转换候选，低可信度，需人工审核。",
  validation_status: "passed",
  validation_message: "",
  feedback_input: "",
  feedback_status: "not_requested",
  feedback_response: "",
  created_at: "2026-10-03T08:00:00Z",
  updated_at: "2026-10-03T08:00:00Z",
};

const prototypeGroupSourceCase = {
  id: 1,
  case_number: "TC-REC-001",
  title: "短按录制键，确认开始录制",
  test_type: "功能",
  software_version: "EVT1",
  position: 1,
};

const prototypeGroupDetail = {
  id: 21,
  product_version_id: 11,
  name: "EVT1 基础录制回归",
  description: "基础覆盖",
  hidden: false,
  source_test_case_count: 1,
  automation_test_case_count: 1,
  data_package_assignment_count: 0,
  created_at: "2026-10-03T08:00:00Z",
  updated_at: "2026-10-03T08:00:00Z",
  source_test_cases: [prototypeGroupSourceCase],
  automation_test_cases: [
    {
      id: 1,
      case_number: "AUTO-000001",
      source_case_number: "TC-REC-001",
      title: "短按录制键，确认开始录制",
      validation_status: "passed",
      source_software_version: "EVT1",
      position: 1,
      data_packages: [],
    },
  ],
};

const prototypeGroupSummary = {
  id: 21,
  product_version_id: 11,
  name: "EVT1 基础录制回归",
  description: "基础覆盖",
  hidden: false,
  source_test_case_count: 1,
  automation_test_case_count: 1,
  data_package_assignment_count: 0,
  created_at: "2026-10-03T08:00:00Z",
  updated_at: "2026-10-03T08:00:00Z",
};

const prototypeExecution = {
  id: 3,
  test_group_id: 21,
  product_version_id: 11,
  execution_number: 3,
  status: "completed",
  execution_mode: "data_driven_simulation",
  started_at: "2026-09-15T10:32:00+00:00",
  completed_at: "2026-09-15T10:32:20+00:00",
  summary: { passed: 8, failed: 2, blocked: 1, not_executed: 1 },
  group_snapshot: { name: "EVT1 基础录制回归", product_version: "EVT1" },
  configuration_snapshot: { execution_mode: "data_driven_simulation" },
  case_results: [
    {
      automation_test_case_id: 1,
      case_number: "AUTO-000001",
      title: "短按录制键，确认开始录制",
      position: 1,
      status: "passed",
      message: "确定性数据检查结果符合用例预期。",
    },
  ],
};
const prototypeManualPage = {
  test_group_id: 21,
  product_version_id: 11,
  cases: [
    {
      id: 4,
      case_number: "SRC-001",
      title: "按键检查",
      test_type: "manual",
      position: 1,
    },
  ],
  batches: [],
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 冻结页面进入项目后需要的固定样例 API；可按用例覆盖趋势。 */
export function installFixedSampleApi(options: { trend?: ProjectTrend } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/projects?"))
        return jsonResponse([prototypeProject]);
      if (url === "/api/projects/1")
        return jsonResponse({
          ...prototypeProject,
          product_versions: [prototypeVersion],
        });
      if (url === "/api/projects/1/trends")
        return jsonResponse(
          options.trend ?? {
            project_id: 1,
            status: "empty",
            message: "尚无最终报告",
            points: [],
          },
        );
      if (url.startsWith("/api/product-versions/11/source-test-cases")) {
        const query = new URL(url, "http://local").searchParams;
        const moduleFilter = query.get("module");
        return jsonResponse({
          items: moduleFilter
            ? prototypeSourceCases.filter(
                (item) => item.module === moduleFilter,
              )
            : prototypeSourceCases,
        });
      }
      if (url === "/api/product-versions/11/source-test-case-imports")
        return jsonResponse([]);
      if (url.startsWith("/api/product-versions/11/test-groups")) {
        if (method === "POST") {
          const body = JSON.parse(String(init?.body)) as {
            name: string;
            description: string;
          };
          return jsonResponse(
            {
              ...prototypeGroupDetail,
              name: body.name,
              description: body.description,
            },
            201,
          );
        }
        return jsonResponse({
          items: [prototypeGroupSummary],
          page: 1,
          page_size: 20,
          total: 1,
        });
      }
      if (url === "/api/test-groups/21")
        return jsonResponse(prototypeGroupDetail);
      if (url === "/api/product-versions/11/automation-test-cases")
        return jsonResponse({ items: [prototypeAutomationCase] });
      if (url === "/api/data-packages")
        return jsonResponse({ items: [prototypeDataPackage] });
      if (url === "/api/test-groups/21/automation-executions")
        return jsonResponse({ items: [prototypeExecution] });
      if (
        url === "/api/test-groups/21/manual-test-result-batches" &&
        method === "GET"
      )
        return jsonResponse(prototypeManualPage);
      if (url === "/api/test-groups/21/report-history")
        return jsonResponse({ items: [reportHistoryItem(5)] });
      if (url === "/api/fact-reports/5") return jsonResponse(factReport());
      return jsonResponse({ detail: "未模拟的接口" }, 404);
    }),
  );
}
