/**
 * check_referral_status
 *
 * Reads the FHIR Task that tracks a referral and reports its current
 * status in plain language the agent can relay to the clinician.
 */

import { z } from "zod";
import type { SharpContext } from "../sharp/context.js";
import { FhirClient } from "../fhir/client.js";

export const checkReferralStatusInput = z.object({
  task_id: z
    .string()
    .describe("The Task id returned by submit_referral."),
});

export type CheckReferralStatusInput = z.infer<typeof checkReferralStatusInput>;

const STATUS_PLAIN: Record<string, string> = {
  requested: "Submitted to the pantry. Awaiting acknowledgement.",
  received: "Pantry has acknowledged the referral.",
  accepted: "Pantry has accepted the referral and is preparing the hamper.",
  ready: "Hamper is prepared. Awaiting pickup or delivery.",
  "in-progress": "Pickup or delivery in progress.",
  completed: "Family has received the food.",
  rejected: "Pantry declined the referral. Try an alternative resource.",
  cancelled: "Referral was cancelled.",
  "on-hold": "Referral is on hold pending more information.",
  failed: "Referral failed. Try an alternative resource.",
};

export async function checkReferralStatus(
  ctx: SharpContext,
  input: CheckReferralStatusInput
) {
  const fhir = new FhirClient(ctx);
  const task = await fhir.read("Task", input.task_id);

  const focusRef: string | undefined = task?.focus?.reference;
  const serviceRequestId = focusRef?.startsWith("ServiceRequest/")
    ? focusRef.slice("ServiceRequest/".length)
    : null;

  const status: string = task?.status ?? "unknown";
  const plain = STATUS_PLAIN[status] ?? `Status: ${status}.`;
  const businessStatus = task?.businessStatus?.text ?? null;
  const lastModified = task?.lastModified ?? null;

  // Loop-not-closed signal
  const ageHours = lastModified
    ? (Date.now() - new Date(lastModified).getTime()) / 3_600_000
    : 0;
  const stale =
    ["requested", "received", "accepted"].includes(status) && ageHours > 72;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            task_id: input.task_id,
            service_request_id: serviceRequestId,
            patient_id: ctx.patientId,
            status,
            status_plain: plain,
            business_status: businessStatus,
            last_modified: lastModified,
            stale_followup_recommended: stale,
            stale_message: stale
              ? `This referral has been ${status} for over 72 hours. Surface it to the provider as a follow-up flag.`
              : null,
          },
          null,
          2
        ),
      },
    ],
  };
}
