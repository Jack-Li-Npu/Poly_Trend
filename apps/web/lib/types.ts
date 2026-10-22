// API types are generated from the canonical Pydantic models.
export type {
  V3AssetSeries as AssetSeries,
  V3CaseCreate as CaseCreate,
  V3CaseDetail as CaseDetail,
  V3CasePatch as CasePatch,
  V3Claim as Claim,
  V3Contract as Contract,
  V3ContextItem as ContextItem,
  V3EvaluationReport as EvaluationReport,
  V3EventDefinition as EventDefinition,
  V3EventList as EventList,
  V3EvidenceBundle as EvidenceBundle,
  V3ImportRequest as ImportRequest,
  V3InvalidationRule as InvalidationRule,
  V3MarketSnapshot as MarketSnapshot,
  V3Observation as Observation,
  V3ProgressEvent as ProgressEvent,
  V3ResearchCase as ResearchCase,
  V3ResearchRun as ResearchRun,
  V3RunCreate as RunCreate,
  V3RunDetail as RunDetail,
  V3ScenarioAssumptions as ScenarioAssumptions,
  V3SimulationRequest as SimulationRequest,
  V3SimulationResult as SimulationResult,
} from "@polytrend/contracts";
export type SourceMode = "live" | "recorded";
export type WorkspaceTab =
  | "overview"
  | "scenario"
  | "evidence"
  | "history"
  | "evaluation";
