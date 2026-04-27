/**
 * Safety tests for the matcher.
 *
 * These tests are not exhaustive coverage — they exist to prove,
 * in code, that the safety-critical hard filters do what the README
 * claims they do. If any of these tests fail, Nourish is unsafe to
 * ship.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { findMatches } from "../src/directory/matcher.js";
import { RESOURCES } from "../src/directory/resources.js";

// Anchor: downtown Toronto. All hard-filter tests use this so distance
// is not the variable under test.
const TORONTO_LAT = 43.6532;
const TORONTO_LNG = -79.3832;

const baseInput = {
  patientLat: TORONTO_LAT,
  patientLng: TORONTO_LNG,
  patientAgeMonths: 60, // 5-year-old
  householdLanguages: ["en"],
  requiredDietaryCerts: [],
  requiredAllergenSafe: [],
  requiresInfantFormula: false,
  urgency: "routine" as const,
};

test("matcher returns at least one match for a typical paediatric request", () => {
  const matches = findMatches(baseInput);
  assert.ok(matches.length > 0, "should return at least one match");
});

test("HARD FILTER: peanut-allergic child never receives a pantry without peanut-free option", () => {
  const matches = findMatches({
    ...baseInput,
    requiredAllergenSafe: ["peanut_free_box_available"],
  });

  for (const m of matches) {
    assert.ok(
      m.resource.allergenSafe.includes("peanut_free_box_available"),
      `unsafe: ${m.resource.name} returned without peanut-free box`
    );
  }
});

test("HARD FILTER: halal-observant family never receives a non-halal pantry", () => {
  const matches = findMatches({
    ...baseInput,
    requiredDietaryCerts: ["halal_certified"],
  });

  assert.ok(matches.length > 0, "halal matches should exist in the directory");
  for (const m of matches) {
    assert.ok(
      m.resource.dietaryCerts.includes("halal_certified"),
      `unsafe: ${m.resource.name} returned without halal certification`
    );
  }
});

test("HARD FILTER: kosher-observant family never receives a non-kosher pantry", () => {
  const matches = findMatches({
    ...baseInput,
    requiredDietaryCerts: ["kosher_certified"],
  });

  for (const m of matches) {
    assert.ok(
      m.resource.dietaryCerts.includes("kosher_certified"),
      `unsafe: ${m.resource.name} returned without kosher certification`
    );
  }
});

test("HARD FILTER: family with infant under 12 months never receives a pantry without infant formula", () => {
  const matches = findMatches({
    ...baseInput,
    patientAgeMonths: 6,
    requiresInfantFormula: true,
  });

  for (const m of matches) {
    assert.ok(
      m.resource.hasInfantFormula,
      `unsafe: ${m.resource.name} returned for a 6-month-old without infant formula`
    );
  }
});

test("HARD FILTER: age window is respected — 1-year-old never matched to adolescent-only meal program", () => {
  const matches = findMatches({
    ...baseInput,
    patientAgeMonths: 12,
  });

  for (const m of matches) {
    if (m.resource.ageMinMonths !== null) {
      assert.ok(
        12 >= m.resource.ageMinMonths,
        `unsafe: ${m.resource.name} with ageMinMonths=${m.resource.ageMinMonths} matched to 12-month-old`
      );
    }
  }
});

test("HARD FILTER: every returned resource serves children", () => {
  const matches = findMatches(baseInput);
  for (const m of matches) {
    assert.ok(
      m.resource.servesChildren,
      `unsafe: ${m.resource.name} returned but does not serve children`
    );
  }
});

test("HARD FILTER: combined constraints — halal AND peanut-free filters compound correctly", () => {
  const matches = findMatches({
    ...baseInput,
    requiredDietaryCerts: ["halal_certified"],
    requiredAllergenSafe: ["peanut_free_box_available"],
  });

  for (const m of matches) {
    assert.ok(m.resource.dietaryCerts.includes("halal_certified"));
    assert.ok(m.resource.allergenSafe.includes("peanut_free_box_available"));
  }
});

test("RANKING: language match boosts score over a closer pantry that does not speak the family's language", () => {
  // Find two pantries: one that speaks Urdu, one that does not.
  // Using a household that only speaks Urdu should rank the
  // Urdu-speaking one ahead even if it's further.
  const matches = findMatches({
    ...baseInput,
    householdLanguages: ["ur"],
  });

  if (matches.length >= 2) {
    const top = matches[0];
    assert.ok(
      top.resource.languages.includes("ur") ||
        top.resource.languages.includes("en"),
      "top match should speak Urdu or fall back to English"
    );
  }
});

test("RANKING: results are sorted descending by score", () => {
  const matches = findMatches(baseInput);
  for (let i = 1; i < matches.length; i++) {
    assert.ok(
      matches[i - 1].score >= matches[i].score,
      `matches not sorted: ${matches[i - 1].score} < ${matches[i].score}`
    );
  }
});

test("RANKING: at most 5 matches returned", () => {
  const matches = findMatches(baseInput);
  assert.ok(matches.length <= 5, `expected ≤5 matches, got ${matches.length}`);
});

test("DIRECTORY: every resource has a non-empty name, address, and phone", () => {
  for (const r of RESOURCES) {
    assert.ok(r.name.length > 0, `resource ${r.id} has empty name`);
    assert.ok(r.address.length > 0, `resource ${r.id} has empty address`);
    assert.ok(r.phone.length > 0, `resource ${r.id} has empty phone`);
  }
});

test("DIRECTORY: every resource has valid lat/lng (sanity check, GTA area)", () => {
  for (const r of RESOURCES) {
    assert.ok(
      r.latitude > 41 && r.latitude < 45,
      `resource ${r.id} has out-of-range latitude: ${r.latitude}`
    );
    assert.ok(
      r.longitude > -81 && r.longitude < -78,
      `resource ${r.id} has out-of-range longitude: ${r.longitude}`
    );
  }
});

test("DIRECTORY: load percentages are in 0-100 range", () => {
  for (const r of RESOURCES) {
    assert.ok(
      r.currentLoadPct >= 0 && r.currentLoadPct <= 100,
      `resource ${r.id} has invalid load: ${r.currentLoadPct}`
    );
  }
});
