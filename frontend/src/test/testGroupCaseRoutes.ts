import type { TestGroupDetail } from "../testGroupsApi";
import {
  assignedPackage,
  groupAutomationCase,
  groupSourceCase,
  withCounts,
} from "./testGroupFixtures";
import type { GroupStubState } from "./testGroupsHarness";
import { jsonResponse } from "./testHttp";

function groupById(state: GroupStubState, groupId: number): TestGroupDetail {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) throw new Error(`测试组不存在：${groupId}`);
  return group;
}

function replaceGroup(state: GroupStubState, detail: TestGroupDetail) {
  const next = withCounts(detail);
  state.groups = state.groups.map((item) =>
    item.id === next.id ? next : item,
  );
  return next;
}

export function handleGroupCases(
  state: GroupStubState,
  url: string,
  method: string,
  init: RequestInit | undefined,
): Response {
  const sourceAdd = url.match(/^\/api\/test-groups\/(\d+)\/source-test-cases$/);
  if (sourceAdd && method === "POST") {
    const groupId = Number(sourceAdd[1]);
    const body = JSON.parse(String(init?.body)) as { case_ids: number[] };
    const current = groupById(state, groupId);
    const start = current.source_test_cases.length;
    const additions = body.case_ids.map((caseId, index) => {
      const source = state.sourceCases.find((item) => item.id === caseId);
      return groupSourceCase(
        caseId,
        source?.case_number ?? "",
        source?.title ?? "",
        {
          position: start + index + 1,
        },
      );
    });
    return jsonResponse(
      replaceGroup(state, {
        ...current,
        source_test_cases: [...current.source_test_cases, ...additions],
      }),
    );
  }
  const sourceRemove = url.match(
    /^\/api\/test-groups\/(\d+)\/source-test-cases\/(\d+)$/,
  );
  if (sourceRemove && method === "DELETE") {
    const current = groupById(state, Number(sourceRemove[1]));
    replaceGroup(state, {
      ...current,
      source_test_cases: current.source_test_cases.filter(
        (item) => item.id !== Number(sourceRemove[2]),
      ),
    });
    return new Response(null, { status: 204 });
  }
  const automationAdd = url.match(
    /^\/api\/test-groups\/(\d+)\/automation-test-cases$/,
  );
  if (automationAdd && method === "POST") {
    const current = groupById(state, Number(automationAdd[1]));
    const body = JSON.parse(String(init?.body)) as { case_ids: number[] };
    const invalid = body.case_ids.some(
      (caseId) =>
        state.automationCases.find((item) => item.id === caseId)
          ?.validation_status !== "passed",
    );
    if (invalid)
      return jsonResponse(
        { detail: "自动化用例必须属于当前版本且已校验通过" },
        422,
      );
    const start = current.automation_test_cases.length;
    const additions = body.case_ids.map((caseId, index) => {
      const candidate = state.automationCases.find(
        (item) => item.id === caseId,
      );
      return groupAutomationCase(caseId, candidate?.case_number ?? "", {
        title: candidate?.title ?? "",
        position: start + index + 1,
      });
    });
    return jsonResponse(
      replaceGroup(state, {
        ...current,
        automation_test_cases: [...current.automation_test_cases, ...additions],
      }),
    );
  }
  const automationRemove = url.match(
    /^\/api\/test-groups\/(\d+)\/automation-test-cases\/(\d+)$/,
  );
  if (automationRemove && method === "DELETE") {
    const current = groupById(state, Number(automationRemove[1]));
    replaceGroup(state, {
      ...current,
      automation_test_cases: current.automation_test_cases.filter(
        (item) => item.id !== Number(automationRemove[2]),
      ),
    });
    return new Response(null, { status: 204 });
  }
  const orderMatch = url.match(
    /^\/api\/test-groups\/(\d+)\/(source-test-cases|automation-test-cases)\/order$/,
  );
  if (orderMatch && method === "PUT") {
    const current = groupById(state, Number(orderMatch[1]));
    const body = JSON.parse(String(init?.body)) as { case_ids: number[] };
    if (orderMatch[2] === "source-test-cases") {
      const ordered = body.case_ids.map((caseId, index) => {
        const item = current.source_test_cases.find(
          (entry) => entry.id === caseId,
        )!;
        return { ...item, position: index + 1 };
      });
      return jsonResponse(
        replaceGroup(state, { ...current, source_test_cases: ordered }),
      );
    }
    const ordered = body.case_ids.map((caseId, index) => {
      const item = current.automation_test_cases.find(
        (entry) => entry.id === caseId,
      )!;
      return { ...item, position: index + 1 };
    });
    return jsonResponse(
      replaceGroup(state, { ...current, automation_test_cases: ordered }),
    );
  }
  const bulkMatch = url.match(
    /^\/api\/test-groups\/(\d+)\/data-package-assignments$/,
  );
  if (bulkMatch && method === "POST") {
    const current = groupById(state, Number(bulkMatch[1]));
    const body = JSON.parse(String(init?.body)) as {
      automation_test_case_ids: number[];
      data_package_id: number;
    };
    const packageItem = state.packages.find(
      (item) => item.id === body.data_package_id,
    );
    if (!packageItem)
      return jsonResponse({ detail: "只能关联已校验通过的数据包" }, 422);
    return jsonResponse(
      replaceGroup(state, {
        ...current,
        automation_test_cases: current.automation_test_cases.map((item) =>
          body.automation_test_case_ids.includes(item.id)
            ? {
                ...item,
                data_packages: [
                  ...item.data_packages,
                  assignedPackage(packageItem.id, packageItem.package_number),
                ],
              }
            : item,
        ),
      }),
    );
  }
  const packagesMatch = url.match(
    /^\/api\/test-groups\/(\d+)\/automation-test-cases\/(\d+)\/data-packages$/,
  );
  if (packagesMatch && method === "PUT") {
    const current = groupById(state, Number(packagesMatch[1]));
    const body = JSON.parse(String(init?.body)) as {
      data_package_ids: number[];
    };
    return jsonResponse(
      replaceGroup(state, {
        ...current,
        automation_test_cases: current.automation_test_cases.map((item) =>
          item.id === Number(packagesMatch[2])
            ? {
                ...item,
                data_packages: body.data_package_ids.map((packageId) => {
                  const packageItem = state.packages.find(
                    (entry) => entry.id === packageId,
                  )!;
                  return assignedPackage(
                    packageItem.id,
                    packageItem.package_number,
                  );
                }),
              }
            : item,
        ),
      }),
    );
  }
  return jsonResponse({ detail: "未模拟的接口" }, 404);
}
