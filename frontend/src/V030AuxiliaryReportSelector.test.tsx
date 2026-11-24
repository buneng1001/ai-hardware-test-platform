import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { V030AuxiliaryReportSelector } from "./V030AuxiliaryReportSelector";

const options = [
  {
    id: 21,
    product_version: "EVT2",
    test_group: "Camera",
    created_at: "2026-11-20T10:00:00Z",
    analysis_status: "failed",
  },
  {
    id: 19,
    product_version: "EVT1",
    test_group: "Audio",
    created_at: "2026-11-18T10:00:00Z",
    analysis_status: "completed",
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("tags, search/version intersection, selected exclusion and empty states", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(new Response(JSON.stringify({ items: options }))),
    ),
  );
  render(<V030AuxiliaryReportSelector reportId={23} />);
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "搜索 / 选择辅助报告" }));
  await screen.findByRole("option", { name: /EVT2.*Camera/ });
  fireEvent.change(screen.getByRole("textbox", { name: "搜索辅助报告" }), {
    target: { value: "Camera" },
  });
  expect(screen.getAllByRole("option", { name: /Camera/ })).toHaveLength(1);
  fireEvent.change(screen.getByRole("combobox", { name: "辅助报告版本筛选" }), {
    target: { value: "EVT1" },
  });
  expect(screen.getByText(/没有找到符合条件的报告/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清除搜索和筛选" }));
  fireEvent.click(screen.getByRole("option", { name: /EVT2.*Camera/ }));
  expect(screen.queryByRole("option", { name: /EVT2.*Camera/ })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索辅助报告" }), {
    target: { value: "does not exist" },
  });
  expect(screen.getByRole("button", { name: "移除辅助报告 #21" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "移除辅助报告 #21" }));
  expect(screen.queryByRole("button", { name: "移除辅助报告 #21" })).toBeNull();
});

test("empty candidates do not block validation, failed validation permits remove", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(
      new Response(
        init?.method === "POST"
          ? JSON.stringify({ detail: "invalid report" })
          : JSON.stringify({ items: [] }),
        {
          status: init?.method === "POST" ? 422 : 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<V030AuxiliaryReportSelector reportId={23} />);
  fireEvent.click(screen.getByRole("button", { name: "搜索 / 选择辅助报告" }));
  await screen.findByText(/当前项目暂无可选的其他最终测试报告/);
  fireEvent.click(screen.getByRole("button", { name: "校验辅助报告选择" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "移除失效选择" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "移除失效选择" }));
  expect(screen.queryByRole("button", { name: "移除失效选择" })).toBeNull();
});
