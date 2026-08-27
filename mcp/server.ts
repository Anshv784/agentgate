#!/usr/bin/env node
/**
 * AgentGate MCP server.
 *
 * Point any MCP client (Claude Code/Desktop, Cursor, an SDK agent) at this and
 * its tool calls become T3N-governed: policy checked in a TEE, credentials never
 * in the model's context, PII substituted inside the enclave, every attempt
 * — allowed or denied — written to a ledger the model cannot edit.
 *
 * The trust boundary is deliberate. The model chooses an endpoint name and a
 * body. It never sees a URL, an API key, or a user's personal data. Everything
 * it CAN reach was enumerated by a human in agentgate.config.json.
 */
import { readFile } from "fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getContractVersion } from "@terminal3/t3n-sdk";
import { session } from "../scripts/t3n.js";

const cfg = JSON.parse(await readFile(new URL("../agentgate.config.json", import.meta.url), "utf8"));
const { t3n, did, tid, baseUrl } = await session(process.env.T3N_API_KEY!);
const script = `z:${tid}:${cfg.contract.tail}`;
const version = await getContractVersion(baseUrl, script);

const call = (fn: string, input: unknown) =>
  t3n.executeAndDecode({ contract_id: script, contract_version: version, function_name: fn, input });

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

const server = new McpServer({ name: "agentgate", version: "0.1.0" });

server.registerTool(
  "list_endpoints",
  {
    title: "List reachable endpoints",
    description:
      "Show every external service this agent may call, with the exact paths, " +
      "the user-profile fields it may reference, and the response fields it will " +
      "get back. Call this first — anything not listed here will be denied.",
    inputSchema: {},
  },
  async () => text(await call("endpoint-list", {})),
);

server.registerTool(
  "call_endpoint",
  {
    title: "Call an external service under policy",
    description:
      "Perform a governed HTTP call to a registered endpoint. You never supply a " +
      "URL or a credential — name the endpoint and a path it allows. To include a " +
      "user's personal data, put a {{profile.<field>}} marker in the body; the real " +
      "value is substituted inside the enclave and is never visible to you. " +
      "Denials return outcome:'denied' with a reason rather than throwing.",
    inputSchema: {
      endpoint: z.string().describe("Endpoint name from list_endpoints, e.g. 'resend'"),
      path: z.string().describe("Path to call, e.g. '/emails'. Must be in that endpoint's allowed_paths"),
      method: z.string().default("POST").describe("HTTP method"),
      body: z.record(z.any()).default({}).describe("JSON body; may contain {{profile.<field>}} markers"),
    },
  },
  async (args) => text(await call("invoke-endpoint", args)),
);

server.registerTool(
  "read_audit",
  {
    title: "Read the call ledger",
    description:
      "Read the append-only record of every call attempted through this gateway, " +
      "allowed and denied alike. Written inside the enclave; no agent can edit it. " +
      "Records which profile fields were referenced, never their values.",
    inputSchema: { limit: z.number().int().min(1).max(500).default(50) },
  },
  async ({ limit }) => text(await call("audit-list", { limit })),
);

await server.connect(new StdioServerTransport());
console.error(`agentgate mcp ready — ${script} @ ${version} as ${did}`);
