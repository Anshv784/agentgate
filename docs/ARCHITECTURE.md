# Architecture

## The problem

An AI agent that can act in the real world needs two things that fight each other:
enough access to be useful, and enough restraint to be safe. The usual answer is to
put the credential in the agent's environment and the policy in the agent's prompt.
Both are wrong in the same way: the thing being restrained is the thing holding the
restraints.

Prompt-level policy is advisory. An agent that decides to ignore it, or is talked into
ignoring it, faces nothing. And the audit trail is written by the same process, so a
misbehaving agent's account of itself is exactly as trustworthy as the agent.

## The boundary

AgentGate moves policy, credentials, and the ledger across a hardware boundary the
agent cannot reach — an Intel TDX enclave running a Rust/WASM contract on T3N.

```
   UNTRUSTED                          │  TRUSTED (TEE)
                                      │
   the model                          │
     names an endpoint + body         │
     holds no credential              │
     never sees PII                   │
        │                             │
   MCP server                         │
     holds the T3N session            │
     relays verbatim                  │
        │                             │
   ─────┼──────────── enclave boundary ─────────────────────────
        ▼                             │
                                      │  marker allowlist
                                      │  path allowlist
                                      │  credential (sealed KV)
                                      │  PII substitution
                                      │  response projection
                                      │  append-only ledger
                                      │        │
                                      │        ▼  upstream API
```

Everything to the right is enforced by the enclave. Compromising the agent process,
the MCP server, or the developer's laptop moves none of it.

## What each layer actually stops

| Attack | Stopped by | Where |
|---|---|---|
| Agent exfiltrates the API key | credential is read inside the enclave, never returned | `gateway.rs` |
| Agent calls an unintended host | egress resolved from the data owner's grant | T3N host |
| Agent calls an unintended path on an allowed host | exact-match path allowlist | `policy::resolve_path` |
| Agent reads a profile field it shouldn't | per-endpoint marker allowlist | `policy::check_markers` |
| Agent injects `{{secret.…}}` to reach another namespace | namespace check before the host sees it | `policy::check_markers` |
| Upstream echoes PII back to the agent | response projected to declared fields | `policy::filter_response` |
| Agent hides its own denials | ledger written on the `Ok` path (see below) | `gateway::denied` |

## Three decisions that came from measurement

### Denials return `Ok`, never `Err`

T3N rolls back contract writes when a function returns an error. Returning `Err` on a
policy denial would roll back the audit entry recording that denial. An agent could then
probe the policy surface indefinitely and leave nothing behind.

So `invoke_endpoint` returns `Ok({outcome: "denied", reason, audit_key})`. The ledger
write commits. Only genuinely unrecoverable conditions (malformed input, a missing
secret) return `Err`, and those are conditions no agent can trigger selectively.

### Responses are projected, not passed through

`http-with-placeholders` substitutes PII into the *outbound* request inside the enclave.
It says nothing about the response, which returns into WASM in full. An endpoint that
echoes its request — many do, deliberately or not — hands the contract exactly the
plaintext the mechanism withheld. We demonstrated this directly; see `docs/BUGS.md`,
"Design note".

So every endpoint declares `response_fields`, and anything else is dropped before the
result leaves the enclave. Declaring nothing yields a status code and nothing else:
deny-by-default, because the failure mode of the opposite default is a silent leak.

### The contract sets no `Content-Type`

The host appends its own `Content-Type` rather than replacing the contract's, producing
`application/json,application/json`. That is not a valid media type; strict upstreams
drop the body and return 200 with nothing parsed. This is `docs/BUGS.md#1`, and it
affects Terminal 3's own reference contract. AgentGate sets only `Authorization` and
whatever an endpoint declares in `extra_headers`.

## Why an MCP server rather than an agent

The obvious build for this bounty is one vertical agent — HR onboarding, invoice
approval, support triage. We built the layer underneath instead, because the guardrail
is the reusable part and the vertical is not. An MCP server means any existing agent
gains governed calls by adding one config entry, with no framework commitment and no
rewrite. `scripts/demo.ts` is the vertical example; it is ~60 lines and disposable.

## Identity model

Three principals, and the platform creates each differently — the docs imply you claim
all three, but the claim page issues one.

| Principal | Created by | Authenticates with | Balance |
|---|---|---|---|
| **Tenant** | claim page (SSO) | `T3nClient` session (SIWE over an eth key) | funded |
| **User** (data owner) | any secp256k1 keypair; DID minted on first `authenticate()` | `T3nClient` session | 0 |
| **Agent** | `createOrganisation()` → `createAgent()`; key minted in-TEE, never exported | bearer token only | 0 |

The data owner grants the agent access to specific functions on a specific contract,
scoped to specific hosts. The agent authenticates as itself and acts *for* a subject
(`pii_did`), whose profile the markers resolve against.

In this deployment the tenant DID stands in as data owner and caller, because a minted
agent cannot pay for its first call (`docs/BUGS.md#10`). The grant to the agent DID is
already applied; funding it is the only step between here and the full separation.

## Operational design

Two facts about this platform shaped the tooling more than anything else:

1. Re-registering a contract tail mints a **new** `contract_id`, and no API returns a
   tail's current id.
2. Map ACLs are scoped to that id, and no API reads an ACL back.

Together: the most likely production failure — a redeploy orphaning the contract's
access to its own secrets — is invisible to every introspection path.

`scripts/deploy.ts` therefore keeps the id ledger itself in `deployments.json`
(committed) and re-applies every map ACL on every run, so the failure cannot occur.
`scripts/doctor.ts` verifies it functionally, by asking the contract to read one of its
own maps, rather than trusting metadata that does not exist.
