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
  manual_test_result_batches: number;
  manual_test_results: number;
  manual_test_result_attachments: number;
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
  status: "empty" | "filtered_empty" | "single" | "ready";
  message: string;
  points: ProjectTrendPoint[];
};

export type ResultCounts = {
  passed: number;
  failed: number;
  blocked: number;
  not_executed: number;
};

export type ResultSourceCounts = {
  automation: ResultCounts;
  manual: ResultCounts;
};

export type ProjectTrendPoint = {
  report_id: number;
  product_version_id: number;
  product_version: string;
  test_group_id: number;
  test_group: string;
  created_at: string;
  lifecycle_status: "current" | "stale" | "superseded";
  counts: ResultSourceCounts;
  modules: Array<{
    name: string;
    conclusion: string;
    counts: ResultSourceCounts;
  }>;
};

export type ReportComparison = {
  project_id: number;
  left: {
    kind: "report" | "product_version";
    id: number;
    label: string;
    report_ids: number[];
  };
  right: {
    kind: "report" | "product_version";
    id: number;
    label: string;
    report_ids: number[];
  };
  counts: { left: ResultSourceCounts; right: ResultSourceCounts };
  modules: Array<{
    name: string;
    left: ResultSourceCounts;
    right: ResultSourceCounts;
    left_conclusion: string;
    right_conclusion: string;
  }>;
  added_modules: string[];
  removed_modules: string[];
  added_scope: Array<{
    case_number: string;
    title: string;
    module: string;
    sources: string[];
  }>;
  removed_scope: Array<{
    case_number: string;
    title: string;
    module: string;
    sources: string[];
  }>;
  unaligned_scope: Array<{
    case_number: string;
    left_modules: string[];
    right_modules: string[];
  }>;
  unresolved_risk_modules: string[];
};

export type ProjectSort = "updated_desc" | "name_asc" | "created_asc";

export type ProjectCommand = {
  name: string;
  product_name: string;
  description: string;
};

export type VersionCommand = {
  version: string;
  name: string;
  description: string;
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

export function listProjects(search = "", sort: ProjectSort = "updated_desc") {
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

export function getProjectTrend(
  projectId: number,
  filters: {
    productVersionId?: string;
    module?: string;
    testGroupId?: string;
    caseNumber?: string;
  } = {},
) {
  const query = new URLSearchParams();
  if (filters.productVersionId)
    query.set("product_version_id", filters.productVersionId);
  if (filters.module?.trim()) query.set("module", filters.module.trim());
  if (filters.testGroupId) query.set("test_group_id", filters.testGroupId);
  if (filters.caseNumber?.trim())
    query.set("case_number", filters.caseNumber.trim());
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<ProjectTrend>(`/api/projects/${projectId}/trends${suffix}`);
}

export function compareProjectReports(
  projectId: number,
  command:
    | { left_report_id: number; right_report_id: number }
    | { left_product_version_id: number; right_product_version_id: number },
) {
  return request<ReportComparison>(
    `/api/projects/${projectId}/report-comparisons`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(command),
    },
  );
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
