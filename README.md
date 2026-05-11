# Nourish — Food-as-Medicine, Closed-Loop

> Paediatricians screen 13M food-insecure U.S. kids; only 30% of referrals reach a meal. Nourish is a SHARP-on-MCP server that closes the loop — clinic to pantry to outcome, back in the chart.

A SHARP-on-MCP server for paediatric food-insecurity referrals. Built for the Prompt Opinion **Agents Assemble — The Healthcare AI Endgame** hackathon (May 2026).

![tests](https://img.shields.io/badge/tests-14_passing-brightgreen)
![mcp](https://img.shields.io/badge/MCP-Streamable_HTTP-blue)
![fhir](https://img.shields.io/badge/FHIR-R4-blue)
![sharp](https://img.shields.io/badge/SHARP-on--MCP-blue)
![live](https://img.shields.io/badge/status-live-success)

---

## Live demo

The production server is deployed on Render and listed in the Prompt Opinion Marketplace.

- **Health check:** [https://nourish-mcp.onrender.com/health](https://nourish-mcp.onrender.com/health) — returns the server identity and SHARP extension declaration.
- **MCP endpoint:** `https://nourish-mcp.onrender.com/mcp` — Streamable HTTP transport, API-key authenticated.
- **Demo video:** [Link added after recording]
- **Prompt Opinion Marketplace listing:** [https://app.promptopinion.ai/marketplace/mcp/019e1404-b589-7da9-9a15-18431729655c](https://app.promptopinion.ai/marketplace/mcp/019e1404-b589-7da9-9a15-18431729655c)

> The free-tier Render service sleeps after ~15 minutes of inactivity. The first request after sleep takes ~30 seconds to wake. Subsequent requests are fast.

---

## What it does

Four MCP tools that turn a paediatric food-insecurity screening into a closed-loop, outcomes-tracked clinical referral:

| Tool | Purpose | FHIR effect |
|---|---|---|
| `find_food_resources` | Match patient to community food resources | Reads `Patient`, `AllergyIntolerance` |
| `submit_referral` | Submit referral to the chosen resource | Creates `ServiceRequest` (status=active) |
| `check_referral_status` | Track the referral through its lifecycle | Reads `ServiceRequest` |
| `record_outcome` | Close the loop with a terminal outcome | Updates `ServiceRequest.status`, creates `Observation` |

### The architectural-matching principle

Allergens, religious dietary law, age window, and infant-formula need are enforced as **typed function parameters and deterministic hard filters**, not free-form prompt instructions. An agent physically cannot route a peanut-containing pantry box to a peanut-allergic child — because the matcher does not return that resource. Generative reasoning happens only over the safe candidate set: choosing among, not selecting in spite of.

These safety properties are proven in code. See [`test/matcher.test.ts`](./test/matcher.test.ts) — 14 tests covering peanut allergy, halal, kosher, infant formula, age window, and combined-constraint cases. All pass in under 350ms.

### The closed-loop principle

The single FHIR `ServiceRequest` resource is both the clinical order and the lifecycle handle. Its `status` field follows the standard FHIR R4 state machine — `active` while the referral is in flight, `completed` when the family has received food, `revoked` when the referral ends without delivery. `check_referral_status` flags any referral active for more than 72 hours so the provider can follow up. `record_outcome` writes a FHIR `Observation` linked via `derivedFrom` to the original `ServiceRequest`, so the next provider opening the chart sees both the screening result *and* whether the intervention reached the family.

Without that link, every referral is "submit and forget." With it, the chart tells the truth.

---

## Architecture

```
Clinician on Prompt Opinion Launchpad
     |
     v
BYO Agent: Nourish — Paediatric Food-as-Medicine
     |  (Gemini 2.5 Flash reasons, picks tool, fills params)
     v
Prompt Opinion injects FHIR context headers into every tool call:
     |    X-FHIR-Server-URL
     |    X-FHIR-Access-Token
     |    X-Patient-ID
     v
Nourish MCP Server  ◀── this repo
     |
     |── find_food_resources    (deterministic match → ranked list)
     |── submit_referral        (creates FHIR ServiceRequest, status=active)
     |── check_referral_status  (reads ServiceRequest, flags 72h+ active)
     |── record_outcome         (updates ServiceRequest.status, writes Observation)
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
| `patient/ServiceRequest.rs` | yes | Read referral status during lifecycle tracking |
| `patient/ServiceRequest.cud` | yes | Create the referral and transition it to terminal state on closure |

Seven scopes total. The architecture intentionally keeps the FHIR resource graph minimal: one `ServiceRequest` per referral acts as both the clinical order and the lifecycle handle. The `Task` resource is not used. This keeps the consent surface tighter and aligns with the most common SDOH-referral implementation pattern in the field.

The `ServiceRequest` scope is split into `.rs` (read + search) and `.cud` (create + update + delete) because SMART scope grammar treats reads-by-id separately from writes — and the Prompt Opinion platform's scope catalog renders them as distinct checkboxes.

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

### Observability

Every MCP request and every FHIR call is logged to stdout in structured form:

```
[mcp] in  method=tools/call tool=find_food_resources sharp={"fhir_url":"present","fhir_token":"present","patient_id":"..."}
[fhir] base=https://app.promptopinion.ai/api/workspaces/.../fhir
[fhir] GET Patient/... -> 200 (501ms)
[fhir] GET AllergyIntolerance?patient=... -> 200 (248ms)
[mcp] out method=tools/call tool=find_food_resources status=200 dur_ms=758
```

This is what proves an agent is actually calling tools rather than hallucinating outputs. Recommended viewing during development: `tail -f` your stdout or filter Render Logs by `tool=`.

---

## Deploying to Render

This repo includes [`render.yaml`](./render.yaml) — a Render Blueprint that provisions everything in one click.

1. Push the repo to GitHub.
2. In the Render dashboard: **New +** → **Blueprint** → connect this repo.
3. Render reads `render.yaml`, provisions the web service, and auto-generates `NOURISH_API_KEY`.
4. Wait ~3 minutes. Your endpoint is at `https://<service-name>.onrender.com/mcp`.

The Blueprint pins Node 22 LTS via `.node-version`, uses `npm install --include=dev` (devDependencies are needed at build time for `tsc`), and sets `NODE_ENV=production` for runtime.

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
4. **Enable Prompt Opinion Extension** toggle: ON.
5. Pick **Selective Permissions** (recommended over Full Authority). The consent screen lists the seven FHIR scopes Nourish requests. Authorize them.
6. Save.

---

## Wiring up the BYO Agent

1. **Agents → BYO Agents → Add AI Agent**
2. **Name:** `Nourish — Paediatric Food-as-Medicine`
3. **Allowed Contexts:** Patient (only)
4. **Model Configuration:** Gemini 2.5 Flash (or any reasoning model that supports MCP tool calls)
5. **Po Chat Selectable:** ON
6. **System Prompt:** click **Load Default**, then append the prompt from [`prompts/system.md`](./prompts/system.md).
7. **Tools:** attach the `Nourish` MCP server. All four tools become available to the agent.
8. **A2A & Skills:** enable A2A. Enable FHIR Context Extension. Declare two skills:
   - `screen_and_refer` — find resources, submit a referral
   - `track_to_outcome` — check status, record outcome
9. Save and enable on the Launchpad.

---

## Marketplace listing

Nourish is published on the [Prompt Opinion Marketplace](https://app.promptopinion.ai/marketplace/mcp/019e1404-b589-7da9-9a15-18431729655c) and is installable by any Prompt Opinion workspace. The listing surfaces the seven SHARP scopes Nourish requests at install time, and connects to the live server running at `https://nourish-mcp.onrender.com/mcp`.

Authentication is required — contact the publisher for an API key. The server stores no patient data of its own; every read flows through the platform-injected access token.

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
│   ├── server.ts                 Streamable HTTP MCP server, API-key auth, SHARP extension declaration, request/response logging
│   ├── sharp/
│   │   └── context.ts            Reads FHIR context headers; declares the 7 SHARP scopes
│   ├── fhir/
│   │   └── client.ts             Minimal FHIR R4 client with structured logging; never persists patient data
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
├── .node-version                 Pinned: 22
└── README.md
```

---

## Acknowledgements

Built on the [Model Context Protocol](https://modelcontextprotocol.io) and the [SMART-on-FHIR](https://hl7.org/fhir/smart-app-launch/) scope grammar. Deployed on the [Prompt Opinion](https://promptopinion.ai) platform.

---

## License

MIT. See [`LICENSE`](./LICENSE).