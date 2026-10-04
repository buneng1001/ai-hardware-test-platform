import { request } from "./apiClient";

export type TestGroupSummary = {
  id: number;
  product_version_id: number;
  name: string;
  description: string;
  hidden: boolean;
  source_test_case_count: number;
  automation_test_case_count: number;
  data_package_assignment_count: number;
  created_at: string;
  updated_at: string;
};

export type AssignedDataPackage = {
  id: number;
  package_number: string;
  validation_status: string;
  has_newer_source_result: boolean;
  recommended_source_run_id: number | null;
  warnings: string[];
};

export type TestGroupDetail = TestGroupSummary & {
  source_test_cases: Array<{
    id: number;
    case_number: string;
    title: string;
    test_type: string;
    software_version: string;
    position: number;
  }>;
  automation_test_cases: Array<{
    id: number;
    case_number: string;
    source_case_number: string;
    title: string;
    validation_status: string;
    source_software_version: string;
    position: number;
    data_packages: AssignedDataPackage[];
  }>;
};

export type TestGroupPage = {
  items: TestGroupSummary[];
  page: number;
  page_size: number;
  total: number;
};

export function listTestGroups(
  versionId: number,
  options: {
    search?: string;
    sort?: string;
    hidden?: boolean;
    page?: number;
  } = {},
) {
  const params = new URLSearchParams({
    search: options.search ?? "",
    sort: options.sort ?? "updated_desc",
    page: String(options.page ?? 1),
    page_size: "20",
  });
  if (options.hidden !== undefined)
    params.set("hidden", String(options.hidden));
  return request<TestGroupPage>(
    `/api/product-versions/${versionId}/test-groups?${params.toString()}`,
  );
}

export function createTestGroup(
  versionId: number,
  command: {
    name: string;
    description: string;
    include_selected_source_cases: boolean;
  },
) {
  return request<TestGroupDetail>(
    `/api/product-versions/${versionId}/test-groups`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    },
  );
}

export function getTestGroup(groupId: number) {
  return request<TestGroupDetail>(`/api/test-groups/${groupId}`);
}

export function updateTestGroup(
  groupId: number,
  command: { name: string; description: string },
) {
  return request<TestGroupDetail>(`/api/test-groups/${groupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
}

export function setTestGroupHidden(groupId: number, hidden: boolean) {
  return request<TestGroupDetail>(
    `/api/test-groups/${groupId}/${hidden ? "hide" : "restore"}`,
    {
      method: "POST",
    },
  );
}

export function getTestGroupDeletionImpact(groupId: number) {
  return request<{
    source_test_cases: number;
    automation_test_cases: number;
    data_package_assignments: number;
    manual_test_result_batches: number;
    manual_test_results: number;
    manual_test_result_attachments: number;
  }>(`/api/test-groups/${groupId}/deletion-impact`);
}

export function deleteTestGroup(groupId: number) {
  return request<void>(`/api/test-groups/${groupId}?confirm=true`, {
    method: "DELETE",
  });
}

export function addTestGroupAutomationCases(
  groupId: number,
  caseIds: number[],
) {
  return request<TestGroupDetail>(
    `/api/test-groups/${groupId}/automation-test-cases`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_ids: caseIds }),
    },
  );
}

export function addTestGroupSourceCases(groupId: number, caseIds: number[]) {
  return request<TestGroupDetail>(
    `/api/test-groups/${groupId}/source-test-cases`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_ids: caseIds }),
    },
  );
}

export function removeTestGroupSourceCase(groupId: number, caseId: number) {
  return request<void>(
    `/api/test-groups/${groupId}/source-test-cases/${caseId}`,
    { method: "DELETE" },
  );
}

export function orderTestGroupCases(
  groupId: number,
  type: "source-test-cases" | "automation-test-cases",
  caseIds: number[],
) {
  return request<TestGroupDetail>(`/api/test-groups/${groupId}/${type}/order`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case_ids: caseIds }),
  });
}

export function removeTestGroupAutomationCase(groupId: number, caseId: number) {
  return request<void>(
    `/api/test-groups/${groupId}/automation-test-cases/${caseId}`,
    { method: "DELETE" },
  );
}

export function replaceTestGroupCasePackages(
  groupId: number,
  caseId: number,
  packageIds: number[],
) {
  return request<TestGroupDetail>(
    `/api/test-groups/${groupId}/automation-test-cases/${caseId}/data-packages`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data_package_ids: packageIds }),
    },
  );
}

export function assignDataPackageToCases(
  groupId: number,
  caseIds: number[],
  packageId: number,
) {
  return request<TestGroupDetail>(
    `/api/test-groups/${groupId}/data-package-assignments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        automation_test_case_ids: caseIds,
        data_package_id: packageId,
      }),
    },
  );
}
