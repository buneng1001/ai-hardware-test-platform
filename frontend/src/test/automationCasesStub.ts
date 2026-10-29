import type {
  AutomationCaseHistory,
  AutomationTestCase,
} from "../automationTestCasesApi";
import { automationCase } from "./casesFixtures";
import { jsonResponse } from "./testHttp";

export type AutomationStubState = {
  automationCases?: AutomationTestCase[];
  automationConversion?: { created_count: number; items: AutomationTestCase[] };
  automationHistory?: AutomationCaseHistory;
  failAutomationTimes?: number;
  feedbackAvailable?: boolean;
};

/** 自动化用例相关接口的测试 Mock，返回 null 表示不是本模块负责的路径。 */
export function handleAutomationRequest(
  url: string,
  method: string,
  init: RequestInit | undefined,
  state: AutomationStubState,
): Response | null {
  if (
    url === "/api/product-versions/11/automation-test-cases" &&
    method === "GET"
  ) {
    if ((state.failAutomationTimes ?? 0) > 0) {
      state.failAutomationTimes = (state.failAutomationTimes ?? 0) - 1;
      return jsonResponse({ detail: "自动化用例服务暂时不可用" }, 500);
    }
    return jsonResponse({ items: state.automationCases ?? [] });
  }
  if (
    url === "/api/product-versions/11/automation-test-case-conversions/rules" &&
    method === "POST"
  ) {
    const result = state.automationConversion ?? {
      created_count: 0,
      items: state.automationCases ?? [],
    };
    state.automationCases = result.items;
    return jsonResponse(result, 201);
  }
  if (
    url === "/api/product-versions/11/automation-test-cases" &&
    method === "POST"
  ) {
    const body = JSON.parse(String(init?.body)) as {
      source_case_number: string;
      title: string;
      input: string;
      steps: string;
      expected_result: string;
    };
    const saved = automationCase({
      id: 99,
      case_number: "AUTO-000099",
      source_case_number: body.source_case_number,
      title: body.title,
      input: body.input,
      steps: body.steps,
      expected_result: body.expected_result,
      conversion_status: "manual",
      review_note: "人工新增，尚未校验。",
    });
    state.automationCases = [...(state.automationCases ?? []), saved];
    return jsonResponse(saved, 201);
  }
  if (
    url === "/api/product-versions/11/automation-test-cases/validate" &&
    method === "POST"
  ) {
    const validated = (state.automationCases ?? []).map(
      (item): AutomationTestCase => {
        const errors: string[] = [];
        if (!item.case_number.startsWith("AUTO-"))
          errors.push("自动化编号无效");
        if (!item.source_case_number.trim()) errors.push("来源编号无效");
        if (!item.title.trim()) errors.push("标题不能为空");
        if (!item.steps.trim()) errors.push("操作步骤不能为空");
        if (!item.expected_result.trim()) errors.push("预期结果不能为空");
        return {
          ...item,
          validation_status: errors.length ? "failed" : "passed",
          validation_message: errors.join("；"),
        };
      },
    );
    state.automationCases = validated;
    return jsonResponse({
      valid: validated.every((item) => item.validation_status === "passed"),
      items: validated,
    });
  }
  const caseMatch = url.match(
    /^\/api\/product-versions\/11\/automation-test-cases\/(\d+)$/,
  );
  if (caseMatch && method === "PATCH") {
    const caseId = Number(caseMatch[1]);
    const body = JSON.parse(String(init?.body)) as Partial<AutomationTestCase>;
    const current = (state.automationCases ?? []).find(
      (item) => item.id === caseId,
    );
    if (!current) return jsonResponse({ detail: "自动化用例不存在" }, 404);
    const saved: AutomationTestCase = {
      ...current,
      ...body,
      validation_status: "unvalidated",
      validation_message: "",
      updated_at: "2026-10-29T11:00:00+00:00",
    };
    state.automationCases = (state.automationCases ?? []).map((item) =>
      item.id === caseId ? saved : item,
    );
    return jsonResponse(saved);
  }
  if (caseMatch && method === "DELETE") {
    const caseId = Number(caseMatch[1]);
    state.automationCases = (state.automationCases ?? []).filter(
      (item) => item.id !== caseId,
    );
    return new Response(null, { status: 204 });
  }
  const regenerateMatch = url.match(
    /^\/api\/product-versions\/11\/automation-test-cases\/(\d+)\/regenerate$/,
  );
  if (regenerateMatch && method === "POST") {
    const caseId = Number(regenerateMatch[1]);
    const current = (state.automationCases ?? []).find(
      (item) => item.id === caseId,
    );
    if (!current) return jsonResponse({ detail: "自动化用例不存在" }, 404);
    const saved = automationCase({
      id: current.id,
      source_test_case_id: current.source_test_case_id,
      source_case_number: current.source_case_number,
      case_number: current.case_number,
    });
    state.automationCases = (state.automationCases ?? []).map((item) =>
      item.id === caseId ? saved : item,
    );
    return jsonResponse(saved);
  }
  const feedbackMatch = url.match(
    /^\/api\/product-versions\/11\/automation-test-cases\/(\d+)\/feedback$/,
  );
  if (feedbackMatch && method === "POST") {
    const caseId = Number(feedbackMatch[1]);
    const body = JSON.parse(String(init?.body)) as { feedback_input: string };
    const current = (state.automationCases ?? []).find(
      (item) => item.id === caseId,
    );
    if (!current) return jsonResponse({ detail: "自动化用例不存在" }, 404);
    if (state.feedbackAvailable) {
      const accepted: AutomationTestCase = {
        ...current,
        feedback_input: "",
        feedback_status: "accepted",
      };
      state.automationCases = (state.automationCases ?? []).map((item) =>
        item.id === caseId ? accepted : item,
      );
      return jsonResponse(null);
    }
    const unavailable: AutomationTestCase = {
      ...current,
      feedback_input: body.feedback_input,
      feedback_status: "unavailable",
    };
    state.automationCases = (state.automationCases ?? []).map((item) =>
      item.id === caseId ? unavailable : item,
    );
    return jsonResponse(
      { detail: "AI 反馈适配器不可用；已保留输入，请稍后重试或人工修改。" },
      503,
    );
  }
  const historyMatch = url.match(
    /^\/api\/product-versions\/11\/automation-test-cases\/(\d+)\/history$/,
  );
  if (historyMatch && method === "GET") {
    if (!state.automationHistory)
      return jsonResponse({ detail: "自动化用例历史不存在" }, 404);
    return jsonResponse(state.automationHistory);
  }
  return null;
}
