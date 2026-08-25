import type { Scenario } from "./collectionTasksApi";

export type AiEvaluationResult = {
  status: "evaluated" | "not_evaluated";
  structure_valid: boolean;
  scenario: Scenario;
  expected_fault_types: string[];
  diagnosed_fault_types: string[];
  hit_fault_types: string[];
  missed_fault_types: string[];
  hit_count: number;
  missed_count: number;
  unsupported_speculation_count: number;
  false_positive_count: number;
  reason: string | null;
  summary: string;
};

export type DiagnosisRun = {
  id: number;
  run_id: number;
  status: "pending" | "generating" | "completed" | "failed";
  model: string;
  prompt_version: string;
  is_mock: boolean;
  evidence_package: {
    items: Array<{
      ref: string;
      kind: string;
      source: string;
      content: string;
      size_bytes: number;
      estimated_tokens: number;
    }>;
    total_bytes: number;
    estimated_tokens: number;
    max_bytes: number;
    max_tokens: number;
    truncated: boolean;
  };
  output: {
    diagnosis_status: "completed" | "failed";
    phenomena: Array<{ description: string; evidence_refs: string[] }>;
    possible_causes: Array<{
      cause: string;
      evidence_refs: string[];
      confidence: "high" | "medium" | "low";
      is_speculation: boolean;
    }>;
    impact_scope: string[];
    retest_recommendations: string[];
    missing_evidence: string[];
    uncertainties: string[];
    limitations: string[];
  } | null;
  evaluation: AiEvaluationResult | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

export type DiagnosisMode = "mock" | "siliconflow";

export async function listDiagnoses(runId: number): Promise<DiagnosisRun[]> {
  const response = await fetch(`/api/runs/${runId}/diagnoses`);
  if (!response.ok) throw new Error("诊断历史加载失败");
  return (await response.json()) as DiagnosisRun[];
}

export async function createDiagnosis(
  runId: number,
  mode: DiagnosisMode,
  model: string,
  apiKey: string,
): Promise<DiagnosisRun> {
  const response = await fetch(`/api/runs/${runId}/diagnoses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, model, api_key: apiKey }),
  });
  if (!response.ok) throw new Error("结构化诊断生成失败");
  return (await response.json()) as DiagnosisRun;
}
