import { useEffect, useRef, useState } from "react";

import { V020DeletionImpactPanel } from "./V020DeletionImpactPanel";
import {
  defaultProductProfile,
  type ProductProfile,
  type ProjectSort,
} from "./projectsApi";
import type { V020ProjectWorkspace } from "./useV020ProjectWorkspace";
import "./V020ProjectList.css";

const sortOptions: Array<{ value: ProjectSort; label: string }> = [
  { value: "updated_desc", label: "最近更新" },
  { value: "name_asc", label: "名称升序" },
  { value: "created_asc", label: "创建时间" },
];

function formatUpdated(value: string): string {
  return value ? value.slice(0, 10) : "未知";
}

/** 只显示项目已经记录的产品配置，不推断测试类型或项目阶段。 */
function getProductFeatureTags(
  profile: ProductProfile | null | undefined,
): string[] {
  if (!profile) return [];
  const tags: string[] = [];
  if (profile.physical_keys > 0) tags.push(`按键 ×${profile.physical_keys}`);
  if (profile.indicator_lights > 0)
    tags.push(`指示灯 ×${profile.indicator_lights}`);
  if (profile.cameras > 0) tags.push(`摄像头 ×${profile.cameras}`);
  if (profile.microphone) tags.push("麦克风");
  if (profile.buzzer) tags.push("蜂鸣器");
  if (profile.platform === "web") tags.push("Web 平台");
  if (profile.platform === "app") tags.push("App 平台");
  if (profile.interfaces?.trim())
    tags.push(`接口：${profile.interfaces.trim()}`);
  return tags;
}

