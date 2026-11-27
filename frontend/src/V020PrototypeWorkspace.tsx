import { useEffect, useState } from "react";
import type { WorkspaceProps } from "./V020PrototypeShared";
import { CasesSection } from "./V020PrototypeCases";
import { V020DataPackagesScreen } from "./V020DataPackagesScreen";
import { V020ExecutionResultsScreen } from "./V020ExecutionResultsScreen";
import { V020TestGroupsScreen } from "./V020TestGroupsScreen";
import { V020VersionOverview } from "./V020VersionOverview";

export function WorkspaceContent(props: WorkspaceProps) {
  const { section, onOpenManual } = props;
  const versionId = props.projectWorkspace.openedVersion?.id ?? null;
  const [sourceFocus, setSourceFocus] = useState<{
    versionId: number;
    caseId: number;
  } | null>(null);
  useEffect(() => {
    if (section !== "cases") setSourceFocus(null);
  }, [section]);
  const openSource = (targetVersion: number, caseId: number) => {
    if (targetVersion !== versionId) return;
    setSourceFocus({ versionId: targetVersion, caseId });
    props.setCaseView("source");
    props.setSection("cases");
  };
  if (section === "overview")
    return <V020VersionOverview workspace={props.projectWorkspace} />;
  if (section === "cases")
    return (
      <CasesSection
        {...props}
        sourceFocusId={
          sourceFocus?.versionId === versionId ? sourceFocus.caseId : null
        }
        onOpenSource={(caseId) => {
          if (versionId !== null) openSource(versionId, caseId);
        }}
        onClearSource={() => setSourceFocus(null)}
      />
    );
  if (section === "data")
    return <V020DataPackagesScreen onNavigate={props.onNavigate} />;
  if (section === "groups")
    return (
      <V020TestGroupsScreen
        key={versionId ?? "no-version"}
        versionId={versionId}
        onOpenSource={openSource}
      />
    );
  return (
    <V020ExecutionResultsScreen
      versionId={props.projectWorkspace.openedVersion?.id ?? null}
      onOpenManual={onOpenManual}
      reportFocus={props.reportFocus}
    />
  );
}
