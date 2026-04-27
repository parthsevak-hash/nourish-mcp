/**
 * Seeded community food resource directory — DEMO DATA.
 *
 * The organization names, addresses, and phone numbers below are real,
 * publicly-listed Greater Toronto Area food relief organizations. They
 * are referenced here purely to make the matching demo realistic against
 * a population paediatricians actually serve.
 *
 * Everything else — referral intake URLs (`.example` TLD per RFC 2606),
 * current-load percentages, weekly-family capacity, age windows,
 * allergen-safe variants, language coverage — is illustrative sample
 * data structured for the hackathon. None of these organizations have
 * endorsed or reviewed Nourish.
 *
 * In production this directory would be sourced from an aggregator
 * (Findhelp / Aunt Bertha, 211, regional food-bank network APIs) with
 * each org self-attesting the structured attributes Nourish matches on.
 *
 * Each entry captures STRUCTURED attributes — allergens, certifications,
 * languages, child-specific provisions — so matching is enforced
 * architecturally, not via free-form prompt instructions. This is the
 * core safety property: an agent physically cannot route a peanut box
 * to a peanut-allergic child, because the matcher does not return that
 * resource.
 */

export type ServiceType =
  | "food_bank"
  | "meal_program"
  | "school_food"
  | "infant_formula"
  | "produce_box";

export type DietaryCert =
  | "halal_certified"
  | "kosher_certified"
  | "vegetarian_options"
  | "vegan_options";

export type AllergenSafe =
  | "peanut_free_box_available"
  | "tree_nut_free_box_available"
  | "gluten_free_box_available"
  | "dairy_free_box_available";

export interface FoodResource {
  id: string;
  name: string;
  type: ServiceType;
  address: string;
  city: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  phone: string;
  hours: string;
  capacityWeeklyFamilies: number;
  currentLoadPct: number; // 0-100
  languages: string[];
  dietaryCerts: DietaryCert[];
  allergenSafe: AllergenSafe[];
  servesChildren: boolean;
  hasInfantFormula: boolean;
  ageMinMonths: number | null;
  ageMaxYears: number | null;
  referralIntakeUrl: string;
  notes: string;
}

