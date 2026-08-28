import { makeSeedRun, seedInvestigation } from "./seed";
import type { Investigation, ResearchRun } from "./types";

const API_BASE = (process.env.NEXT_PUBLIC_RESEARCH_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const API_PREFIX = `${API_BASE}/api/v1`;

export const researchApiBase = API_BASE;

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_500);
  try {
    const response = await fetch(`${API_PREFIX}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Research service returned ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export type StageUpdate = {
  stage: string;
  label: string;
  progress: number;
};

export async function runInvestigation(
  query: string,
  onStage?: (stage: StageUpdate) => void,
): Promise<{ investigation: Investigation; run: ResearchRun; fallback: boolean }> {
  const stages: StageUpdate[] = [
    { stage: "intent", label: "Understanding the question", progress: 12 },
    { stage: "retrieval", label: "Retrieving prediction markets", progress: 34 },
    { stage: "relations", label: "Checking market relationships", progress: 61 },
    { stage: "analysis", label: "Aggregating comparable evidence", progress: 82 },
    { stage: "verification", label: "Verifying the market-implied answer", progress: 96 },
  ];

  stages[0] && onStage?.(stages[0]);
  try {
    const investigation = await apiFetch<Investigation>("/investigations", {
      method: "POST",
      body: JSON.stringify({ query, refresh_policy: "manual", deep_mode: false }),
    });
    stages[1] && onStage?.(stages[1]);
    let run = await apiFetch<ResearchRun>(`/investigations/${investigation.id}/runs`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    for (let attempt = 0; attempt < 40 && !["completed", "failed"].includes(run.status); attempt += 1) {
      const stage = stages[Math.min(stages.length - 1, Math.floor((attempt + 1) / 9) + 1)];
      if (stage) onStage?.(stage);
      await new Promise((resolve) => setTimeout(resolve, 450));
      run = await apiFetch<ResearchRun>(`/runs/${run.id}`);
    }
    if (run.status !== "completed" || !run.answer) {
      throw new Error(run.error || "Research run did not complete");
    }
    onStage?.({ stage: "complete", label: "Investigation complete", progress: 100 });
    return { investigation, run, fallback: false };
  } catch {
    for (const stage of stages.slice(1)) {
      onStage?.(stage);
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    onStage?.({ stage: "complete", label: "Investigation complete", progress: 100 });
    return {
      investigation: { ...seedInvestigation, query, id: `local-${Date.now()}` },
      run: makeSeedRun(query),
      fallback: true,
    };
  }
}

export async function updateInvestigation(
  id: string,
  patch: Partial<Pick<Investigation, "refresh_policy" | "deep_mode" | "archived">>,
): Promise<Investigation | null> {
  try {
    return await apiFetch<Investigation>(`/investigations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  } catch {
    return null;
  }
}
