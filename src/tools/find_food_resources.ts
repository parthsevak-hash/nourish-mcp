/**
 * find_food_resources
 *
 * Given a patient context, returns ranked community food resources
 * filtered by safety-critical constraints (allergens, religious diet,
 * age window, infant-formula availability, geographic radius) and
 * scored on distance, capacity, language match, and urgency fit.
 *
 * Reads patient demographics, allergies, language, and address from
 * the FHIR server using the platform-injected SHARP context.
 */

import { z } from "zod";
import type { SharpContext } from "../sharp/context.js";
import { FhirClient } from "../fhir/client.js";
import { findMatches } from "../directory/matcher.js";
import type {
  AllergenSafe,
  DietaryCert,
  FoodResource,
} from "../directory/resources.js";

export const findFoodResourcesInput = z.object({
  required_dietary_certs: z
    .array(
      z.enum([
        "halal_certified",
        "kosher_certified",
        "vegetarian_options",
        "vegan_options",
      ])
    )
    .default([])
    .describe(
      "Religious or dietary certifications required by the family. Use halal_certified or kosher_certified only when the family explicitly observes that practice."
    ),
  required_allergen_safe: z
    .array(
      z.enum([
        "peanut_free_box_available",
        "tree_nut_free_box_available",
        "gluten_free_box_available",
        "dairy_free_box_available",
      ])
    )
    .default([])
    .describe(
      "Allergen-safe variants required for the patient. Derived from documented AllergyIntolerance resources, but the agent may add allergens parents report verbally."
    ),
  preferred_service_types: z
    .array(
      z.enum([
        "food_bank",
        "meal_program",
        "school_food",
        "infant_formula",
        "produce_box",
      ])
    )
    .optional()
    .describe(
      "Family's preferred service modality. Optional. If omitted, all types are considered."
    ),
  urgency: z
    .enum(["routine", "urgent", "emergency"])
    .default("routine")
    .describe(
      "Clinical urgency. Use 'emergency' only when the family will run out of food within 24-48 hours."
    ),
  household_languages_override: z
    .array(z.string())
    .optional()
    .describe(
      "Override the languages read from the patient's Communication preferences. Use only when the chart language is wrong or incomplete."
    ),
});

export type FindFoodResourcesInput = z.infer<typeof findFoodResourcesInput>;

export async function findFoodResources(
  ctx: SharpContext,
  input: FindFoodResourcesInput
) {
  if (!ctx.patientId) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "find_food_resources requires patient context. Invoke this tool from a patient-scoped conversation.",
        },
      ],
    };
  }

  const fhir = new FhirClient(ctx);

  // 1. Read the patient
  const patient = await fhir.read("Patient", ctx.patientId);

  // 2. Derive age in months
  const ageMonths = ageInMonths(patient.birthDate);

  // 3. Derive household languages from Patient.communication[].language
  const chartLanguages: string[] = (patient.communication ?? [])
    .map((c: any) => c?.language?.coding?.[0]?.code)
    .filter(Boolean);
  const householdLanguages = input.household_languages_override ?? (
    chartLanguages.length > 0 ? chartLanguages : ["en"]
  );

  // 4. Read documented allergies (informational; agent passes allergen-safe explicitly)
  const allergyBundle = await fhir.search("AllergyIntolerance", {
    patient: ctx.patientId,
    "clinical-status": "active",
  });
  const documentedAllergens = (allergyBundle?.entry ?? [])
    .map((e: any) => e?.resource?.code?.text ?? "")
    .filter(Boolean);

  // 5. Resolve patient location.
  // FHIR Patient.address[0] is the canonical home address.
  // For the hackathon, if no geocoded address is present, fall back
  // to downtown Toronto coordinates so the demo always has matches in
  // range. In production, geocode the address[0].line + city + postal
  // before matching.
  const addr = (patient.address ?? [])[0];
  const lat = addr?.extension?.find(
    (e: any) => e.url === "http://hl7.org/fhir/StructureDefinition/geolocation"
  )?.extension?.find((e: any) => e.url === "latitude")?.valueDecimal ?? 43.6532;
  const lng = addr?.extension?.find(
    (e: any) => e.url === "http://hl7.org/fhir/StructureDefinition/geolocation"
  )?.extension?.find((e: any) => e.url === "longitude")?.valueDecimal ?? -79.3832;

  // 6. Match
  const requiresInfantFormula = ageMonths < 12;
  const matches = findMatches({
    patientLat: lat,
    patientLng: lng,
    patientAgeMonths: ageMonths,
    householdLanguages,
    requiredDietaryCerts: input.required_dietary_certs as DietaryCert[],
    requiredAllergenSafe: input.required_allergen_safe as AllergenSafe[],
    requiresInfantFormula,
    urgency: input.urgency,
    preferredServiceTypes: input.preferred_service_types as FoodResource["type"][] | undefined,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            patient_summary: {
              patient_id: ctx.patientId,
              age_months: ageMonths,
              household_languages: householdLanguages,
              documented_allergies: documentedAllergens,
              location: { latitude: lat, longitude: lng },
            },
            matching_inputs: {
              required_dietary_certs: input.required_dietary_certs,
              required_allergen_safe: input.required_allergen_safe,
              urgency: input.urgency,
              requires_infant_formula: requiresInfantFormula,
            },
            matches: matches.map((m) => ({
              resource_id: m.resource.id,
              name: m.resource.name,
              type: m.resource.type,
              address: `${m.resource.address}, ${m.resource.city} ${m.resource.postalCode}`,
              phone: m.resource.phone,
              hours: m.resource.hours,
              distance_km: m.distanceKm,
              score: m.score,
              languages: m.resource.languages,
              dietary_certs: m.resource.dietaryCerts,
              allergen_safe: m.resource.allergenSafe,
              current_load_pct: m.resource.currentLoadPct,
              rationale: m.rationale,
              notes: m.resource.notes,
            })),
            note:
              matches.length === 0
                ? "No resources match all hard constraints. Loosen one constraint (e.g., expand radius via a v2 tool) or surface this gap to the provider."
                : `Returned ${matches.length} ranked matches. Top match: ${matches[0].resource.name}.`,
          },
          null,
          2
        ),
      },
    ],
  };
}

function ageInMonths(birthDate: string | undefined): number {
  if (!birthDate) return 60; // safe paediatric default
  const dob = new Date(birthDate);
  const now = new Date();
  const months =
    (now.getFullYear() - dob.getFullYear()) * 12 +
    (now.getMonth() - dob.getMonth());
  return Math.max(0, months);
}
