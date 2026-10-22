import type { EvidenceBundle, RunDetail } from "./types";

// A cutoff run must never fall back to the original, potentially future-bearing input pack.
export function presentationForRun(
  detail: RunDetail | null | undefined,
): EvidenceBundle | null {
  if (!detail) return null;
  if (detail.presentation) return detail.presentation;
  if (detail.run.as_of) return null;
  return detail.bundle ?? null;
}
