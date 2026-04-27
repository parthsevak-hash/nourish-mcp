/**
 * submit_referral
 *
 * Creates a FHIR ServiceRequest representing the clinical referral.
 * The ServiceRequest itself is the lifecycle handle — its status field
 * follows the standard FHIR R4 state machine (active → completed /
 * revoked / entered-in-error) and is sufficient for closed-loop
 * referral tracking.
 *
 * Returns the referral_id (the ServiceRequest id), which is the
 * canonical handle for check_referral_status and record_outcome.
 */

import { z } from "zod";
import type { SharpContext } from "../sharp/context.js";
import { FhirClient } from "../fhir/client.js";
import { findById } from "../directory/resources.js";

export const submitReferralInput = z.object({
  resource_id: z
    .string()
    .describe("The id of the food resource selected from find_food_resources output."),
  reason_text: z
    .string()
    .describe(
      "Clinical reason for the referral, in plain language. Examples: 'Positive Hunger Vital Sign at 18-month well-child visit.', 'Family reports running out of food before end of month.'"
    ),
  ordering_provider_npi: z
    .string()
    .optional()
    .describe(
      "NPI of the ordering provider, if known. Optional; falls back to the SHARP-context user."
    ),
  notes_for_pantry: z
    .string()
    .optional()
    .describe(
      "Free-text notes the pantry should see when the referral lands. Use sparingly; do not include PHI beyond what's necessary."
    ),
});

export type SubmitReferralInput = z.infer<typeof submitReferralInput>;

export async function submitReferral(
  ctx: SharpContext,
  input: SubmitReferralInput
) {
  if (!ctx.patientId) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "submit_referral requires patient context.",
        },
      ],
    };
  }

  const resource = findById(input.resource_id);
  if (!resource) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Unknown resource_id "${input.resource_id}". Call find_food_resources first.`,
        },
      ],
    };
  }

  const fhir = new FhirClient(ctx);
  const now = new Date().toISOString();

  // Single ServiceRequest — both the clinical order and the lifecycle handle.
  // status=active means submitted and in flight. record_outcome will move
  // status to completed (delivered) or revoked (no_show / declined / ineligible).
  const serviceRequest = await fhir.create("ServiceRequest", {
    resourceType: "ServiceRequest",
    meta: {
      tag: [
        {
          system: "https://nourish.health/CodeSystem/source",
          code: "nourish-mcp",
          display: "Created by Nourish MCP server",
        },
      ],
    },
    status: "active",
    intent: "order",
    category: [
      {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "467771000124109",
            display: "Assessment of food security (procedure)",
          },
        ],
        text: "Social determinants of health — food security",
      },
    ],
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "710925007",
          display: "Referral to community service (procedure)",
        },
      ],
      text: "Food-insecurity referral",
    },
    subject: { reference: `Patient/${ctx.patientId}` },
    authoredOn: now,
    occurrenceDateTime: now,
    reasonCode: [{ text: input.reason_text }],
    note: input.notes_for_pantry ? [{ text: input.notes_for_pantry, time: now }] : undefined,
    performer: [
      {
        display: resource.name,
        identifier: { value: resource.id },
      },
    ],
  });

  console.log(
    `[submit_referral] FHIR returned ServiceRequest id=${serviceRequest?.id ?? "<missing>"}` +
      ` for patient=${ctx.patientId} resource=${resource.id} (${resource.name})`
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            referral_submitted: true,
            referral_id: serviceRequest.id,
            status: "active",
            resource: {
              id: resource.id,
              name: resource.name,
              phone: resource.phone,
              referral_intake_url: resource.referralIntakeUrl,
            },
            next_step:
              `Track this referral by calling check_referral_status with referral_id="${serviceRequest.id}". ` +
              `When the family confirms food received, call record_outcome with outcome="delivered".`,
          },
          null,
          2
        ),
      },
    ],
  };
}