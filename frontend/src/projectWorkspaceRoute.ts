export type ProjectWorkspaceRoute = {
  projectId: number;
  versionId?: number;
};

export function projectWorkspaceRouteFromHash(): ProjectWorkspaceRoute | null {
  const match = window.location.hash.match(
    /^#projects\/(\d+)(?:\/versions\/(\d+))?$/,
  );
  return match
    ? {
        projectId: Number(match[1]),
        versionId: match[2] ? Number(match[2]) : undefined,
      }
    : null;
}

export function projectWorkspaceHash(projectId: number, versionId?: number) {
  return versionId === undefined
    ? `#projects/${projectId}`
    : `#projects/${projectId}/versions/${versionId}`;
}
