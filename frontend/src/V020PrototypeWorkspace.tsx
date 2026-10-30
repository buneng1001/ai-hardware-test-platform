import type { WorkspaceProps } from "./V020PrototypeShared";
import { CasesSection } from "./V020PrototypeCases";
import { V020DataPackagesScreen } from "./V020DataPackagesScreen";
import { V020ExecutionResultsScreen } from "./V020ExecutionResultsScreen";
import { V020TestGroupsScreen } from "./V020TestGroupsScreen";
import { V020VersionOverview } from "./V020VersionOverview";

export function WorkspaceContent(props: WorkspaceProps) {
  const { section, onOpenManual } = props;
  if (section === "overview")
    return <V020VersionOverview workspace={props.projectWorkspace} />;
  if (section === "cases") return <CasesSection {...props} />;
  if (section === "data")
    return <V020DataPackagesScreen onNavigate={props.onNavigate} />;
  if (section === "groups")
    return (
      <V020TestGroupsScreen
        versionId={props.projectWorkspace.openedVersion?.id ?? null}
      />
    );
  return (
    <V020ExecutionResultsScreen
      versionId={props.projectWorkspace.openedVersion?.id ?? null}
      onOpenManual={onOpenManual}
    />
  );
}