export const RESOURCES: FoodResource[] = [
  {
    id: "res-001",
    name: "Daily Bread Food Bank — Etobicoke",
    type: "food_bank",
    address: "191 New Toronto St",
    city: "Toronto",
    postalCode: "M8V 2E7",
    latitude: 43.6042,
    longitude: -79.5085,
    phone: "+1-416-203-0050",
    hours: "Tue-Sat 9:00-15:30",
    capacityWeeklyFamilies: 1200,
    currentLoadPct: 78,
    languages: ["en", "fr", "es", "pt"],
    dietaryCerts: ["vegetarian_options"],
    allergenSafe: ["peanut_free_box_available"],
    servesChildren: true,
    hasInfantFormula: true,
    ageMinMonths: 0,
    ageMaxYears: 18,
    referralIntakeUrl: "https://intake.dailybread.example/api/referrals",
    notes: "Largest GTA food bank. Hamper includes paediatric-appropriate fresh produce, dairy, and shelf-stable items.",
  },
  {
    id: "res-002",
    name: "Muslim Welfare Centre Food Bank",
    type: "food_bank",
    address: "100 McLevin Ave",
    city: "Scarborough",
    postalCode: "M1B 5K1",
    latitude: 43.8067,
    longitude: -79.2284,
    phone: "+1-416-754-1818",
    hours: "Mon-Fri 10:00-16:00",
    capacityWeeklyFamilies: 600,
    currentLoadPct: 91,
    languages: ["en", "ur", "ar", "bn", "hi"],
    dietaryCerts: ["halal_certified", "vegetarian_options"],
    allergenSafe: [],
    servesChildren: true,
    hasInfantFormula: true,
    ageMinMonths: 0,
    ageMaxYears: 18,
    referralIntakeUrl: "https://intake.mwcsdc.example/api/referrals",
    notes: "Halal-certified inventory. Strong reach into South Asian and Arab communities in Scarborough.",
  },
  {
    id: "res-003",
    name: "Bnai Brith Kosher Food Bank",
    type: "food_bank",
    address: "15 Hove St",
    city: "Toronto",
    postalCode: "M3H 4Y8",
    latitude: 43.7547,
    longitude: -79.4521,
    phone: "+1-416-633-6224",
    hours: "Mon, Wed 11:00-15:00; Sun 10:00-13:00",
    capacityWeeklyFamilies: 220,
    currentLoadPct: 64,
    languages: ["en", "he", "ru", "yi"],
    dietaryCerts: ["kosher_certified", "vegetarian_options"],
    allergenSafe: [],
    servesChildren: true,
    hasInfantFormula: false,
    ageMinMonths: null,
    ageMaxYears: 18,
    referralIntakeUrl: "https://intake.bnaibrith.example/api/referrals",
    notes: "Kosher-certified hampers. Low current load — capacity available.",
  },
  {
    id: "res-004",
    name: "FoodShare Toronto — Good Food Box",
    type: "produce_box",
    address: "120 Industry St",
    city: "Toronto",
    postalCode: "M6M 4L8",
    latitude: 43.6822,
    longitude: -79.4806,
    phone: "+1-416-363-6441",
    hours: "Delivery weekly; sign-up online",
    capacityWeeklyFamilies: 4500,
    currentLoadPct: 52,
    languages: ["en", "fr", "es"],
    dietaryCerts: ["vegetarian_options", "vegan_options"],
    allergenSafe: ["peanut_free_box_available", "tree_nut_free_box_available", "gluten_free_box_available"],
    servesChildren: true,
    hasInfantFormula: false,
    ageMinMonths: 6,
    ageMaxYears: 18,
    referralIntakeUrl: "https://intake.foodshare.example/api/referrals",
    notes: "Subsidized fresh-produce box delivered weekly. Allergen-aware variants available on request.",
  },
  {
    id: "res-005",
    name: "Mississauga Food Bank — Family Hub",
    type: "food_bank",
    address: "3121 Universal Dr",
    city: "Mississauga",
    postalCode: "L4X 2E2",
    latitude: 43.6207,
    longitude: -79.5867,
    phone: "+1-905-270-5589",
    hours: "Mon-Fri 9:00-17:00; Sat 10:00-14:00",
    capacityWeeklyFamilies: 1500,
    currentLoadPct: 83,
    languages: ["en", "ur", "pa", "hi", "ar", "es", "tl"],
    dietaryCerts: ["halal_certified", "vegetarian_options"],
    allergenSafe: ["peanut_free_box_available"],
    servesChildren: true,
    hasInfantFormula: true,
    ageMinMonths: 0,
    ageMaxYears: 18,
    referralIntakeUrl: "https://intake.themississaugafoodbank.example/api/referrals",
    notes: "Halal options available; strong Punjabi and Tagalog language reach.",
  },
  {
    id: "res-006",
    name: "Yonge Street Mission — Evergreen Centre Youth Meals",
    type: "meal_program",
    address: "365 Spadina Ave",
    city: "Toronto",
    postalCode: "M5T 2G3",
    latitude: 43.6536,
    longitude: -79.4012,
    phone: "+1-416-929-9614",
    hours: "Daily hot meals 12:00-14:00, 17:00-19:00",
    capacityWeeklyFamilies: 350,
    currentLoadPct: 88,
    languages: ["en", "fr"],
    dietaryCerts: ["vegetarian_options"],
    allergenSafe: [],
    servesChildren: true,
    hasInfantFormula: false,
    ageMinMonths: 24,
    ageMaxYears: 21,
    referralIntakeUrl: "https://intake.ysm.example/api/referrals",
    notes: "Hot-meal program; best for adolescents and families with older children. Not a take-home hamper.",
  },
  {
    id: "res-007",
    name: "Brampton Knights Table",
    type: "food_bank",
    address: "287 Glidden Rd",
    city: "Brampton",
    postalCode: "L6W 1H9",
    latitude: 43.6850,
    longitude: -79.7370,
    phone: "+1-905-454-8725",
    hours: "Mon-Fri 9:00-15:00",
    capacityWeeklyFamilies: 800,
    currentLoadPct: 95,
    languages: ["en", "pa", "hi", "ur"],
    dietaryCerts: ["vegetarian_options", "halal_certified"],
    allergenSafe: [],
    servesChildren: true,
    hasInfantFormula: false,
    ageMinMonths: 12,
    ageMaxYears: 18,
    referralIntakeUrl: "https://intake.knightstable.example/api/referrals",
    notes: "Capacity nearly maxed; use only when geographically necessary.",
  },
  {
    id: "res-008",
    name: "Welland Heritage Council Food Programs",
    type: "food_bank",
    address: "584 King St",
    city: "Welland",
    postalCode: "L3B 3K6",
    latitude: 42.9928,
    longitude: -79.2483,
    phone: "+1-905-732-5337",
    hours: "Mon-Thu 10:00-15:00",
    capacityWeeklyFamilies: 320,
    currentLoadPct: 71,
    languages: ["en", "fr", "es", "ar"],
    dietaryCerts: ["vegetarian_options", "halal_certified"],
    allergenSafe: ["peanut_free_box_available"],
    servesChildren: true,
    hasInfantFormula: true,
    ageMinMonths: 0,
    ageMaxYears: 18,
    referralIntakeUrl: "https://intake.wellandheritage.example/api/referrals",
    notes: "Niagara region anchor. Newcomer family supports including Arabic-speaking caseworkers.",
  },
];

export function findById(id: string): FoodResource | undefined {
  return RESOURCES.find((r) => r.id === id);
}
