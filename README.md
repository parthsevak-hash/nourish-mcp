# Nourish — Food-as-Medicine, Closed-Loop

> Paediatricians screen 13M food-insecure U.S. kids; only 30% of referrals reach a meal. Nourish is a SHARP-on-MCP server that closes the loop — clinic to pantry to outcome, back in the chart.

A SHARP-on-MCP server for paediatric food-insecurity referrals. Built for the Prompt Opinion **Agents Assemble — The Healthcare AI Endgame** hackathon (May 2026).

![tests](https://img.shields.io/badge/tests-14_passing-brightgreen)
![mcp](https://img.shields.io/badge/MCP-Streamable_HTTP-blue)
![fhir](https://img.shields.io/badge/FHIR-R4-blue)
![sharp](https://img.shields.io/badge/SHARP-on--MCP-blue)

---

## What it does

Four MCP tools that turn a paediatric food-insecurity screening into a closed-loop, outcomes-tracked clinical referral:

| Tool | Purpose | FHIR effect |
|---|---|---|
| `find_food_resources` | Match patient to community food resources | Reads `Patient`, `AllergyIntolerance` |
| `submit_referral` | Submit referral to the chosen resource | Creates `ServiceRequest` + `Task` |
| `check_referral_status` | Track the referral through its lifecycle | Reads `Task` |
| `record_outcome` | Close the loop with a terminal outcome | Updates `Task`, creates `Observation` |

### The architectural-matching principle

Allergens, religious dietary law, age window, and infant-formula need are enforced as **typed function parameters and deterministic hard filters**, not free-form prompt instructions. An agent physically cannot route a peanut-containing pantry box to a peanut-allergic child — because the matcher does not return that resource. Generative reasoning happens only over the safe candidate set: choosing among, not selecting in spite of.

These safety properties are proven in code. See [`test/matcher.test.ts`](./test/matcher.test.ts) — 14 tests covering peanut allergy, halal, kosher, infant formula, age window, and combined-constraint cases. All pass in under 350ms.

### The closed-loop principle

Every referral creates a FHIR `Task` with a terminal status. The absence of a closure event is itself signal — `check_referral_status` flags any referral stale for over 72 hours so the provider can follow up. `record_outcome` writes a FHIR `Observation` linked to the original `ServiceRequest`, so the next provider opening the chart sees both the screening result *and* whether the intervention reached the family.

Without that link, every referral is "submit and forget." With it, the chart tells the truth.

---

## Architecture

```
Clinician on Prompt Opinion Launchpad
     |
     v
BYO Agent: Nourish — Paediatric Food-as-Medicine
     |  (LLM reasons, picks tool, fills params)
     v
Prompt Opinion injects FHIR context headers into every tool call:
     |    X-FHIR-Server-URL
     |    X-FHIR-Access-Token
     |    X-Patient-ID
     v
Nourish MCP Server  ◀── this repo
     |
     |── find_food_resources    (deterministic match → ranked list)
     |── submit_referral        (creates FHIR ServiceRequest + Task)
     |── check_referral_status  (reads FHIR Task, flags 72h+ stale)
     |── record_outcome         (updates Task, writes Observation)
     |
     v
Patient FHIR record (in the EHR / FHIR sandbox)
```

The MCP server holds **no patient data** of its own. Every read flows through the platform-injected FHIR access token. Every write goes back to the same FHIR server. The Nourish service itself is stateless across requests.

---

## SHARP scopes requested

Nourish declares these scopes via the `ai.promptopinion/fhir-context` MCP extension on `initialize`. The platform shows the workspace owner a consent screen at registration time.

| Scope | Required | Why Nourish needs it |
|---|---|---|
| `patient/Patient.rs` | yes | Identity, demographics, language, household location |
| `patient/Condition.rs` | yes | Clinical reason supporting nutritional risk |
| `patient/AllergyIntolerance.rs` | yes | Hard safety constraint on resource matching |
| `patient/Observation.rs` | yes | Read prior SDOH screenings |
| `patient/Observation.cuds` | yes | Write intervention outcomes |
| `patient/ServiceRequest.cuds` | yes | Create the referral itself |
| `patient/Task.cuds` | yes | Track referral lifecycle |

---

## Example: a Halal-observant family with a peanut-allergic two-year-old

### `find_food_resources` — request

```json
{
  "method": "tools/call",
  "params": {
    "name": "find_food_resources",
    "arguments": {
      "required_dietary_certs": ["halal_certified"],
      "required_allergen_safe": ["peanut_free_box_available"],
      "urgency": "routine"
    }
  }
}
```

### `find_food_resources` — response (excerpt)

```json
{
  "patient_summary": {
    "patient_id": "example-patient-id",
    "age_months": 24,
    "household_languages": ["en", "ur"],
    "documented_allergies": ["Peanut allergy"]
  },
  "matching_inputs": {
    "required_dietary_certs": ["halal_certified"],
    "required_allergen_safe": ["peanut_free_box_available"],
    "requires_infant_formula": false
  },
  "matches": [
    {
      "resource_id": "res-005",
      "name": "Mississauga Food Bank — Family Hub",
      "distance_km": 18.4,
      "score": 92.5,
      "languages": ["en", "ur", "pa", "hi", "ar", "es", "tl"],
      "dietary_certs": ["halal_certified", "vegetarian_options"],
      "allergen_safe": ["peanut_free_box_available"],
      "current_load_pct": 83,
      "rationale": [
        "18.4 km from family",
        "speaks en, ur"
      ]
    }
  ]
}
```

The agent sees only resources that pass the hard safety filters. It then picks among them based on the rationale and asks the clinician to confirm before calling `submit_referral`.

---

## Local development

```bash
npm install
npm run dev      # tsx watch on src/server.ts
npm test         # 14 safety + ranking tests, ~300ms
npm run build    # tsc to dist/
npm start        # node dist/server.js
```

The server starts on `http://localhost:8080`. Health check at `GET /health`. MCP endpoint at `POST /mcp`.

In dev with `NOURISH_API_KEY` unset, the server accepts all callers (logged as a warning at startup). In production, set the env var; clients must send `x-api-key: <value>`.

---

## Deploying to Render

This repo includes [`render.yaml`](./render.yaml) — a Render Blueprint that provisions everything in one click.

1. Push the repo to GitHub.
2. In the Render dashboard: **New +** → **Blueprint** → connect this repo.
3. Render reads `render.yaml`, provisions the web service, and auto-generates `NOURISH_API_KEY`.
4. Wait ~3 minutes. Your endpoint is at `https://<service-name>.onrender.com/mcp`.

(Free tier sleeps after idle. First request after sleep takes ~30s. For a live demo, hit `/health` 30 seconds before the camera rolls.)

---

## Registering on Prompt Opinion

1. **Configuration → MCP Servers → Add MCP Server**
2. Fill in:
   - **Friendly Name:** `Nourish`
   - **Endpoint:** `https://<your-deploy>.onrender.com/mcp`
   - **Transport Type:** `Streamable HTTP`
   - **Authentication Type:** `API Key`
   - **API Key Header Name:** `x-api-key`
   - **API Key Header Value:** the `NOURISH_API_KEY` Render generated
3. Click **Continue**. The platform sends `initialize` and reads the SHARP extension declaration.
4. The consent screen lists the seven FHIR scopes Nourish requests. Authorize them.
5. Save.

---

## Wiring up the BYO Agent

1. **Agents → BYO Agents → Add AI Agent**
2. **Name:** `Nourish — Paediatric Food-as-Medicine`
3. **System Prompt:** click **Load Default**, then append the prompt from [`prompts/system.md`](./prompts/system.md).
4. **Tools:** attach the `Nourish` MCP server. All four tools become available to the agent.
5. **A2A & Skills:** enable A2A. Declare two skills:
   - `screen_and_refer` — find resources, submit a referral
   - `track_to_outcome` — check status, record outcome

   Mark FHIR context as **required**.
6. Save and enable on the Launchpad.

---

## Publishing to the Marketplace

After end-to-end success on at least one patient: **Marketplace Studio → MCP Servers → New Listing**.

The published Marketplace URL is what gets pasted into the **"Published URL from Prompt Opinion Marketplace"** field on the Devpost submission form.

---

## Sample data, honestly disclosed

The seeded resource directory in [`src/directory/resources.ts`](./src/directory/resources.ts) references real, publicly-listed Greater Toronto Area food relief organizations — Daily Bread, Muslim Welfare Centre, B'nai Brith Kosher Food Bank, FoodShare Toronto, Mississauga Food Bank, Yonge Street Mission, Knights Table, Welland Heritage Council. Their names and approximate addresses are publicly correct.

Everything else — referral intake URLs (which use the IANA-reserved `.example` TLD per RFC 2606), current-load percentages, weekly-family capacity, age windows, allergen-safe variants, and language coverage — is illustrative sample data structured for the hackathon. **None of these organizations have endorsed or reviewed Nourish.**

In production, this directory would be sourced from a community-resource aggregator (Findhelp / Aunt Bertha, 211, regional food-bank network APIs) with each org self-attesting the structured attributes Nourish matches on.

---

## Repository layout

```
nourish-mcp/
├── src/
│   ├── server.ts                 Streamable HTTP MCP server, API-key auth, SHARP extension declaration
│   ├── sharp/
│   │   └── context.ts            Reads FHIR context headers; declares SHARP scopes
│   ├── fhir/
│   │   └── client.ts             Minimal FHIR R4 client; never persists patient data
│   ├── directory/
│   │   ├── resources.ts          Seeded GTA food-resource directory (sample data, see above)
│   │   └── matcher.ts            Two-stage matcher: hard safety filters then ranked scoring
│   └── tools/
│       ├── find_food_resources.ts
│       ├── submit_referral.ts
│       ├── check_referral_status.ts
│       └── record_outcome.ts
├── test/
│   └── matcher.test.ts           14 tests covering every safety-critical filter
├── prompts/
│   └── system.md                 BYO Agent system prompt (paste into Prompt Opinion)
├── render.yaml                   One-click Render Blueprint
├── package.json
├── tsconfig.json
├── tsconfig.test.json
└── README.md
```

---

## License

MIT. See [`LICENSE`](./LICENSE).
