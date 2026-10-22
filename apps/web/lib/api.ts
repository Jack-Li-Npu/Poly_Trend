import type {
  CaseCreate,
  CaseDetail,
  CasePatch,
  EvaluationReport,
  EventList,
  ImportRequest,
  ProgressEvent,
  ResearchCase,
  ResearchRun,
  RunCreate,
  RunDetail,
  SimulationRequest,
  SimulationResult,
  SourceMode,
} from "./types";
export const API_BASE = (
  process.env.NEXT_PUBLIC_RESEARCH_API_URL ?? ""
).replace(/\/$/, "");
const prefix = `${API_BASE}/api/v3`;
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${prefix}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message =
        body && typeof body === "object" && "detail" in body
          ? typeof body.detail === "string"
            ? body.detail
            : JSON.stringify(body.detail)
          : `Research API returned ${response.status}`;
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      error instanceof Error && error.name === "AbortError"
        ? "The request timed out. Your saved research is preserved; try again."
        : "The research service is unreachable. Check the backend connection and retry.",
    );
  } finally {
    window.clearTimeout(timeout);
  }
}
const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
export const api = {
  events: (sourceMode: SourceMode, query = "") =>
    request<EventList>(
      `/events?source_mode=${sourceMode}&query=${encodeURIComponent(query)}`,
    ),
  cases: () => request<ResearchCase[]>("/cases"),
  createCase: (body: CaseCreate) => post<ResearchCase>("/cases", body),
  case: (id: string) => request<CaseDetail>(`/cases/${encodeURIComponent(id)}`),
  patchCase: (id: string, body: CasePatch) =>
    request<ResearchCase>(`/cases/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  createRun: (caseId: string, body: RunCreate) =>
    post<ResearchRun>(`/cases/${encodeURIComponent(caseId)}/runs`, body),
  run: (id: string) => request<RunDetail>(`/runs/${encodeURIComponent(id)}`),
  cancel: (id: string) =>
    post<ResearchRun>(`/runs/${encodeURIComponent(id)}/cancel`),
  resume: (id: string) =>
    post<ResearchRun>(`/runs/${encodeURIComponent(id)}/resume`),
  simulate: (body: SimulationRequest) =>
    post<SimulationResult>("/simulations", body),
  evaluations: () => request<EvaluationReport>("/evaluations"),
  import: (body: ImportRequest) => post<unknown>("/imports", body),
};
export function streamRun(
  id: string,
  onStage: (stage: ProgressEvent) => void,
  onComplete: (detail: RunDetail) => void,
  onDisconnect: () => void,
) {
  const source = new EventSource(
    `${prefix}/runs/${encodeURIComponent(id)}/events`,
  );
  source.addEventListener("stage", (event) => {
    try {
      onStage(
        JSON.parse((event as MessageEvent<string>).data) as ProgressEvent,
      );
    } catch {
      source.close();
      onDisconnect();
    }
  });
  source.addEventListener("complete", (event) => {
    source.close();
    try {
      onComplete(JSON.parse((event as MessageEvent<string>).data) as RunDetail);
    } catch {
      onDisconnect();
    }
  });
  source.onerror = () => {
    source.close();
    onDisconnect();
  };
  return () => source.close();
}
