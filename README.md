# AgentGate

AgentGate is a policy-enforcing outbound tool gateway for AI agents. It exposes governed actions through an MCP server and executes policy decisions in a Rust WebAssembly contract hosted by Terminal 3.

## Architecture

```
MCP client
   |
   | call_endpoint(endpoint, path, method, body)
   v
MCP server (mcp/server.ts)
   |
   v
AgentGate contract (Rust -> WASM, z:<tenant>:agentgate)
   |  validate endpoint, path, placeholders, grants, and response fields
   |  read sealed credentials and invoke the host HTTP interface
   |  append an audit record
   v
Registered upstream API
```

The agent selects a registered endpoint name rather than supplying an arbitrary URL. The contract requires exact path matches, restricts `{{profile.*}}` placeholders to the endpoint allowlist, and projects upstream responses to declared fields. Placeholder names are recorded in the audit ledger; substituted values are not.

## Security properties

- **Endpoint allowlisting:** agents cannot introduce arbitrary hosts or paths.
- **Placeholder scoping:** only profile fields explicitly allowed by the endpoint may be substituted.
- **Credential isolation:** upstream credentials are loaded from the tenant's sealed secrets map.
- **Response minimisation:** only declared response fields are returned.
- **Auditability:** both allowed and denied attempts are appended to the ledger.
- **Tenant-controlled grants:** the data owner controls permitted agent functions and hosts.

## Repository structure

| Path | Purpose |
| --- | --- |
| `contract/` | Production Rust contract and WIT bindings. |
| `mcp/server.ts` | MCP server exposing governed tools. |
| `scripts/t3n.ts` | Shared Terminal 3 client/session setup. |
| `scripts/deploy.ts` | Idempotent deployment, map ACL setup, endpoint seeding, and grants. |
| `scripts/doctor.ts` | Deployment and configuration pre-flight checks. |
| `scripts/demo.ts` | End-to-end demonstration. |
| `agentgate.config.json` | Declarative endpoints, secrets, maps, and grant defaults. |
| `deployments.json` | Contract versions and IDs issued by deployment. |
| `probes/` | Standalone platform behavior probes. |
| `docs/` | Architecture, handover, and verified platform findings. |

## Requirements

- Node.js 18 or newer
- npm
- Rust with the `wasm32-wasip2` target
- A Terminal 3 testnet API key for deployment and live demos

```bash
rustup target add wasm32-wasip2
```

## Quick start

```bash
npm install
cp .env.example .env
# Set T3N_API_KEY and the other values required by .env.example.

npm test       # Native Rust policy tests; no network or credits required.
npm run build  # Build the contract WASM artifact.
npm run deploy # Register/reconcile the deployment and grants.
npm run doctor # Check an existing deployment.
npm run demo   # Run the end-to-end testnet demonstration.
```

The deploy script records contract IDs in `deployments.json`. If the WASM hash is unchanged, registration is skipped. When a new contract ID is issued, map ACLs are re-applied to the current ID.

## MCP configuration

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/agentgate/mcp/server.ts"]
    }
  }
}
```

The MCP server owns the Terminal 3 session. The model receives the governed tool interface, not the tenant API key or upstream credentials.

## Endpoint configuration

Endpoints are declared in `agentgate.config.json`; adding or changing endpoint policy does not require Rust changes:

```json
{
  "stripe": {
    "base": "https://api.stripe.com",
    "secret_key": "stripe_api_key",
    "auth_header": "Authorization",
    "auth_prefix": "Bearer ",
    "allowed_paths": ["/v1/customers"],
    "allowed_placeholders": ["first_name", "verified_contacts.email.value"],
    "response_fields": ["id"]
  }
}
```

Paths are exact matches. `secret_key` refers to a value in the tenant's sealed secrets map. `response_fields` is an allowlist; fields not listed are removed from the response. Apply configuration changes with:

```bash
npm run deploy
```

## Current status

The repository contains an end-to-end testnet implementation using `@terminal3/t3n-sdk@5.2.0`. Migration to the newer SDK and `host:tenant@2.0.0` interface is intentionally pending bounty-review results; see the migration note in `scripts/t3n.ts`.

The project has been tested with tenant, data-owner, and agent identities. The agent uses an opaque bearer credential and does not receive the tenant API key, upstream credentials, URL policy, or substituted profile values.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — request lifecycle and trust boundaries
- [Handover](docs/HANDOVER.md) — deployment and operations runbook
- [Platform findings](docs/BUGS.md) — verified constraints and runnable reproductions
- [Probes](probes/README.md) — diagnostic probe index
