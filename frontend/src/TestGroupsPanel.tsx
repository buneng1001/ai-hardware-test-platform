import { useCallback, useEffect, useState } from "react";

import { TestGroupDetailPanel } from "./TestGroupDetailPanel";
import {
  createTestGroup,
  getTestGroup,
  listTestGroups,
  type TestGroupDetail,
  type TestGroupPage,
} from "./testGroupsApi";

export function TestGroupsPanel({
  productVersionId,
}: {
  productVersionId: number;
}) {
  const [page, setPage] = useState<TestGroupPage | null>(null);
  const [opened, setOpened] = useState<TestGroupDetail | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("updated_desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [showHidden, setShowHidden] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    includeSelected: true,
  });
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPage(
        await listTestGroups(productVersionId, {
          search,
          sort,
          hidden: showHidden ? undefined : false,
          page: currentPage,
        }),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试组加载失败");
    }
  }, [productVersionId, search, showHidden, sort, currentPage]);
  useEffect(() => {
    void load();
    setOpened(null);
  }, [load]);
  const refreshDetail = async (detail: TestGroupDetail) => {
    setOpened(detail);
    await load();
  };

  return (
    <section className="test-groups-panel" aria-labelledby="test-groups-title">
      <div className="test-group-heading">
        <div>
          <h3 id="test-groups-title">测试组</h3>
          <p>
            一个产品版本可维护多个测试范围；创建时可带入当前待加入的原始用例清单。
          </p>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      <form
        className="test-group-edit"
        onSubmit={(event) => {
          event.preventDefault();
          void createTestGroup(productVersionId, {
            name: draft.name,
            description: draft.description,
            include_selected_source_cases: draft.includeSelected,
          }).then(
            (detail) => {
              setDraft({ name: "", description: "", includeSelected: true });
              void refreshDetail(detail);
            },
            (error: unknown) =>
              setMessage(
                error instanceof Error ? error.message : "测试组创建失败",
              ),
          );
        }}
      >
        <label>
          测试组名称
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </label>
        <label>
          说明
          <textarea
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.includeSelected}
            onChange={(event) =>
              setDraft({ ...draft, includeSelected: event.target.checked })
            }
          />{" "}
          带入待加入的原始用例
        </label>
        <button type="submit">新建测试组</button>
      </form>
      <div className="test-group-filters">
        <label>
          排序
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="updated_desc">最近更新</option>
            <option value="name_asc">名称 A–Z</option>
            <option value="name_desc">名称 Z–A</option>
          </select>
        </label>
        <label>
          搜索
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />{" "}
          显示已隐藏测试组
        </label>
      </div>
      {page?.items.map((item) => (
        <article className="test-group-card" key={item.id}>
          <button
            type="button"
            onClick={() => void getTestGroup(item.id).then(setOpened)}
          >
            {item.name}
          </button>
          <span>
            {item.hidden ? "已隐藏" : "显示中"} · 原始{" "}
            {item.source_test_case_count} · 自动化{" "}
            {item.automation_test_case_count} · 关联{" "}
            {item.data_package_assignment_count}
          </span>
        </article>
      ))}
      {page && page.items.length === 0 && <p>尚无符合条件的测试组。</p>}
      {page && page.total > page.page_size && (
        <div className="workspace-actions">
          <button
            type="button"
            disabled={page.page === 1}
            onClick={() => setCurrentPage((value) => value - 1)}
          >
            上一页
          </button>
          <span>第 {page.page} 页</span>
          <button
            type="button"
            disabled={page.page * page.page_size >= page.total}
            onClick={() => setCurrentPage((value) => value + 1)}
          >
            下一页
          </button>
        </div>
      )}
      {opened && (
        <TestGroupDetailPanel
          detail={opened}
          onChange={(detail) => void refreshDetail(detail)}
          onDeleted={() => {
            setOpened(null);
            void load();
          }}
        />
      )}
    </section>
  );
}
