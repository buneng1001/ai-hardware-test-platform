import type { AutomationTestCase } from "../automationTestCasesApi";
import type { DataPackage } from "../dataPackagesApi";
import type { AssignedDataPackage, TestGroupDetail } from "../testGroupsApi";
import type { SourceTestCase } from "../sourceTestCasesApi";

export function groupSourceCase(
  id: number,
  caseNumber: string,
  title: string,
  overrides: Partial<TestGroupDetail["source_test_cases"][number]> = {},
): TestGroupDetail["source_test_cases"][number] {
  return {
    id,
    case_number: caseNumber,
    title,
    test_type: "功能",
    software_version: "EVT1",
    position: 1,
    ...overrides,
  };
}

export function groupAutomationCase(
  id: number,
  caseNumber: string,
  overrides: Partial<TestGroupDetail["automation_test_cases"][number]> = {},
): TestGroupDetail["automation_test_cases"][number] {
  return {
    id,
    case_number: caseNumber,
    source_case_number: "REC-001",
    title: "录制检查",
    validation_status: "passed",
    source_software_version: "EVT1",
    position: 1,
    data_packages: [],
    ...overrides,
  };
}

export function assignedPackage(
  id: number,
  packageNumber: string,
  overrides: Partial<AssignedDataPackage> = {},
): AssignedDataPackage {
  return {
    id,
    package_number: packageNumber,
    validation_status: "passed",
    has_newer_source_result: false,
    recommended_source_run_id: null,
    warnings: [],
    ...overrides,
  };
}

export function withCounts(detail: TestGroupDetail): TestGroupDetail {
  return {
    ...detail,
    source_test_case_count: detail.source_test_cases.length,
    automation_test_case_count: detail.automation_test_cases.length,
    data_package_assignment_count: detail.automation_test_cases.reduce(
      (count, item) => count + item.data_packages.length,
      0,
    ),
  };
}

export function testGroupDetail(
  overrides: Partial<TestGroupDetail> = {},
): TestGroupDetail {
  return withCounts({
    id: 21,
    product_version_id: 11,
    name: "EVT1 基础回归",
    description: "基础覆盖",
    hidden: false,
    source_test_case_count: 0,
    automation_test_case_count: 0,
    data_package_assignment_count: 0,
    created_at: "2026-10-29T09:00:00+00:00",
    updated_at: "2026-10-29T09:00:00+00:00",
    source_test_cases: [],
    automation_test_cases: [],
    ...overrides,
  });
}

export function groupSummary(detail: TestGroupDetail) {
  return {
    id: detail.id,
    product_version_id: detail.product_version_id,
    name: detail.name,
    description: detail.description,
    hidden: detail.hidden,
    source_test_case_count: detail.source_test_case_count,
    automation_test_case_count: detail.automation_test_case_count,
    data_package_assignment_count: detail.data_package_assignment_count,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
  };
}

export type GroupFixtures = {
  sourceCases: SourceTestCase[];
  automationCases: AutomationTestCase[];
  packages: DataPackage[];
};
