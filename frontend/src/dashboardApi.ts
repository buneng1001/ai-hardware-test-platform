export type Dashboard = {
  generated_at: string;
  run_statistics: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    interrupted: number;
  };
  recent_failures: Array<{
    run_id: number;
    scenario: string;
    status: string;
    error: string | null;
    failed_check_count: number;
    latest_diagnosis_status: string | null;
  }>;
  diagnosis_status_counts: Record<string, number>;
  evaluation_summary: {
    evaluated_runs: number;
    hit_count: number;
    missed_count: number;
    unsupported_speculation_count: number;
    false_positive_count: number;
  };
};

export async function getDashboard(): Promise<Dashboard> {
  const response = await fetch("/api/dashboard");
  if (!response.ok) throw new Error("仪表盘加载失败");
  return (await response.json()) as Dashboard;
}