/** 冻结版项目列表：真实读取项目接口，并保留加载、空、失败和重试状态。 */
export function V020ProjectsScreen({
  workspace,
  onOpen,
  onBack,
}: {
  workspace: V020ProjectWorkspace;
  onOpen: (projectId: number) => void;
  onBack: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [detailOpenByProject, setDetailOpenByProject] = useState<
    Record<number, boolean>
  >({});
  const [name, setName] = useState("");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  // 产品画像：新建时描述被测产品形态，供 AI 判定与报告使用。
  const [profile, setProfile] = useState<ProductProfile>(defaultProductProfile);
  const createdNoticeRef = useRef<HTMLDivElement>(null);

  /** 新建成功后把提示和列表顶部滚进视野，避免新项目落在看不见的位置。 */
  useEffect(() => {
    if (!workspace.createdProject) return;
    const target = createdNoticeRef.current;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "start" });
    }
  }, [workspace.createdProject]);

  const resetForm = () => {
    setCreating(false);
    setName("");
    setProductName("");
    setDescription("");
    setProfile(defaultProductProfile);
  };

  const submitProject = async () => {
    const createdId = await workspace.submitProject({
      name: name.trim(),
      product_name: productName.trim(),
      description: description.trim(),
      product_profile: profile,
    });
    if (createdId === null) return;
    resetForm();
    // 创建后直接进入新项目的“版本与趋势”，不用再回列表点一次。
    onOpen(createdId);
  };

  return (
    <div className="prototype-projects">
      <div className="prototype-projects-head">
        <div>
          <h1>项目列表</h1>
          <p className="prototype-muted">
            选择一个项目进入版本、趋势和测试工作区。
          </p>
        </div>
        <div className="prototype-actions">
          <button className="prototype-secondary" onClick={onBack}>
            回到首页
          </button>
        </div>
      </div>

      <div className="prototype-filter-row prototype-project-filters">
        <div className="prototype-search-field">
          <input
            aria-label="搜索项目"
            onChange={(event) => workspace.setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void workspace.refreshProjects();
              }
            }}
            placeholder="搜索项目或产品名称"
            value={workspace.search}
          />
          {workspace.search.trim() !== "" && (
            <button
              aria-label="清空搜索框"
              className="prototype-search-clear"
              onClick={workspace.clearSearch}
              type="button"
            >
              ×
            </button>
          )}
        </div>
        <select
          aria-label="项目排序"
          onChange={(event) =>
            workspace.setSort(event.target.value as ProjectSort)
          }
          value={workspace.sort}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          aria-busy={workspace.projectsLoading}
          className="prototype-secondary"
          disabled={workspace.projectsLoading}
          onClick={() => void workspace.refreshProjects()}
          type="button"
        >
          查找
        </button>
        <button
          className="prototype-primary"
          onClick={() => setCreating(true)}
          type="button"
        >
          ＋ 新建项目
        </button>
      </div>

      {workspace.appliedSearch !== "" && (
        <div className="prototype-active-filter" aria-label="当前筛选">
          <span>当前筛选：{workspace.appliedSearch}</span>
          <button
            className="prototype-secondary"
            onClick={workspace.clearSearch}
            type="button"
          >
            清除筛选，显示全部项目
          </button>
        </div>
      )}

      {workspace.projectsLoading && workspace.projects !== null && (
        <p aria-live="polite" className="prototype-muted" role="status">
          正在查找…
        </p>
      )}

      {workspace.createdProject && (
        <div
          aria-live="polite"
          className="prototype-inline-note prototype-created-notice"
          ref={createdNoticeRef}
        >
          已创建项目「{workspace.createdProject.name}」，已排在列表最前。
          <button
            className="prototype-secondary"
            onClick={workspace.clearCreatedProject}
            type="button"
          >
            知道了
          </button>
        </div>
      )}

      {workspace.projectsError ? (
        <div className="prototype-inline-note" role="alert">
          项目列表加载失败：{workspace.projectsError}
          <button
            className="prototype-secondary"
            onClick={() => void workspace.refreshProjects()}
            type="button"
          >
            重试
          </button>
        </div>
      ) : workspace.projects === null ? (
        <p className="prototype-muted">正在加载项目…</p>
      ) : workspace.projects.length === 0 ? (
        <div className="prototype-card">
          <h3>还没有项目</h3>
          <p className="prototype-muted">
            创建项目后，可以在项目下建立多个产品版本并保存测试资产。
          </p>
        </div>
      ) : (
        workspace.projects.map((project, index) => {
          const detailsOpen = detailOpenByProject[project.id] ?? index === 0;
          return (
            <div
              aria-label={`打开项目 ${project.name}`}
              className={
                workspace.createdProject?.id === project.id
                  ? "prototype-project-card prototype-project-card--new"
                  : "prototype-project-card"
              }
              key={project.id}
              onClick={() => onOpen(project.id)}
              onKeyDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  onOpen(project.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="prototype-project-idplate" aria-hidden="true">
                <span>项目编号</span>
                <strong>PRJ-{String(project.id).padStart(4, "0")}</strong>
              </div>
              <div className="prototype-project-card-body">
                <div className="prototype-project-card-heading">
                  <div className="prototype-project-name-row">
                    <h2>{project.name}</h2>

                  </div>
                  <div className="prototype-project-card-actions">
                    <button
                      className="prototype-primary"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(project.id);
                      }}
                      type="button"
                    >
                      打开工作区
                    </button>
                    <button
                      aria-controls={`project-details-${project.id}`}
                      aria-expanded={detailsOpen}
                      className="prototype-secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDetailOpenByProject((current) => ({
                          ...current,
                          [project.id]: !detailsOpen,
                        }));
                      }}
                      type="button"
                    >
                      {detailsOpen ? "收起详情" : "查看详情"}
                    </button>
                    <details
                      className="prototype-project-more"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <summary aria-label={`更多操作：${project.name}`}>
                        更多 <span aria-hidden="true">⌄</span>
                      </summary>
                      <div className="prototype-project-more-menu">
                        <button
                          className="prototype-project-delete"
                          onClick={(event) => {
                            event.stopPropagation();
                            void workspace.previewProjectDeletion(project.id);
                          }}
                          type="button"
                        >
                          删除项目
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
                <div className="prototype-project-card-meta">
                  <div>
                    <span>被测产品</span>
                    <strong>{project.product_name || "未填写产品名称"}</strong>
                  </div>
                  <div>
                    <span>产品版本</span>
                    <strong>{project.product_version_count} 个产品版本</strong>
                  </div>
                  <div>
                    <span>最近更新</span>
                    <strong>{formatUpdated(project.updated_at)}</strong>
                  </div>
                </div>
              </div>
              {detailsOpen && (
                <div
                  className="prototype-project-card-details"
                  id={`project-details-${project.id}`}
                >
                  <div className="prototype-project-card-description">
                    <span>项目简介</span>
                    <p>{project.description || "暂无项目说明"}</p>
                  </div>
                  <div className="prototype-project-card-tags">
                    <span className="prototype-project-card-tags-label">
                      项目信息
                    </span>
                    <div className="prototype-project-tag-list">
                      <span className="prototype-project-tag">
                        产品版本 · {project.product_version_count}
                      </span>
                      {getProductFeatureTags(project.product_profile).map(
                        (tag) => (
                          <span className="prototype-project-tag" key={tag}>
                            {tag}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      {workspace.actionError && (
        <div className="prototype-inline-note" role="alert">
          {workspace.actionError}
        </div>
      )}

      <V020DeletionImpactPanel workspace={workspace} />

      {creating && (
        // 新建项目改用弹窗，避免表单在页面底部弹开把列表挤得跳动。
        <div className="prototype-modal-backdrop">
          <form
            aria-label="新建项目"
            className="prototype-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void submitProject();
            }}
          >
            <h3>新建项目</h3>
            <p className="prototype-muted">
              只填项目名称和产品名称即可，之后可以在项目下建立产品版本。
            </p>
            <label>
              项目名称
              <input
                aria-label="项目名称"
                autoFocus
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：IRIS 头环"
                value={name}
              />
            </label>
            <label>
              产品名称
              <input
                aria-label="产品名称"
                maxLength={60}
                onChange={(event) => setProductName(event.target.value)}
                placeholder="例如：多传感器记录设备"
                value={productName}
              />
            </label>
            <label>
              项目说明
              <input
                aria-label="项目说明"
                maxLength={200}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="可选"
                value={description}
              />
            </label>
            <fieldset className="prototype-project-profile">
              <legend>被测产品画像（决定 AI 判断与报告内容）</legend>
              <div className="prototype-filter-row">
                <label>
                  实体按键
                  <input
                    aria-label="实体按键数量"
                    min={0}
                    max={999}
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        physical_keys: Number(event.target.value) || 0,
                      })
                    }
                    type="number"
                    value={profile.physical_keys}
                  />
                </label>
                <label>
                  指示灯
                  <input
                    aria-label="指示灯数量"
                    min={0}
                    max={999}
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        indicator_lights: Number(event.target.value) || 0,
                      })
                    }
                    type="number"
                    value={profile.indicator_lights}
                  />
                </label>
                <label>
                  摄像头
                  <input
                    aria-label="摄像头数量"
                    min={0}
                    max={999}
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        cameras: Number(event.target.value) || 0,
                      })
                    }
                    type="number"
                    value={profile.cameras}
                  />
                </label>
                <label className="prototype-inline-check">
                  <input
                    aria-label="有麦克风"
                    checked={profile.microphone}
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        microphone: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  麦克风
                </label>
                <label className="prototype-inline-check">
                  <input
                    aria-label="有提示音"
                    checked={profile.buzzer}
                    onChange={(event) =>
                      setProfile({ ...profile, buzzer: event.target.checked })
                    }
                    type="checkbox"
                  />
                  提示音
                </label>
              </div>
              <label>
                通信接口
                <input
                  aria-label="通信接口"
                  maxLength={100}
                  onChange={(event) =>
                    setProfile({ ...profile, interfaces: event.target.value })
                  }
                  placeholder="例如：USB、WiFi、蓝牙、ADB"
                  value={profile.interfaces}
                />
              </label>
              <label>
                测试环境
                <input
                  aria-label="测试环境"
                  maxLength={120}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      test_environment: event.target.value,
                    })
                  }
                  value={profile.test_environment}
                />
              </label>
              <label>
                测试平台
                <select
                  aria-label="测试平台"
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      platform: event.target
                        .value as ProductProfile["platform"],
                    })
                  }
                  value={profile.platform}
                >
                  <option value="none">无（纯硬件）</option>
                  <option value="web">网页 / 后台</option>
                  <option value="app">手机 App</option>
                </select>
              </label>
              {profile.platform === "web" && (
                <label>
                  网站地址
                  <input
                    aria-label="网站地址"
                    maxLength={200}
                    onChange={(event) =>
                      setProfile({ ...profile, web_url: event.target.value })
                    }
                    placeholder="例如：https://example.com"
                    value={profile.web_url}
                  />
                </label>
              )}
              {profile.platform === "app" && (
                <label>
                  App 安装包名称
                  <input
                    aria-label="App 安装包"
                    maxLength={120}
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        app_package: event.target.value,
                      })
                    }
                    placeholder="填写安装包文件名"
                    value={profile.app_package}
                  />
                </label>
              )}
            </fieldset>
            <div className="prototype-actions">
              <button
                className="prototype-secondary"
                onClick={resetForm}
                type="button"
              >
                取消
              </button>
              <button
                className="prototype-primary"
                disabled={!name.trim() || !productName.trim() || workspace.busy}
              >
                创建项目
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
