export type ProductVersion = {
  id: number;
  project_id: number;
  version: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type ProjectSummary = {
  id: number;
  name: string;
  product_name: string;
  description: string;
  product_version_count: number;
  created_at: string;
  updated_at: string;
};

export type ProjectDetail = ProjectSummary & {
  product_versions: ProductVersion[];
};

export type AssetCounts = {
  source_test_cases: number;
  automation_test_cases: number;
  data_packages: number;
  test_groups: number;
  automation_execution_records: number;
  manual_test_records: number;
  online_reports: number;
};

export type ProjectDeletionImpact = {
  project_id: number;
  product_versions: Array<{ id: number; version: string; name: string }>;
  asset_counts: AssetCounts;
  total_affected_assets: number;
};

export type VersionDeletionImpact = {
  product_version: { id: number; version: string; name: string };
  asset_counts: AssetCounts;
  total_affected_assets: number;
};

export type ProjectTrend = {
  project_id: number;
  status: "empty";
  message: string;
  points: Array<Record<string, unknown>>;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(url, init) : await fetch(url);
  if (!response.ok) {
    let message = "请求失败";
    try {
      const payload = (await response.json()) as { detail?: string };
      message = payload.detail ?? message;
    } catch {
      // 非 JSON 错误响应使用通用提示。
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const jsonHeaders = { "Content-Type": "application/json" };

export function listProjects(search = "", sort = "updated_desc") {
  const query = new URLSearchParams({ search, sort });
  return request<ProjectSummary[]>(`/api/projects?${query.toString()}`);
}

export function createProject(command: {
  name: string;
  product_name: string;
  description: string;
}) {
  return request<ProjectDetail>("/api/projects", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(command),
  });
}

export function getProject(projectId: number) {
  return request<ProjectDetail>(`/api/projects/${projectId}`);
}

export function getProjectTrend(projectId: number) {
  return request<ProjectTrend>(`/api/projects/${projectId}/trends`);
}

export function createProductVersion(
  projectId: number,
  command: { version: string; name: string; description: string },
) {
  return request<ProductVersion>(
    `/api/projects/${projectId}/product-versions`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(command),
    },
  );
}

export function updateProductVersion(
  versionId: number,
  command: { name: string; description: string },
) {
  return request<ProductVersion>(`/api/product-versions/${versionId}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify(command),
  });
}

export function getProjectDeletionImpact(projectId: number) {
  return request<ProjectDeletionImpact>(
    `/api/projects/${projectId}/deletion-impact`,
  );
}

export function getVersionDeletionImpact(versionId: number) {
  return request<VersionDeletionImpact>(
    `/api/product-versions/${versionId}/deletion-impact`,
  );
}

export function deleteProject(projectId: number) {
  return request<void>(`/api/projects/${projectId}?confirm=true`, {
    method: "DELETE",
  });
}

export function deleteProductVersion(versionId: number) {
  return request<void>(`/api/product-versions/${versionId}?confirm=true`, {
    method: "DELETE",
  });
}
