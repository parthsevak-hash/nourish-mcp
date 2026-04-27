/**
 * submit_referral
 *
 * Creates a FHIR ServiceRequest representing the clinical referral and
 * a paired Task that tracks the referral through its lifecycle. Both
 * resources are anchored to the patient via the SHARP context.
 *
 * Returns the Task id, which is the canonical handle the agent uses
 * for status checks and outcome recording.
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

  // 1. ServiceRequest — the clinical order
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
    reasonCode: [{ text: input.reason_text }],
    note: input.notes_for_pantry ? [{ text: input.notes_for_pantry }] : undefined,
    performer: [
      {
        display: resource.name,
        identifier: { value: resource.id },
      },
    ],
  });

  // 2. Task — the lifecycle handle
  const task = await fhir.create("Task", {
    resourceType: "Task",
    meta: {
      tag: [
        {
          system: "https://nourish.health/CodeSystem/source",
          code: "nourish-mcp",
          display: "Created by Nourish MCP server",
        },
      ],
    },
    status: "requested",
    intent: "order",
    priority: "routine",
    code: {
      coding: [
        {
          system: "http://hl7.org/fhir/CodeSystem/task-code",
          code: "fulfill",
          display: "Fulfill the focal request",
        },
      ],
      text: "Fulfill food-insecurity referral",
    },
    description: `Food-insecurity referral to ${resource.name}. ${input.reason_text}`,
    focus: { reference: `ServiceRequest/${serviceRequest.id}` },
    for: { reference: `Patient/${ctx.patientId}` },
    authoredOn: now,
    lastModified: now,
    owner: {
      display: resource.name,
      identifier: { value: resource.id },
    },
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            referral_submitted: true,
            service_request_id: serviceRequest.id,
            task_id: task.id,
            resource: {
              id: resource.id,
              name: resource.name,
              phone: resource.phone,
              referral_intake_url: resource.referralIntakeUrl,
            },
            next_step:
              `Track this referral by calling check_referral_status with task_id="${task.id}". ` +
              `When the family confirms food received, call record_outcome with status="delivered".`,
          },
          null,
          2
        ),
      },
    ],
  };
}
