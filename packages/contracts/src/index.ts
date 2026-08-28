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

export const API_VERSION = "v1" as const;
export const API_PREFIX = `/api/${API_VERSION}` as const;

export const RELATION_TYPES = [
  "direct",
  "duplicate",
  "complement",
  "supporting_proxy",
  "conflicting_proxy",
  "measured_correlation",
  "external_context",
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];
