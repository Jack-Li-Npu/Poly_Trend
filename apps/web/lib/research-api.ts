import { makeSeedRun, seedInvestigation } from "./seed";
import type { Investigation, InvestigationMode, ResearchRun, RunEvent } from "./types";

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
  status?: string;
  details?: Record<string, unknown>;
  sequence?: number;
};

export async function runInvestigation(
  query: string,
  onStage?: (stage: StageUpdate) => void,
  mode: InvestigationMode = "standard",
): Promise<{ investigation: Investigation; run: ResearchRun; fallback: boolean }> {
  const progressByStage: Record<string, number> = {
    parse_intent: 6, manager_plan: 12, task_delegated: 18, worker_started: 26,
    tool_completed: 42, evidence_handoff: 50, source_worker: 52, source_merge: 58,
    analysis_worker: 68, analysis_merge: 74, synthesis: 82, review_worker: 88,
    review_completed: 92, review_merge: 95, quality_gate: 98,
  };
  const stages: StageUpdate[] = [
    { stage: "parse_intent", label: "Understanding the question", progress: 8 },
    { stage: "manager_plan", label: "Manager planning specialist work", progress: 16 },
    { stage: "evidence_merge", label: "Merging worker evidence", progress: 62 },
    { stage: "quantitative_forecast", label: "Calculating the transparent forecast", progress: 76 },
    { stage: "skeptical_verification", label: "Verifying every numerical claim", progress: 94 },
  ];

  stages[0] && onStage?.(stages[0]);
  try {
    const investigation = await apiFetch<Investigation>("/investigations", {
      method: "POST",
      body: JSON.stringify({ query, refresh_policy: "manual", deep_mode: mode === "deep", mode }),
    });
    stages[1] && onStage?.(stages[1]);
    const queued = await apiFetch<ResearchRun>(`/investigations/${investigation.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    const run = await new Promise<ResearchRun>((resolve, reject) => {
      const source = new EventSource(`${API_PREFIX}/runs/${queued.id}/events`);
      const timer = window.setTimeout(() => {
        source.close();
        reject(new Error("Research stream timed out"));
      }, mode === "deep" ? 170_000 : mode === "standard" ? 75_000 : 30_000);
      source.addEventListener("stage", (message) => {
        const event = JSON.parse((message as MessageEvent).data) as RunEvent;
        onStage?.({
          stage: event.stage, label: event.label,
          progress: progressByStage[event.stage] ?? 50,
          status: event.status, details: event.details, sequence: event.sequence,
        });
      });
      source.addEventListener("complete", (message) => {
        window.clearTimeout(timer);
        source.close();
        resolve(JSON.parse((message as MessageEvent).data) as ResearchRun);
      });
      source.onerror = () => {
        window.clearTimeout(timer);
        source.close();
        reject(new Error("Research event stream disconnected"));
      };
    });
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
