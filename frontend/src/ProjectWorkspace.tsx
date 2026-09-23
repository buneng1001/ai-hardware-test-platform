import { DeletionImpactDialog } from "./DeletionImpactDialog";
import { AutomationTestCasesPanel } from "./AutomationTestCasesPanel";
import { ProjectDetailPanel } from "./ProjectDetailPanel";
import { ProjectListPanel } from "./ProjectListPanel";
import { SourceTestCasesPanel } from "./SourceTestCasesPanel";
import { useProjectWorkspace } from "./useProjectWorkspace";
import "./projectWorkspace.css";

export function ProjectWorkspace() {
  const workspace = useProjectWorkspace();

  return (
    <section
      className="project-workspace"
      aria-labelledby="project-workspace-title"
    >
      <header className="workspace-header">
        <p className="eyebrow">v0.2.0 项目工作区</p>
        <h2 id="project-workspace-title">项目与产品版本</h2>
        <p>项目用于长期管理产品；产品版本用于隔离每个 Beta 版本的测试资产。</p>
      </header>
      {workspace.error && <p role="alert">{workspace.error}</p>}
      {workspace.selected && (
        <nav className="workspace-context" aria-label="项目工作区导航">
          <button
            type="button"
            onClick={() => void workspace.openProject(workspace.selected!.id)}
          >
            {workspace.selected.name}
          </button>
          <span aria-hidden="true">/</span>
          <span>{workspace.openedVersion?.version ?? "版本与趋势"}</span>
        </nav>
      )}
      <div className="workspace-grid">
        <ProjectListPanel
          projects={workspace.projects}
          busy={workspace.busy}
          onCreate={workspace.submitProject}
          onSearch={workspace.loadProjects}
          onOpen={(projectId) => void workspace.openProject(projectId)}
          onDelete={(projectId) =>
            void workspace.previewProjectDeletion(projectId)
          }
        />
        <ProjectDetailPanel
          project={workspace.selected}
          trend={workspace.trend}
          openedVersion={workspace.openedVersion}
          busy={workspace.busy}
          onCreateVersion={workspace.submitVersion}
          onOpenVersion={workspace.openVersion}
          onEditVersion={workspace.editVersion}
          onDeleteVersion={(version) =>
            void workspace.previewVersionDeletion(version)
          }
        />
      </div>
      {workspace.openedVersion && (
        <>
          <SourceTestCasesPanel productVersionId={workspace.openedVersion.id} />
          <AutomationTestCasesPanel
            productVersionId={workspace.openedVersion.id}
          />
        </>
      )}
      {workspace.pendingDeletion && workspace.dialogData && (
        <DeletionImpactDialog
          target={workspace.pendingDeletion.kind}
          versions={workspace.dialogData.versions}
          counts={workspace.dialogData.counts}
          total={workspace.dialogData.total}
          busy={workspace.busy}
          onCancel={workspace.cancelDeletion}
          onConfirm={() => void workspace.confirmDeletion()}
        />
      )}
    </section>
  );
}
