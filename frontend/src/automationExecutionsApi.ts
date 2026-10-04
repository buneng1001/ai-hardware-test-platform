import { request } from "./apiClient";

export type PreparationCheck = {
  code: string;
  object_type: "test_group" | "automation_test_case" | "data_package";
  object_id: number;
  actual: string;
  expected: string;
  suggestion: string;
  action: "edit_group" | "replace_data_packages";
};

export type AutomationExecution = {
  id: number;
  test_group_id: number;
  execution_number: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary: {
    passed: number;
    failed: number;
    blocked: number;
    not_executed: number;
  };
  group_snapshot: { name: string };
  case_results: Array<{
    automation_test_case_id: number;
    case_number: string;
    title: string;
    position: number;
    status: "passed" | "failed" | "blocked" | "not_executed";
    message: string;
  }>;
};

export function prepareAutomationExecution(groupId: number) {
  return request<{ passed: boolean; checks: PreparationCheck[] }>(
    `/api/test-groups/${groupId}/automation-execution-preparations`,
    { method: "POST" },
  );
}

export function startAutomationExecution(groupId: number) {
  return request<AutomationExecution>(
    `/api/test-groups/${groupId}/automation-executions`,
    { method: "POST" },
  );
}

export function listAutomationExecutions(groupId: number) {
  return request<{ items: AutomationExecution[] }>(
    `/api/test-groups/${groupId}/automation-executions`,
  );
}
