import type { AutomationTestCase } from "../automationTestCasesApi";
import type {
  ImportOptions,
  SourceTestCase,
  SourceTestCaseImportRecord,
} from "../sourceTestCasesApi";

export const projectSummary = {
  id: 1,
  name: "IRIS 头环",
  product_name: "多传感器记录设备",
  description: "Beta 测试项目",
  product_version_count: 1,
  created_at: "2026-10-01T08:00:00Z",
  updated_at: "2026-10-02T08:00:00Z",
};

export const productVersion = {
  id: 11,
  project_id: 1,
  version: "EVT1",
  name: "",
  description: "",
  created_at: "2026-10-01T08:10:00Z",
  updated_at: "2026-10-01T08:10:00Z",
};

const defaultImportOptions: ImportOptions = {
  include_historical_results: false,
  include_test_records: false,
  include_pre_test_notes: false,
  include_planned_execution_time: false,
  include_attachments: false,
};

/** 构造一条完整原始用例，测试只覆盖当前断言需要的字段差异。 */
export function sourceCase(overrides: Partial<SourceTestCase>): SourceTestCase {
  return {
    id: 1,
    import_record_id: 1,
    source_import_status: "active",
    case_number: "REC-001",
    title: "录制文件完整",
    priority: "高",
    preconditions: "",
    input: "",
    steps: "确认设备处于待机状态",
    expected_result: "",
    test_type: "",
    module: "录制功能",
    test_item: "文件完整性",
    test_result: "",
    test_record: "",
    pre_test_notes: "",
    planned_execution_time: "",
    attachment: "",
    software_version: "EVT1-0.2.0",
    selected: false,
    ...overrides,
  };
}

export function importRecord(
  overrides: Partial<SourceTestCaseImportRecord> = {},
): SourceTestCaseImportRecord {
  return {
    id: 7,
    product_version_id: 11,
    source_filename: "beta.csv",
    field_mapping: { case_number: "用例编号", title: "测试用例标题" },
    import_options: defaultImportOptions,
    imported_at: "2026-10-29T10:00:00+00:00",
    ...overrides,
  };
}

/** 构造一条完整自动化用例候选，测试只覆盖当前断言需要的字段差异。 */
export function automationCase(
  overrides: Partial<AutomationTestCase>,
): AutomationTestCase {
  return {
    id: 1,
    product_version_id: 11,
    source_test_case_id: 4,
    source_case_number: "REC-001",
    case_number: "AUTO-000001",
    title: "录制文件完整",
    input: "正常录制数据",
    steps: "开始录制并停止",
    expected_result: "生成完整视频文件",
    conversion_status: "candidate",
    confidence: "low",
    review_note: "规则转换候选，低可信度，需人工审核。",
    validation_status: "unvalidated",
    validation_message: "",
    feedback_input: "",
    feedback_status: "not_requested",
    feedback_response: "",
    created_at: "2026-10-29T10:00:00+00:00",
    updated_at: "2026-10-29T10:00:00+00:00",
    ...overrides,
  };
}
