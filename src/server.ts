/**
 * Nourish — Food-as-Medicine, Closed-Loop
 *
 * SHARP-on-MCP server for paediatric food-insecurity referrals.
 * Hosts four tools:
 *   - find_food_resources
 *   - submit_referral
 *   - check_referral_status
 *   - record_outcome
 *
 * Transport: Streamable HTTP at POST /mcp
 * Auth: API key via x-api-key header
 * SHARP: declares ai.promptopinion/fhir-context extension on initialize
 *
 * The platform injects FHIR context into every tool call as headers.
 * We never store patient data on the Nourish side.
 */

import express, { type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { readSharpContext, NOURISH_SHARP_SCOPES } from "./sharp/context.js";

import {
  findFoodResources,
  findFoodResourcesInput,
} from "./tools/find_food_resources.js";
import {
  submitReferral,
  submitReferralInput,
} from "./tools/submit_referral.js";
import {
  checkReferralStatus,
  checkReferralStatusInput,
} from "./tools/check_referral_status.js";
import {
  recordOutcome,
  recordOutcomeInput,
} from "./tools/record_outcome.js";

const SERVER_NAME = "nourish";
const SERVER_VERSION = "0.1.0";
const PORT = Number(process.env.PORT ?? 8080);
const REQUIRED_API_KEY = process.env.NOURISH_API_KEY;

if (!REQUIRED_API_KEY) {
  console.warn(
    "[warn] NOURISH_API_KEY env var is not set. The server will accept any caller. Set this before deploying."
  );
}

// ---------------------------------------------------------------------------
// Tool registry — single source of truth for schemas and handlers.
// ---------------------------------------------------------------------------

const tools = [
  {
    name: "find_food_resources",
    description:
      "Find ranked community food resources for a paediatric patient with food insecurity. " +
      "Hard filters apply for allergens, religious dietary law, age window, infant-formula need, and 35 km radius. " +
      "Soft ranking factors in distance, current load, language match, and clinical urgency. " +
      "The tool reads patient demographics, allergies, and language from FHIR; the agent supplies dietary and allergen requirements.",
    schema: findFoodResourcesInput,
    handler: findFoodResources,
  },
  {
    name: "submit_referral",
    description:
      "Submit a food-insecurity referral for the patient to a chosen resource. " +
      "Creates a FHIR ServiceRequest with status=active. " +
      "Returns a referral_id, which is required for check_referral_status and record_outcome.",
    schema: submitReferralInput,
    handler: submitReferral,
  },
  {
    name: "check_referral_status",
    description:
      "Read the current status of a previously submitted referral. " +
      "Reads the FHIR ServiceRequest by referral_id. " +
      "Flags referrals stale for more than 72 hours so the provider can follow up.",
    schema: checkReferralStatusInput,
    handler: checkReferralStatus,
  },
  {
    name: "record_outcome",
    description:
      "Record the terminal outcome of a referral (delivered | no_show | declined | ineligible). " +
      "Updates the ServiceRequest status to completed (delivered) or revoked (other outcomes) " +
      "and writes a FHIR Observation linked to the original ServiceRequest, " +
      "so the next provider opening the chart sees whether the intervention reached the family. " +
      "This is the loop-closing step — without it, the referral is 'submit and forget'.",
    schema: recordOutcomeInput,
    handler: recordOutcome,
  },
] as const;

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

function buildMcpServer(req: Request): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        // SHARP extension: declares the FHIR scopes Nourish needs.
        // Prompt Opinion reads this on initialize and asks the user
        // to authorize them before any tool call goes through.
        extensions: {
          "ai.promptopinion/fhir-context": {
            scopes: NOURISH_SHARP_SCOPES,
          },
        },
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (call) => {
    const tool = tools.find((t) => t.name === call.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Unknown tool: ${call.params.name}`,
          },
        ],
      };
    }

    const ctx = readSharpContext(req);

    try {
      const parsed = tool.schema.parse(call.params.arguments ?? {});
      // The handler signature differs per-tool but every handler accepts (ctx, input).
      // The runtime validation above guarantees parsed matches the handler's input type.
      return await (tool.handler as (c: typeof ctx, i: any) => Promise<any>)(
        ctx,
        parsed
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Tool ${call.params.name} failed: ${message}`,
          },
        ],
      };
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Tiny Zod -> JSON Schema converter for the tools listing.
// We keep this minimal rather than pulling in zod-to-json-schema.
// ---------------------------------------------------------------------------

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as any)._def;
  if (def.typeName === "ZodObject") {
    const shape = def.shape();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
      if (!(value as any).isOptional()) required.push(key);
    }
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
    };
  }
  if (def.typeName === "ZodArray") {
    return { type: "array", items: zodToJsonSchema(def.type) };
  }
  if (def.typeName === "ZodEnum") {
    return { type: "string", enum: def.values };
  }
  if (def.typeName === "ZodString") return { type: "string" };
  if (def.typeName === "ZodNumber") return { type: "number" };
  if (def.typeName === "ZodBoolean") return { type: "boolean" };
  if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") {
    return zodToJsonSchema(def.innerType);
  }
  if (def.typeName === "ZodUnion") {
    return { anyOf: def.options.map(zodToJsonSchema) };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    server: SERVER_NAME,
    version: SERVER_VERSION,
    transport: "streamable-http",
    sharp_extension: "ai.promptopinion/fhir-context",
  });
});

app.post("/mcp", async (req: Request, res: Response) => {
  // 1. API-key gate
  if (REQUIRED_API_KEY) {
    const provided = req.headers["x-api-key"];
    const provided1 = Array.isArray(provided) ? provided[0] : provided;
    if (provided1 !== REQUIRED_API_KEY) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
  }

  // 2. New per-request server + transport. Streamable HTTP is stateless;
  //    we build a fresh MCP server for this request so we can read the
  //    SHARP context off the live req object inside tool handlers.
  const server = buildMcpServer(req);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(
    `[nourish] listening on :${PORT}  (POST /mcp, GET /health)\n` +
      `[nourish] SHARP scopes: ${NOURISH_SHARP_SCOPES.map((s) => s.name).join(", ")}`
  );
});
