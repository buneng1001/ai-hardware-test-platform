import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { FrontendRoot } from "../FrontendRoot";
import type {
  TestGroupDetail,
  TestGroupDeletionImpact,
} from "../testGroupsApi";
import { projectSummary, productVersion } from "./casesFixtures";
import { jsonResponse } from "./testHttp";
import {
  groupSourceCase,
  groupSummary,
  testGroupDetail,
  withCounts,
  type GroupFixtures,
} from "./testGroupFixtures";

export type GroupStubState = GroupFixtures & {
  groups: TestGroupDetail[];
  selectedSourceIds?: number[];
  impact?: TestGroupDeletionImpact;
  failListTimes?: number;
  nextGroupId?: number;
};

function groupById(state: GroupStubState, groupId: number) {
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

/** 模拟项目、测试组、候选用例和数据包接口。 */
export function stubGroupsApi(state: GroupStubState) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/projects?"))
        return jsonResponse([projectSummary]);
      if (url === "/api/projects/1")
        return jsonResponse({
          ...projectSummary,
          product_versions: [productVersion],
        });
      if (url === "/api/projects/1/trends")
        return jsonResponse({
          project_id: 1,
          status: "empty",
          message: "尚无最终报告",
          points: [],
        });
      if (url.startsWith("/api/product-versions/11/source-test-cases"))
        return jsonResponse({ items: state.sourceCases });
      if (
        url === "/api/product-versions/11/automation-test-cases" &&
        method === "GET"
      )
        return jsonResponse({ items: state.automationCases });
      if (url === "/api/data-packages" || url.startsWith("/api/data-packages?"))
        return jsonResponse({ items: state.packages });
      return handleGroupsRequest(state, url, method, init);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function handleGroupsRequest(
  state: GroupStubState,
  url: string,
  method: string,
  init: RequestInit | undefined,
): Response {
  if (
    url.startsWith("/api/product-versions/11/test-groups") &&
    !url.includes("/test-groups/")
  ) {
    if (method === "POST") {
      const body = JSON.parse(String(init?.body)) as {
        name: string;
        description: string;
        include_selected_source_cases: boolean;
      };
      const selected = body.include_selected_source_cases
        ? (state.selectedSourceIds ?? [])
        : [];
      const id = state.nextGroupId ?? 31;
      const detail = testGroupDetail({
        id,
        name: body.name,
        description: body.description,
        source_test_cases: selected.map((sourceId, index) => {
          const source = state.sourceCases.find((item) => item.id === sourceId);
          return groupSourceCase(
            sourceId,
            source?.case_number ?? "",
            source?.title ?? "",
            { position: index + 1 },
          );
        }),
      });
      state.groups = [...state.groups, detail];
      return jsonResponse(detail, 201);
    }
    if ((state.failListTimes ?? 0) > 0) {
      state.failListTimes = (state.failListTimes ?? 0) - 1;
      return jsonResponse({ detail: "测试组服务暂时不可用" }, 500);
    }
    const query = new URL(url, "http://local").searchParams;
    const search = query.get("search")?.trim() ?? "";
    const hidden = query.get("hidden");
    let items = state.groups
      .map(groupSummary)
      .filter((item) => (search ? item.name.includes(search) : true))
      .filter((item) =>
        hidden === null ? true : String(item.hidden) === hidden,
      );
    const sort = query.get("sort");
    items = [...items].sort((left, right) => {
      if (sort === "name_asc") return left.name.localeCompare(right.name);
      if (sort === "name_desc") return right.name.localeCompare(left.name);
      return right.updated_at.localeCompare(left.updated_at);
    });
    const page = Number(query.get("page") ?? 1);
    const pageSize = Number(query.get("page_size") ?? 20);
    const start = (page - 1) * pageSize;
    return jsonResponse({
      items: items.slice(start, start + pageSize),
      page,
      page_size: pageSize,
      total: items.length,
    });
  }
  const deleteMatch = url.match(/^\/api\/test-groups\/(\d+)\?confirm=true$/);
  if (deleteMatch && method === "DELETE") {
    const groupId = Number(deleteMatch[1]);
    state.groups = state.groups.filter((item) => item.id !== groupId);
    return new Response(null, { status: 204 });
  }
  const detailMatch = url.match(/^\/api\/test-groups\/(\d+)$/);
  if (detailMatch) {
    const groupId = Number(detailMatch[1]);
    if (method === "DELETE") {
      state.groups = state.groups.filter((item) => item.id !== groupId);
      return new Response(null, { status: 204 });
    }
    if (method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as {
        name?: string;
        description?: string;
      };
      const current = groupById(state, groupId);
      return jsonResponse(replaceGroup(state, { ...current, ...body }));
    }
    return jsonResponse(groupById(state, groupId));
  }
  const hiddenMatch = url.match(/^\/api\/test-groups\/(\d+)\/(hide|restore)$/);
  if (hiddenMatch)
    return jsonResponse(
      replaceGroup(state, {
        ...groupById(state, Number(hiddenMatch[1])),
        hidden: hiddenMatch[2] === "hide",
      }),
    );
  const impactMatch = url.match(/^\/api\/test-groups\/(\d+)\/deletion-impact$/);
  if (impactMatch) {
    const detail = groupById(state, Number(impactMatch[1]));
    return jsonResponse(
      state.impact ?? {
        test_group_id: detail.id,
        name: detail.name,
        source_test_cases: detail.source_test_cases.length,
        automation_test_cases: detail.automation_test_cases.length,
        data_package_assignments: detail.data_package_assignment_count,
        manual_test_result_batches: 0,
        manual_test_results: 0,
        manual_test_result_attachments: 0,
        message:
          "删除会移除测试组范围、人工结果及其附件；不会删除平台级用例或数据包。",
      },
    );
  }
  if (
    /^\/api\/test-groups\/\d+\/automation-executions$/.test(url) &&
    method === "GET"
  )
    return jsonResponse({ items: [] });
  return handleGroupCases(state, url, method, init);
}

import { handleGroupCases } from "./testGroupCaseRoutes";

/** 进入冻结版工作区的“测试组设置”页签。 */
export async function openGroupsView() {
  render(<FrontendRoot />);
  fireEvent.click(screen.getByRole("button", { name: "开启平台" }));
  fireEvent.click(await screen.findByRole("button", { name: /IRIS 头环/ }));
  fireEvent.click(await screen.findByRole("button", { name: "测试组设置" }));
  await screen.findByRole("button", { name: "＋ 新建测试组" });
}

export function callsOf(
  fetchMock: ReturnType<typeof vi.fn>,
): Array<[RequestInfo | URL, RequestInit | undefined]> {
  return fetchMock.mock.calls as unknown as Array<
    [RequestInfo | URL, RequestInit | undefined]
  >;
}
