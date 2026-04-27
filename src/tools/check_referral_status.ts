/**
 * check_referral_status
 *
 * Reads the FHIR ServiceRequest that represents the referral and
 * reports its current status in plain language the agent can relay
 * to the clinician.
 *
 * Flags referrals that have been in `active` status for more than
 * 72 hours — the absence of a closure event is itself signal.
 */

import { z } from "zod";
import type { SharpContext } from "../sharp/context.js";
import { FhirClient } from "../fhir/client.js";

export const checkReferralStatusInput = z.object({
  referral_id: z
    .string()
    .describe("The referral_id returned by submit_referral. This is the FHIR ServiceRequest id."),
});

export type CheckReferralStatusInput = z.infer<typeof checkReferralStatusInput>;

const STATUS_PLAIN: Record<string, string> = {
  draft: "Draft. Not yet submitted to the pantry.",
  active: "Submitted to the pantry. Awaiting fulfillment.",
  "on-hold": "On hold pending more information.",
  revoked: "Cancelled or declined. Try an alternative resource.",
  completed: "Family has received the food.",
  "entered-in-error": "Referral was entered in error.",
  unknown: "Status unknown.",
};

export async function checkReferralStatus(
  ctx: SharpContext,
  input: CheckReferralStatusInput
) {
  const fhir = new FhirClient(ctx);
  const serviceRequest = await fhir.read("ServiceRequest", input.referral_id);

  const status: string = serviceRequest?.status ?? "unknown";
  const plain = STATUS_PLAIN[status] ?? `Status: ${status}.`;
  const authoredOn: string | null = serviceRequest?.authoredOn ?? null;
  const lastUpdated: string | null =
    serviceRequest?.meta?.lastUpdated ?? authoredOn ?? null;

  // Loop-not-closed signal — referral has been active more than 72 hours.
  const ageHours = lastUpdated
    ? (Date.now() - new Date(lastUpdated).getTime()) / 3_600_000
    : 0;
  const stale = status === "active" && ageHours > 72;

  // Performing pantry, if recorded
  const performer = serviceRequest?.performer?.[0];
  const performerName: string | null = performer?.display ?? null;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            referral_id: input.referral_id,
            patient_id: ctx.patientId,
            status,
            status_plain: plain,
            performer: performerName,
            authored_on: authoredOn,
            last_updated: lastUpdated,
            stale_followup_recommended: stale,
            stale_message: stale
              ? `This referral has been active for over 72 hours. Surface it to the provider as a follow-up flag.`
              : null,
          },
          null,
          2
        ),
      },
    ],
  };
}
