# AgentGate — Terminal 3 ADK Challenge submission

**Repo:** https://github.com/Anshv784/agentgate
**Built by:** Ansh Verma ([@Anshv784](https://github.com/Anshv784))
**Tenant DID:** `did:t3n:ae94de9bdfddc5e8ae1c75d41404425f01f6c005`
**SDK:** `@terminal3/t3n-sdk@5.2.0` · testnet (`cn-api.sg.testnet.t3n.terminal3.io`)

---

## 1. What I built and why

Most "enterprise agent" builds put the credential in the agent's environment and the
policy in the agent's prompt. Both fail the same way: the thing being restrained is the
thing holding the restraints. Prompt-level policy is advisory, and the audit trail is
written by the process you're auditing.

**AgentGate** moves policy, credentials, and the ledger across a hardware boundary the
agent cannot reach — a Rust/WASM contract in an Intel TDX enclave on T3N.

The agent names an **endpoint**, not a URL. It holds no credential. It never sees the
user's personal data. Every attempt it makes — allowed or denied — lands in a ledger it
cannot edit.

It ships as an **MCP server**, so any MCP client (Claude Code, Claude Desktop, Cursor, an
SDK agent) gets governed tool calls by adding one config entry.

**I deliberately did not build another vertical demo agent.** The guardrail is the
reusable part; the vertical isn't. `scripts/demo.ts` is a ~60-line disposable example on
top. The intended user of this project is another Terminal 3 developer.

### Architecture

```
  MCP client (Claude / Cursor / any agent)
    │  call_endpoint { endpoint: "resend", path: "/emails",
    │                  body: { to: ["{{profile.verified_contacts.email.value}}"] } }
    ▼
  AgentGate MCP server              ← holds the T3N session; the model holds nothing
    ▼
┌─ z:<tid>:agentgate — TEE contract ────────────────────────────────────────┐
│  1. every {{…}} marker must be profile.* AND on this endpoint's allowlist │
│  2. path must be one the tenant enumerated — exact match, no globs        │
│  3. credential read from the sealed z:<tid>:secrets map                   │
│  4. host substitutes real PII inside the enclave                          │
│  5. upstream response projected to declared fields only                   │
│  6. ledger entry appended — for ALLOWED and DENIED alike                  │
└───────────────────────────────────────────────────────────────────────────┘
    ▼   api.resend.com  ← reached only if the data owner's grant permits this host
```

## 2. It runs. Full three-identity flow

| Principal | Holds | Role |
|---|---|---|
| **Tenant** | eth key, funded | owns the contract, seals the credential, enumerates policy |
| **Data owner** | own DID + profile | grants the agent; markers resolve against their profile |
| **Agent** `did:t3n:9e4a…3209` | an opaque bearer token, nothing else | makes every call below |

The agent's signing key was minted inside the TEE and never left it.

```
🛑 DENIED   profile field outside the endpoint's allowlist  ({{profile.ssn}})
            marker rejected: 'ssn' is not in this endpoint's allowed_placeholders
🛑 DENIED   marker reaching for another namespace  ({{secret.resend_api_key}})
            marker rejected: 'secret.resend_api_key' is not a profile marker
🛑 DENIED   path the tenant never enumerated  (/domains)
            path rejected: '/domains' is not in this endpoint's allowed_paths
🛑 DENIED   endpoint that does not exist  (stripe)
            unknown endpoint

── policy is per-ENDPOINT, not per-host ──────────────────────────────
   'resend' and 'resend-notify' share a host AND a credential.
   The same marker is allowed on one and refused on the other.

✅ ALLOWED  {{profile.first_name}} via 'resend'        (allowlisted there)
            {"data":{"id":"d7299ce6-668f-47f2-8e22-8f3f96c0f255"},"status":200}
🛑 DENIED   {{profile.first_name}} via 'resend-notify' (allowlist is empty)
            marker rejected: 'first_name' is not in this endpoint's allowed_placeholders
✅ ALLOWED  no markers via 'resend-notify'             (allowed, returns nothing)
            {"data":{},"status":200}
```

Real emails were delivered. The recipient's address and name were resolved inside the
enclave from the data owner's profile — they appear nowhere in the agent's input, the MCP
transport, the contract's memory, or the ledger.

The last line is the deny-by-default response projection: `resend-notify` declares no
`response_fields`, so a successful call returns a status code and an empty object. Even the
upstream's message id is withheld.

The ledger afterwards:

```
denied     0  resend/emails         markers=["profile.ssn", …]        'ssn' not allowed here
denied     0  resend/emails         markers=["secret.resend_api_key"] not a profile marker
denied     0  resend/domains        markers=[]                        path not enumerated
denied     0  stripe/emails         markers=[]                        unknown endpoint
ok       200  resend/emails         markers=["first_name","last_name","verified_contacts.email.value"]
denied     0  resend-notify/emails  markers=["profile.first_name", …] 'first_name' not allowed here
ok       200  resend-notify/emails  markers=[]
```

Marker *names* are recorded. Marker *values* were never available to record.

## 3. Ease of maintenance

This was the criterion I optimised hardest for, because two platform behaviours make the
most likely production failure **invisible**:

1. Re-registering a contract tail mints a **new** `contract_id`, and no API returns a
   tail's current id (confirmed in 5.2.0 — `DetailedContract` has no such field).
2. Map ACLs are scoped to that id, and no API reads an ACL back (`getStatus` returns
   `"active"` and nothing else).

Together: a redeploy silently orphans the contract's access to its own secrets, and no
introspection path can tell you. So:

- **`scripts/deploy.ts`** keeps the id ledger itself in `deployments.json` (committed) and
  re-applies every map ACL on every run. The failure cannot occur. It also skips
  registration when the wasm hash is unchanged — **~160 credits instead of ~1,850**.
- **`scripts/doctor.ts`** verifies functionally, by asking the contract to read one of its
  own maps, rather than trusting metadata that doesn't exist. Exits non-zero on failure.
- **Adding an endpoint is one JSON block and no Rust.** Demonstrated: `resend-notify` was
  added after the contract was already deployed. Output from that run:
  ```
  register  SKIP (wasm unchanged, id 753, v0.1.0) — saves ~1700 credits
  endpoint  SET  resend-notify -> https://api.resend.com paths=["/emails"]
  ```
- **9 native policy tests** run with no network and no credits.

```bash
npm run doctor   # ALWAYS first. non-zero = do not proceed
npm run deploy   # idempotent; install tool and repair tool
npm run demo     # the run above
npm run test     # 9 tests, no credits
```

### Measured cost

| Operation | Tokens |
|---|---|
| First deploy | ~3,250 |
| Redeploy, unchanged wasm | ~160 |
| Redeploy, changed wasm | ~1,850 |
| One governed call | ~150 |
| Entire build session | ~6,800 of 20,000 |

Registration dominates. The published "~25 agents and ~5,000 protected actions" is only
reachable if you almost never redeploy.

## 4. Bugs

13 findings in [`docs/BUGS.md`](https://github.com/Anshv784/agentgate/blob/main/docs/BUGS.md),
each with a runnable reproduction in [`probes/`](https://github.com/Anshv784/agentgate/tree/main/probes)
mapped to its number. The five I'd act on first:

### #1 — Host duplicates `Content-Type` (high)
A contract that sets its own `Content-Type` causes the upstream to receive
`application/json,application/json`. Not a valid media type; strict servers drop the body.
**It fails silently — HTTP 200 with nothing parsed.**

| Contract sends | Upstream receives | Parsed |
|---|---|---|
| `headers: Some([("Content-Type","application/json")])` | `application/json,application/json` | ❌ `data:{}` |
| `headers: None` | `application/json` | ✅ |

Every documented example sets its own headers, including `z-tenant-flight/src/booking.rs:104`
— so the official reference is shipping a malformed header to Duffel today.
*Fix: replace rather than append.* Repro: `probes/bug01-content-type-doubling.ts`

### #10 — Org-minted agents cannot make a single call (blocking)
`createAgent()` mints an agent whose key never leaves the TEE, so its only path is
`POST /api/invoke`. That path fails on the first call:
```
403 {"error":"InsufficientCredit (account=9e4a…3209, required=10000000000, available=0)",
     "request_id":"6e5d0598-1e07-4ccb-9b73-4f73bb741404"}
```
**10,000 tokens reserved for one call** — half the entire free grant — against a zero
balance, with no self-serve top-up. Terminal 3 cleared mine by hand after a Telegram
request; every developer will hit this.
*Fix: seed from the creating tenant, or charge the owning org.*

### #11 — `delegation.check` returns a false green (medium)
For the exact call that 403s above, the platform's own authorization oracle reports
`{"authorised": true, "missing": []}`. The preflight designed to predict failure can't model
metering. Repro: `probes/bug11-false-green-delegation.ts`

### #2 — `listContracts()` names are rejected by `getContractVersion()` (medium)
```
listContracts() → tee:user @ 3.6.0
getContractVersion("tee:user")           → 404
getContractVersion("tee:user/contracts") → 3.6.0 ✅
```
Discovery output isn't usable as dispatch input. Worse, `tee:vc`, `tee:organisation` and
`tee:agent-connect` resolve in **neither** form. Repro: `probes/bug02-contract-naming.ts`

### #5 + #13 — `contract_id` and map ACLs are both write-only (medium)
`register()` returns a `contract_id`; nothing reads it back. ACLs are set by id; nothing
reads them back. The combination makes the platform's most likely production failure
undiagnosable. This shaped the whole deploy design above.
*Fix: expose `contract_id` on `listDetailed()`, return ACLs from `getStatus()`.*

### Also filed
#3 `tips/placeholders-outbound-calls` ships Rust that cannot compile against the real WIT
(wrong `method` and `headers` types) · #4 docs are a full major version behind the SDK
(`maps.entrySet`, `contracts.logs`, `getAuditEvents`, `submitUserInput`, `kv-store.scan` all
undocumented) · #6 an SDK throw dumps 2.1 MB of obfuscated bundle to stderr · #7
`getSelfEthAddress()` disagrees with the key's own address · #8 `getUsage()` returns an empty
ledger despite 3,400 tokens of real spend · #9 credit budget planning · #12 `/api/invoke` is
`z:`-only, so a minted agent can never reach `tee:user/contracts` to inspect its own grants.

### Corrected, so nobody else chases it
The `placeholder-denied` WIT comment says markers fail on "nested" fields, which reads as
though `{{profile.verified_contacts.email.value}}` — used throughout the docs — would be
rejected. **It resolves fine.** The comment is misleading; the implementation is right.

### A design note, not a defect
`http-with-placeholders` protects the **outbound** leg only. The upstream response returns
into WASM in full, so an endpoint that echoes its request hands the contract exactly the
plaintext the markers withheld. I demonstrated this directly. Any contract touching real PII
must filter its own response — AgentGate's `response_fields` projection exists for this, and
the docs' privacy claim should say so.

## 5. Screenshots

1. `npm run demo` — four denials and the allowed send, run as the agent
2. The delivered email in the inbox, next to the agent's input showing only `{{profile.…}}`
3. `npm run doctor` — no failures, 0 warnings
4. The 403 `InsufficientCredit` with `required=10000000000` (bug #10)
5. `npm run test` — 9 passing policy tests
6. AgentGate's three tools inside an MCP client

## 6. Continue running, or hand over?

**I'd like to keep running it**, and I'm applying to the startup program / listing page.
AgentGate is infrastructure for other T3N developers, and that only works if someone
maintains it.

That said, [`docs/HANDOVER.md`](https://github.com/Anshv784/agentgate/blob/main/docs/HANDOVER.md)
is written for a stranger regardless — a project one person can run isn't a project. It
covers routine ops, a failure playbook keyed to real error strings, the cost model, and
takeover steps. **Nothing depends on my tenant, org, or keys.** There is no shared state and
no hosted service to transfer: the contract runs on Terminal 3's nodes, the MCP server runs
wherever you run it. A new maintainer claims their own key, runs `npm run deploy`, and owns a
fresh `z:<their-tid>:` namespace.

## 7. Links

- **Repo** — https://github.com/Anshv784/agentgate
- **Bugs + reproductions** — [`docs/BUGS.md`](https://github.com/Anshv784/agentgate/blob/main/docs/BUGS.md)
- **Architecture** — [`docs/ARCHITECTURE.md`](https://github.com/Anshv784/agentgate/blob/main/docs/ARCHITECTURE.md)
- **Handover runbook** — [`docs/HANDOVER.md`](https://github.com/Anshv784/agentgate/blob/main/docs/HANDOVER.md)
