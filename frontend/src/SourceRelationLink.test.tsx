import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SourceRelationLink } from "./SourceRelationLink";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup(sourceId: number | null = 4) {
  const onOpen = vi.fn();
  const view = render(
    <SourceRelationLink
      versionId={11}
      automationId={7}
      sourceId={sourceId}
      label="来源用例"
      onOpen={onOpen}
    />,
  );
  return { onOpen, ...view };
}
test.each([401, 403, 404, 410])(
  "来源不可访问 %s 不跳转、不显示服务端信息",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "secret" }), { status }),
        ),
    );
    const { onOpen } = setup();
    fireEvent.click(screen.getByRole("link"));
    expect(await screen.findByText("来源用例不可用")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("secret")).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  },
);
test.each([
  { source_test_case_id: 5, product_version_id: 11 },
  { source_test_case_id: 4, product_version_id: 12 },
])("拒绝旧缓存或不同版本", async (target) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(target))),
  );
  const { onOpen } = setup();
  fireEvent.click(screen.getByRole("link"));
  expect(await screen.findByText("来源用例不可用")).toBeVisible();
  expect(onOpen).not.toHaveBeenCalled();
});
test("缺失来源 ID 直接禁用", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setup(null);
  expect(screen.getByText("来源用例不可用")).toBeVisible();
  expect(screen.queryByRole("link")).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
test("超时可重试，迟到响应不导航", async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ source_test_case_id: 4, product_version_id: 11 }),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  const { onOpen } = setup();
  fireEvent.click(screen.getByRole("link"));
  expect(screen.getByText("关联信息加载中…")).toBeVisible();
  await act(async () => {
    vi.advanceTimersByTime(8000);
  });
  expect(screen.getByText("关联信息加载失败，请重试")).toBeVisible();
  await act(async () => {
    finish(
      new Response(
        JSON.stringify({ source_test_case_id: 4, product_version_id: 11 }),
      ),
    );
  });
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
  });
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(4);
});
test("网络失败重试，卸载后拒绝迟到响应", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new Error("secret"))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
  );
  const { onOpen, unmount } = setup();
  fireEvent.click(screen.getByRole("link"));
  expect(await screen.findByText("关联信息加载失败，请重试")).toBeVisible();
  expect(screen.queryByText("secret")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  unmount();
  await act(async () => {
    finish(
      new Response(
        JSON.stringify({ source_test_case_id: 4, product_version_id: 11 }),
      ),
    );
  });
  expect(onOpen).not.toHaveBeenCalled();
});
