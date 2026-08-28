export type { components, operations, paths } from "./generated/openapi.js";
import type { components } from "./generated/openapi.js";
export type QueryIntent = components["schemas"]["QueryIntent"];
export type MarketSnapshot = components["schemas"]["MarketSnapshot"];
export type RelationshipEdge = components["schemas"]["RelationshipEdge"];
export type EvidenceItem = components["schemas"]["EvidenceItem"];
export type MarketImpliedAnswer = components["schemas"]["MarketImpliedAnswer"];
export type Investigation = components["schemas"]["Investigation"];
export type ResearchRun = components["schemas"]["ResearchRun"];
export type RunDiff = components["schemas"]["RunDiff"];
export type RunEvent = components["schemas"]["RunEvent"];
export declare const API_VERSION: "v1";
export declare const API_PREFIX: "/api/v1";
export declare const RELATION_TYPES: readonly ["direct", "duplicate", "complement", "supporting_proxy", "conflicting_proxy", "measured_correlation", "external_context"];
export type RelationType = (typeof RELATION_TYPES)[number];
//# sourceMappingURL=index.d.ts.map