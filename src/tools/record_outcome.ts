/**
 * record_outcome
 *
 * The loop-closing tool. Updates the Task status, and writes a FHIR
 * Observation linked to the original ServiceRequest so the next
 * provider seeing this child's chart knows whether the food-insecurity
 * intervention actually reached the family.
 *
 * Without this step, every referral is "submit and forget." This is
 * the operational definition of closing the loop.
 */

import { z } from "zod";
import type { SharpContext } from "../sharp/context.js";
import { FhirClient } from "../fhir/client.js";

export const recordOutcomeInput = z.object({
  task_id: z
    .string()
    .describe("The Task id returned by submit_referral."),
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

// LOINC code for "Food insecurity risk [HVS]" -- Hunger Vital Sign screening.
// Reusing the same code with a different value lets longitudinal screening
// trend on a single observation timeline.
const LOINC_FOOD_INSECURITY = "88122-7";

// Outcome mapping to FHIR Task.status terminal states + structured value.
const OUTCOME_MAP: Record<
  RecordOutcomeInput["outcome"],
  { taskStatus: string; observationValue: string; closedLoop: boolean }
> = {
  delivered: { taskStatus: "completed", observationValue: "intervention-delivered", closedLoop: true },
  no_show: { taskStatus: "failed", observationValue: "intervention-no-show", closedLoop: false },
  declined: { taskStatus: "cancelled", observationValue: "intervention-declined", closedLoop: false },
  ineligible: { taskStatus: "rejected", observationValue: "intervention-ineligible", closedLoop: false },
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

  // 1. Read the Task so we can update it without losing fields
  const task = await fhir.read("Task", input.task_id);
  const map = OUTCOME_MAP[input.outcome];

  const updatedTask = {
    ...task,
    status: map.taskStatus,
    lastModified: now,
    businessStatus: { text: map.observationValue },
    note: [
      ...(task.note ?? []),
      input.notes ? { text: input.notes, time: now } : undefined,
    ].filter(Boolean),
  };
  await fhir.update("Task", input.task_id, updatedTask);

  // 2. Write Observation linking back to the ServiceRequest
  const serviceRequestRef: string | undefined = task?.focus?.reference;
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
    derivedFrom: serviceRequestRef ? [{ reference: serviceRequestRef }] : undefined,
    note: input.notes ? [{ text: input.notes }] : undefined,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            outcome_recorded: true,
            task_id: input.task_id,
            new_task_status: map.taskStatus,
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
