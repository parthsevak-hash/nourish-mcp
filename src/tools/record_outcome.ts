/**
 * record_outcome
 *
 * The loop-closing tool. Updates the ServiceRequest's status to its
 * terminal state, and writes a FHIR Observation linked to the
 * ServiceRequest so the next provider seeing this child's chart knows
 * whether the food-insecurity intervention actually reached the family.
 *
 * Without this step, every referral is "submit and forget." This is
 * the operational definition of closing the loop.
 */

import { z } from "zod";
import type { SharpContext } from "../sharp/context.js";
import { FhirClient } from "../fhir/client.js";

export const recordOutcomeInput = z.object({
  referral_id: z
    .string()
    .describe("The referral_id returned by submit_referral. This is the FHIR ServiceRequest id."),
  outcome: z
    .enum(["delivered", "no_show", "declined", "ineligible"])
    .describe(
      "The terminal outcome. 'delivered' means the family received food. 'no_show' means scheduled but family did not pick up. 'declined' means the family declined the resource. 'ineligible' means the pantry determined the family did not qualify."
    ),
  notes: z
    .string()
    .optional()
    .describe("Optional clinician note explaining the outcome."),
});

export type RecordOutcomeInput = z.infer<typeof recordOutcomeInput>;

// LOINC code for "Food insecurity risk [HVS]" — Hunger Vital Sign screening.
// Reusing the same code with a different value lets longitudinal screening
// trend on a single observation timeline.
const LOINC_FOOD_INSECURITY = "88122-7";

// Outcome mapping to FHIR ServiceRequest.status terminal states +
// structured observation value.
//
// FHIR R4 ServiceRequest.status values: draft | active | on-hold |
// revoked | completed | entered-in-error | unknown.
//
// 'completed' is the right terminal for delivered food. The other
// non-delivery outcomes all map to 'revoked' — the chart still records
// what happened in the Observation and statusReason.
const OUTCOME_MAP: Record<
  RecordOutcomeInput["outcome"],
  {
    serviceRequestStatus: string;
    statusReason: string;
    observationValue: string;
    closedLoop: boolean;
  }
> = {
  delivered: {
    serviceRequestStatus: "completed",
    statusReason: "Food delivered to family",
    observationValue: "intervention-delivered",
    closedLoop: true,
  },
  no_show: {
    serviceRequestStatus: "revoked",
    statusReason: "Family did not pick up scheduled food",
    observationValue: "intervention-no-show",
    closedLoop: false,
  },
  declined: {
    serviceRequestStatus: "revoked",
    statusReason: "Family declined the resource",
    observationValue: "intervention-declined",
    closedLoop: false,
  },
  ineligible: {
    serviceRequestStatus: "revoked",
    statusReason: "Pantry determined family ineligible",
    observationValue: "intervention-ineligible",
    closedLoop: false,
  },
};

export async function recordOutcome(
  ctx: SharpContext,
  input: RecordOutcomeInput
) {
  if (!ctx.patientId) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "record_outcome requires patient context.",
        },
      ],
    };
  }

  const fhir = new FhirClient(ctx);
  const now = new Date().toISOString();
  const map = OUTCOME_MAP[input.outcome];

  // 1. Read the ServiceRequest so we can update it without losing fields
  const serviceRequest = await fhir.read("ServiceRequest", input.referral_id);

  const updatedServiceRequest = {
    ...serviceRequest,
    status: map.serviceRequestStatus,
    // FHIR ServiceRequest doesn't have a standard statusReason field in R4
    // base profile — we record the human-readable reason in note instead.
    note: [
      ...(serviceRequest.note ?? []),
      { text: `Outcome: ${map.statusReason}${input.notes ? `. ${input.notes}` : ""}`, time: now },
    ],
  };
  await fhir.update("ServiceRequest", input.referral_id, updatedServiceRequest);

  // 2. Write Observation linking back to the ServiceRequest
  const observation = await fhir.create("Observation", {
    resourceType: "Observation",
    meta: {
      tag: [
        {
          system: "https://nourish.health/CodeSystem/source",
          code: "nourish-mcp",
          display: "Created by Nourish MCP server",
        },
      ],
    },
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "social-history",
            display: "Social History",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: LOINC_FOOD_INSECURITY,
          display: "Food insecurity intervention outcome",
        },
      ],
      text: "Food-insecurity referral outcome",
    },
    subject: { reference: `Patient/${ctx.patientId}` },
    effectiveDateTime: now,
    issued: now,
    valueCodeableConcept: {
      text: map.observationValue,
      coding: [
        {
          system: "https://nourish.health/CodeSystem/intervention-outcome",
          code: map.observationValue,
        },
      ],
    },
    derivedFrom: [{ reference: `ServiceRequest/${input.referral_id}` }],
    note: input.notes ? [{ text: input.notes }] : undefined,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            outcome_recorded: true,
            referral_id: input.referral_id,
            new_status: map.serviceRequestStatus,
            status_reason: map.statusReason,
            observation_id: observation.id,
            loop_closed: map.closedLoop,
            message: map.closedLoop
              ? "Loop closed. The next provider opening this chart will see that the food-insecurity intervention reached the family."
              : `Loop ended without delivery. The chart now reflects this outcome (${map.observationValue}). Consider an alternative resource or escalating to social work.`,
          },
          null,
          2
        ),
      },
    ],
  };
}
