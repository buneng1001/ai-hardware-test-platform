import type {
  ManualTestResultBatch,
  ManualTestResultPage,
  ManualTestStatus,
} from "./manualTestResultsApi";

export type ManualTestResultDraft = {
  status: ManualTestStatus;
  actualResult: string;
  notes: string;
  executedAt: string;
  attachment: File | null;
};

export function draftsFor(
  page: ManualTestResultPage,
  batch: ManualTestResultBatch | undefined,
) {
  return Object.fromEntries(
    page.cases.map((item) => {
      const result = batch?.results.find(
        (saved) => saved.source_test_case_id === item.id,
      );
      return [
        item.id,
        {
          status: result?.status ?? "not_executed",
          actualResult: result?.actual_result ?? "",
          notes: result?.notes ?? "",
          executedAt: result?.executed_at
            ? result.executed_at.slice(0, 16)
            : "",
          attachment: null,
        } satisfies ManualTestResultDraft,
      ];
    }),
  ) as Record<number, ManualTestResultDraft>;
}
