import { request } from "./apiClient";
import type { Scenario } from "./collectionTasksApi";

export type DataPackageSource = "generated" | "imported";
export type DataPackageKind = "normal" | "fault";
export type DataPackageValidation = "passed" | "failed";

export type DataPackageFile = {
  kind: string;
  path: string;
  size_bytes: number;
  sha256: string;
  codec: string | null;
  start_raw_device_timestamp_ns: number | null;
};

export type DataPackage = {
  id: number;
  package_number: string;
  source_task_id: number;
  source_task_name: string;
  source_run_id: number;
  source_run_execution_number: number;
  source_type: DataPackageSource;
  data_kind: DataPackageKind;
  fault_type: Exclude<Scenario, "normal"> | null;
  version_fingerprint: string;
  generated_at: string;
  validation_status: DataPackageValidation;
  validation_message: string;
  channels: string[];
  timestamps: Record<string, string | number | null>;
  integrity: {
    status: DataPackageValidation;
    checked_file_count: number;
    missing_files: string[];
    size_mismatches: string[];
  };
  eligible_for_test_group: boolean;
  has_newer_source_result: boolean;
  recommended_source_run_id: number | null;
  files: DataPackageFile[];
};

export type DataPackageFilters = {
  source_type?: DataPackageSource;
  data_kind?: DataPackageKind;
  fault_type?: Exclude<Scenario, "normal">;
};

export type DataPackageDeletionImpact = {
  data_package_id: number;
  package_number: string;
  association_counts: Record<string, number>;
  total_associations: number;
};

export function listDataPackages(filters: DataPackageFilters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<{ items: DataPackage[] }>(`/api/data-packages${suffix}`);
}

export function getDataPackage(packageId: number) {
  return request<DataPackage>(`/api/data-packages/${packageId}`);
}

export function registerCompletedDataPackages() {
  return request<{ items: DataPackage[] }>(
    "/api/data-packages/register-completed-runs",
    { method: "POST" },
  );
}

export function getDataPackageDeletionImpact(packageId: number) {
  return request<DataPackageDeletionImpact>(
    `/api/data-packages/${packageId}/deletion-impact`,
  );
}

export function deleteDataPackage(packageId: number) {
  return request<void>(`/api/data-packages/${packageId}?confirm=true`, {
    method: "DELETE",
  });
}
