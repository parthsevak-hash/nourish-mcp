/**
 * Matching engine for community food resources.
 *
 * Two-stage design:
 *   1. HARD FILTERS (deterministic, safety-critical):
 *      - Allergen safety: never return a resource that lacks the
 *        allergen-safe variant the patient requires.
 *      - Religious/dietary law: never return a non-halal resource
 *        when a halal hamper is requested. Same for kosher.
 *      - Age range: never return a resource whose age window
 *        excludes the patient.
 *      - Infant formula: required-only filter when family has an
 *        infant under 12 months.
 *      - Geographic radius: drop anything beyond MAX_RADIUS_KM.
 *
 *   2. SOFT RANKING (multi-factor score):
 *      - Distance (closer is better)
 *      - Load (under-capacity preferred)
 *      - Language match (one of family's languages spoken)
 *      - Schedule fit (open this week)
 *      - Cultural-fit signal (e.g. South-Asian family + halal)
 *
 * The ranker output is what the agent sees. The LLM never overrides
 * a hard filter — it can only choose among the safe candidates.
 */

import {
  RESOURCES,
  type FoodResource,
  type AllergenSafe,
  type DietaryCert,
} from "./resources.js";

const MAX_RADIUS_KM = 35;

export interface MatchInput {
  patientLat: number;
  patientLng: number;
  patientAgeMonths: number;
  householdLanguages: string[]; // e.g. ["en", "ur"]
  requiredDietaryCerts: DietaryCert[]; // e.g. ["halal_certified"]
  requiredAllergenSafe: AllergenSafe[]; // e.g. ["peanut_free_box_available"]
  requiresInfantFormula: boolean;
  urgency: "routine" | "urgent" | "emergency";
  preferredServiceTypes?: FoodResource["type"][];
}

export interface RankedMatch {
  resource: FoodResource;
  distanceKm: number;
  score: number;
  rationale: string[];
}

export function findMatches(input: MatchInput): RankedMatch[] {
  const candidates = RESOURCES
    // 1. Hard filters
    .filter((r) => passesHardFilters(r, input))
    // Compute distance once
    .map((r) => ({
      resource: r,
      distanceKm: haversineKm(
        input.patientLat,
        input.patientLng,
        r.latitude,
        r.longitude
      ),
    }))
    .filter((c) => c.distanceKm <= MAX_RADIUS_KM)
    // 2. Soft ranking
    .map((c) => scoreMatch(c.resource, c.distanceKm, input))
    .sort((a, b) => b.score - a.score);

  return candidates.slice(0, 5);
}

function passesHardFilters(r: FoodResource, input: MatchInput): boolean {
  // Age window
  const ageYears = input.patientAgeMonths / 12;
  if (r.ageMinMonths !== null && input.patientAgeMonths < r.ageMinMonths) return false;
  if (r.ageMaxYears !== null && ageYears > r.ageMaxYears) return false;

  // Children-serving
  if (!r.servesChildren) return false;

  // Infant formula requirement
  if (input.requiresInfantFormula && !r.hasInfantFormula) return false;

  // Religious/dietary certs — every required cert must be present
  for (const cert of input.requiredDietaryCerts) {
    if (!r.dietaryCerts.includes(cert)) return false;
  }

  // Allergen safety — every required allergen-safe variant must be available
  for (const allergen of input.requiredAllergenSafe) {
    if (!r.allergenSafe.includes(allergen)) return false;
  }

  return true;
}

function scoreMatch(
  resource: FoodResource,
  distanceKm: number,
  input: MatchInput
): RankedMatch {
  const rationale: string[] = [];
  let score = 100;

  // Distance penalty (linear; 0km = no penalty, MAX_RADIUS = -40)
  const distancePenalty = (distanceKm / MAX_RADIUS_KM) * 40;
  score -= distancePenalty;
  rationale.push(`${distanceKm.toFixed(1)} km from family`);

  // Load penalty (heavy load = harder to serve a new family this week)
  if (resource.currentLoadPct >= 90) {
    score -= 20;
    rationale.push(`high current load (${resource.currentLoadPct}%)`);
  } else if (resource.currentLoadPct <= 70) {
    score += 5;
    rationale.push(`capacity available (${resource.currentLoadPct}% load)`);
  }

  // Language match — strong positive signal
  const sharedLanguages = input.householdLanguages.filter((l) =>
    resource.languages.includes(l)
  );
  if (sharedLanguages.length > 0) {
    score += 15;
    rationale.push(`speaks ${sharedLanguages.join(", ")}`);
  } else if (!resource.languages.includes("en")) {
    score -= 10;
    rationale.push("no shared language with family");
  }

  // Service-type preference
  if (
    input.preferredServiceTypes &&
    input.preferredServiceTypes.includes(resource.type)
  ) {
    score += 8;
    rationale.push(`matches preferred service type (${resource.type})`);
  }

  // Urgency boost — emergency referrals favour low-load resources even more
  if (input.urgency === "emergency" && resource.currentLoadPct <= 75) {
    score += 10;
    rationale.push("low load — can absorb emergency referral");
  }

  return {
    resource,
    distanceKm,
    score: Math.round(score * 10) / 10,
    rationale,
  };
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
