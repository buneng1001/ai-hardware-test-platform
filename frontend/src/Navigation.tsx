import type { PageKey } from "./appTypes";

type NavigationProps = {
  activePage: PageKey;
  onNavigate: (page: PageKey) => void;
};

export function Navigation({ activePage, onNavigate }: NavigationProps) {
  return (
    <nav aria-label="主导航" className="topbar">
      {(
        [
          ["dashboard", "仪表盘与AI配置"],
          ["new-task", "新建任务"],
          ["import", "根据导入生成"],
          ["saved", "已保存任务"],
          ["run-detail", "运行详情"],
        ] as const
      ).map(([page, label]) => (
        <button
          key={page}
          type="button"
          aria-current={activePage === page ? "page" : undefined}
          onClick={() => onNavigate(page)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
