/**
 * SHARP Context — reads the FHIR context headers that Prompt Opinion injects
 * into every tool call after a user has authorized the requested SMART scopes.
 *
 * Reference: https://docs.promptopinion.ai/fhir-context/mcp-fhir-context
 */

import type { Request } from "express";

export interface SharpContext {
  fhirServerUrl: string | null;
  fhirAccessToken: string | null;
  patientId: string | null;
  fhirRefreshToken: string | null;
  fhirRefreshUrl: string | null;
}

/**
 * Extract SHARP context from inbound request headers.
 * Headers are case-insensitive; Express normalizes to lowercase.
 */
export function readSharpContext(req: Request): SharpContext {
  return {
    fhirServerUrl: header(req, "x-fhir-server-url"),
    fhirAccessToken: header(req, "x-fhir-access-token"),
    patientId: header(req, "x-patient-id"),
    fhirRefreshToken: header(req, "x-fhir-refresh-token"),
    fhirRefreshUrl: header(req, "x-fhir-refresh-url"),
  };
}

function header(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (!v) return null;
  return Array.isArray(v) ? v[0] : v;
}

/**
 * SMART scopes Nourish requests at initialize-time.
 *
 * These show up in the consent screen when a workspace owner adds the
 * Nourish MCP server. Required scopes are non-negotiable; optional ones
 * can be unchecked by the user.
 *
 * Scope rationale:
 *  - Patient.rs: identity, demographics, language, household location
 *  - Condition.rs: clinical reason for elevated nutritional risk
 *  - AllergyIntolerance.rs: hard safety constraint on resource matching
 *  - Observation.rs/.cuds: read SDOH screenings, write outcomes back
 *  - ServiceRequest.cuds: create the referral itself
 *  - Task.cuds: track the referral through its lifecycle
 */
export const NOURISH_SHARP_SCOPES = [
  { name: "patient/Patient.rs", required: true },
  { name: "patient/Condition.rs", required: true },
  { name: "patient/AllergyIntolerance.rs", required: true },
  { name: "patient/Observation.rs", required: true },
  { name: "patient/Observation.cuds", required: true },
  { name: "patient/ServiceRequest.cuds", required: true },
  { name: "patient/Task.rs", required: true },
  { name: "patient/Task.cud", required: true },
] as const;
