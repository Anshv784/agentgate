# Bugs & doc defects — Terminal 3 ADK

Environment: `@terminal3/t3n-sdk@5.2.0`, node `cn-api.sg.testnet.t3n.terminal3.io`,
Node v24.7.0, macOS 15 (arm64), rustc 1.97.1, target `wasm32-wasip2`.
Tenant `did:t3n:ae94de9b…c005`.

Every finding below was hit while building a real contract, not while reading docs.
Where a bug can be shown rather than described, there is a runnable script in
[`../probes/`](../probes/) that prints what the platform actually returned.

**Re-verified 2026-08-28.** Every finding was re-checked against the live testnet or the
shipped SDK before submission — not trusted from notes. #1, #2, #7, #8, #10 and #12 were
re-run against the node; #3, #4, #5, #6 and #13 were re-checked against `package.wit` and
`dist/index.d.ts`. Three claims were wrong and are corrected here: #1 originally asserted
that the `z-tenant-flight` reference contract ships the malformed header (it does not — it
avoids it deliberately), #6 overstated the bundle size, and #9's starting balance was
misstated. #11 has been reframed on evidence that survives #10 being funded.

## Index

| # | Finding | Severity | Reproduction |
|---|---|---|---|
| 10 | Org-minted agents cannot make a single call | **blocking** *(resolved by hand)* | `bug10-12-agent-invoke.ts` |
| 1 | Host duplicates `Content-Type`, corrupting the header upstream | **high** | `bug01-content-type-quick.ts` |
| 2 | `listContracts()` returns names `getContractVersion()` rejects | medium | `bug02-contract-naming.ts` |
| 3 | `tips/placeholders-outbound-calls` ships Rust that cannot compile | medium | — |
| 4 | Docs are a major version behind the SDK | medium | — |
| 8 | `getUsage()` returns an empty ledger despite real spend | medium | `bug08-empty-usage-ledger.ts` |
| 11 | `delegation.check` returns a false green | medium | `bug11-false-green-delegation.ts` |
| 13 | Map ACLs are write-only — stale ACLs are undiagnosable | medium | — |
| 5 | `contract_id` still unreadable after registration | confirmed, not fixed | — |
| 6 | An SDK throw dumps ~1.2 MB of obfuscated source to stderr | low (DX) | — |
| 7 | `getSelfEthAddress()` disagrees with the key's own address | low | `bug07-self-eth-address.ts` |
| 12 | `/api/invoke` is restricted to `z:` contracts | low, undocumented | `bug10-12-agent-invoke.ts` |
| 9 | Test-credit budget is smaller than it looks | planning note | — |

**#1 and #13 are the two worth fixing first.** #1 because it silently corrupts any
contract that follows `tips/placeholders-outbound-calls`, and the only written record of
the workaround is a code comment inside the reference contract. #13 because it makes the
most likely production failure impossible to diagnose.

Three sections below are **not** bug reports, and are marked as such: a wrong hypothesis
of ours corrected so nobody else chases it, a design note about what
`http-with-placeholders` does and does not cover, and the identity model as actually
implemented.

---

## 1. Host duplicates `Content-Type`, corrupting the header upstream — **severity: high**

A contract that sets its own `Content-Type` — exactly as
`tips/placeholders-outbound-calls` shows — causes the upstream server to receive a
doubled, malformed value.

**Repro** — `probes/bug01-content-type-quick.ts`. One contract, two calls differing only
in whether the contract sets the header:

| Contract sends | Upstream (`postman-echo.com/post`) receives | Upstream body parse |
|---|---|---|
| `headers: Some([("Content-Type","application/json")])` | `content-type: "application/json,application/json"` | **fails** — `data: {}` |
| `headers: None` | `content-type: "application/json"` | succeeds — `data: {"probe":"no-placeholders"}` |

The host appends its own `Content-Type` instead of respecting the contract's.
RFC 9110 makes `application/json,application/json` an invalid media type; lenient
servers ignore it, strict ones 415 or silently drop the body — as postman-echo does here.

**Why it matters:** the behaviour is known internally but undocumented, and the two
sources contradict each other. `z-tenant-flight` avoids it — `duffel_headers()` sets only
`Authorization`, `Duffel-Version` and `Accept`, and `booking.rs:182` (repeated at
`search.rs:193`) carries the comment *"Content-Type is set automatically by the host HTTP
function via `.json()` — sending it explicitly creates a duplicate that Duffel rejects."*

That comment is the only place this is written down. It is not in the API reference, not
in the WIT doc comments, and `tips/placeholders-outbound-calls` still shows the broken
pattern. A developer following the docs sets the header, gets HTTP 200 with an empty
parsed body, and has nothing to search for.

**Workaround:** pass `headers: None` for the Content-Type, or set only headers the
host doesn't inject (e.g. `Authorization`). Needs confirming which headers are injected.

**Fix:** the host should replace, not append, a header the contract already set.

---

## 2. `listContracts()` returns names that `getContractVersion()` rejects — **severity: medium**

Discovery output is not usable as dispatch input.

```
listContracts() reports:  tee:user @ 3.6.0
getContractVersion(url, "tee:user")            -> 404 Not Found
getContractVersion(url, "tee:user/contracts")  -> 3.6.0   ✓
```

Same for `tee:org-data` and `tee:agent-registry`. The `/contracts` suffix is required
but appears nowhere in the SDK reference — only incidentally in a walkthrough snippet.

**Worse:** three of the six advertised core contracts resolve in *neither* form —
`tee:vc`, `tee:organisation`, `tee:agent-connect` all 404. So `listContracts()` advertises
contracts that cannot be version-resolved at all, and therefore cannot be invoked
via the documented `getContractVersion` → `execute` path.

---

## 3. `tips/placeholders-outbound-calls` ships Rust that cannot compile — **severity: medium**

The page shows:

```rust
let resp = hwp::call(&hwp::Request {
    method:  "POST".to_string(),          // WIT type is `enum verb`, not string
    headers: vec![ ... ],                 // WIT type is `option<list<...>>`
```

Ground truth (`wit/deps/host-interfaces-2.1.0/package.wit`):

```wit
record request { method: verb, url: string,
                 headers: option<list<tuple<string,string>>>, payload: option<list<u8>> }
```

`walkthrough/write-contract` has it right (`method: hwp::Verb::Post`, `headers: Some(...)`).
The two pages contradict each other and the tips version is the wrong one.

---

## 4. Docs are a major version behind the SDK — **severity: medium**

`reference.md` documents SDK ~3.x. Installed latest is **5.2.0**. Undocumented but present
and working:

| Symbol | Docs say |
|---|---|
| `tenant.maps.entrySet(tail, key, value)` | docs teach raw `executeControl("map-entry-set", …)` |
| `tenant.contracts.listDetailed()` / `logs()` / `disable()` / `enable()` / `unregister()` | absent |
| `t3n.getAuditEvents()` | "reported to exist, not confirmed" — it exists |
| `t3n.getActivityLog()` / `exportActivityLog()` | absent |
| `t3n.updateAgentAuth()` / `getAgentAuth()` | docs teach raw `execute({function_name:"agent-auth-update"})` |
| `t3n.submitUserInput()` / `otpRequest()` / `otpVerify()` | absent — this is the only way to populate a profile |
| `t3n.getBalance()` | absent |
| `kv-store.scan()` / `set-claims-digest()` | absent from the Host API table |

Conversely, the community-reported symbols in `reference.md`
(`buildDelegationCredential`, `DelegationCustodialClient`) are **not** in 5.2.0.

---

## 5. `contract_id` still unreadable after registration — **confirmed, not fixed**

`register()` returns `{name, contract_id}`, but `DetailedContract` (from `listDetailed()`)
exposes only `{name, short_name, version, status, descriptor}` — no `contract_id`.
Re-registering a tail mints a new id (observed: `751` → `752` across two registrations of
`z:…:probe`), so map ACLs scoped to the old id go stale with no API to recover the new one.
The `register-contract` doc flags this; it is still true in 5.2.0.

---

## 6. An SDK throw dumps ~1.2 MB of obfuscated source to stderr — **severity: low (DX)**

`dist/index.esm.js` (1.19 MB; `dist/index.js` is another 1.20 MB) opens with the literal
banner `/* t3n-sdk-obfuscated */` — it is minified *and* identifier-obfuscated. Any uncaught
throw prints the whole bundle as the stack frame; it flooded a terminal and would flood CI
logs. Source maps or a non-obfuscated build would fix it.

---

## 7. `getSelfEthAddress()` disagrees with the key's own address — **severity: low**

```
eth_get_address(T3N_API_KEY)  -> 0x83e911a21262a2648f03282f23d896812addf72b   (signs in)
t3n.getSelfEthAddress()       -> 0x9a2cd86a6e7f8f4efbfc1bdaeb567a46fd30c4ee
```

The discrepancy is reproducible on the same authenticated session
(`probes/bug07-self-eth-address.ts`). What remains unconfirmed is the *cause* — whether the
second address is a distinct managed/custodial wallet or genuinely wrong. Either way the
method name promises the caller's own address and does not return it, and neither reading
is documented.

---

## Not a bug (recorded so the next person doesn't chase it)

- **Nested placeholders work.** The `placeholder-denied` WIT doc comment says markers fail on
  "nested / non-snake-case field", which reads as though `{{profile.verified_contacts.email.value}}`
  (used throughout the docs) would be rejected. It resolves correctly. The comment is misleading,
  not the implementation.
- **`submitUserInput` needs no OTP** for non-email fields — `{first_name, last_name,
  country_of_residence}` upserted fine and returned `{txHash, userFound:true}`.

## Design note (not a defect)

`http-with-placeholders` protects the **outbound** path only. The upstream response is returned
into WASM in full, so an upstream that echoes the request back hands the contract the very
plaintext the mechanism withheld — demonstrated here deliberately. Any contract handling real PII
needs to filter its own response before returning it, and the docs' privacy claim should say so.

---

## 8. `getUsage()` returns an empty ledger despite real spend — **severity: medium**

After 2 contract registrations, ~15 authenticated sessions, ~12 outbound HTTP calls, a
profile upsert and 2 grant writes, the balance had dropped **3,401.68 tokens** (20,000.00 →
16,598.32) and the balance row showed `version: 20` — i.e. 20 settled mutations.

`getUsage({limit:100})` returns:

```json
{"balance":{"available":16598321881,"reserved":0,"last_settled_seq_no":0,
            "version":20,"credit_exhausted":false,"storage_deposit":0},
 "entries":[]}
```

`entries` is empty and `last_settled_seq_no` is stuck at `0` while `version` is `20`.
There is no way to attribute spend to an operation, so you cannot cost-model an agent
before running it — which matters directly for anyone expected to keep one running.

## 9. Test-credit budget is smaller than it looks — **not a bug, a planning note**

3,401 of 20,000 credits (**17%**) went on a single afternoon's spike that registered a
contract exactly twice. Contract registration dominates. The published figure of
"~25 agents and ~5,000 protected actions" is only reachable if you almost never redeploy;
an iterative build burns the budget on registrations long before it runs out of actions.

---

## 10. Org-minted agents cannot make a single call — **severity: blocking (resolved manually)**

> **Update:** after requesting it over Telegram, Terminal 3 funded the agent DID by hand and
> the same call now returns `HTTP 200`. Re-run `probes/agent-funded-check.ts` to confirm.
> The finding stands: every developer hits this on their first agent, and clearing it
> currently requires a human at Terminal 3. There is still no self-serve path.

This blocks the platform's headline use case: an agent acting on a user's behalf.

`T3nClient.createAgent()` mints an agent whose DID and secp256k1 key are generated
**inside the TEE** — the key never leaves it, so the agent's only credential is the
returned opaque bearer (`t3n_key_<id>.<secret>`), and its only call path is
`POST /api/invoke`. It cannot open a `T3nClient` session, because it has no eth key to sign with.

That single path fails on its first call:

```
POST /api/invoke   X-T3N-Api-Key: t3n_key_b1c5…
→ HTTP 403
{"error":"InsufficientCredit (account=9e4a0ebc…3209, required=10000000000, available=0)",
 "code":"forbidden","request_id":"6e5d0598-1e07-4ccb-9b73-4f73bb741404"}
```

- `required = 10000000000` base units = **10,000 tokens** reserved for one call — half the
  entire 20,000-token free grant, for a single invocation.
- `available = 0`. A freshly minted agent has no balance.
- There is no self-serve way to fund it, and this is structural rather than an oversight.
  Verified against SDK 5.2.0: `TokenTxKind` includes `"transfer"`, so the ledger supports it,
  but the SDK exposes no transfer / fund / top-up method anywhere. `TenantTokenNamespace` has
  exactly one method, `getUsage()`. `token.transfer` appears only in doc comments, as a
  **cluster-admin** operation dispatched to `POST /api/admin` behind an `x-admin-signature`
  header — the same class as `tenant.admit`. A tenant cannot seed its own agent by any path.

So the documented flow — mint an agent, grant it access, let it act — **terminates at the
first call** for every developer, and can only be unblocked by Terminal 3 funding the DID
manually. The `common-errors` page mentions this in one row without stating that the
requirement is 10,000 tokens or that it affects every org-minted agent.

**Suggested fix:** have `createAgent` seed the agent from the creating tenant's balance, or
expose a tenant→agent transfer, or charge the owning org rather than the agent.

## 11. `delegation.check` returns a false green — **severity: medium**

Before Terminal 3 funded the agent, the call in #10 returned `403 InsufficientCredit`.
The platform's own authorization oracle reported success for that same call:

```json
{"authorised": true, "disclosed": true,
 "satisfied": [{"grant":"member_delegation","contract":"z:ae94…:probe",
                "functions":["probe-placeholders"],"scopes":[]}],
 "missing": []}
```

Re-run after funding, when the same call returns `HTTP 200`, `delegation.check` returns
**byte-identical output**. It reports the same thing whether the call is about to succeed or
about to fail on credit — which is the direct demonstration that it models grants but not
metering. The preflight designed to tell you whether a call will succeed cannot predict the
most common reason it won't. Either it should account for credit, or the docs should state
that `authorised:true` is necessary but not sufficient.

## 12. `/api/invoke` is restricted to `z:` contracts — **severity: low, undocumented**

```
POST /api/invoke  {contract_id:"tee:user/contracts", …}
→ HTTP 400 {"error":"invoke is restricted to z: (tenant) contracts","code":"bad_request",
            "request_id":"67a31b02-e17b-4758-b3c0-fb7d0135dc69"}
```

Since the bearer path is the *only* path an org-minted agent has (see #10), such an agent can
never reach a core contract — including `tee:user/contracts`, the one that carries
`agent-auth-update`. An agent therefore cannot inspect or manage its own grants. Undocumented.

## Identity model, as actually implemented

The docs imply you obtain three keys. The claim page issues **one**. The real model:

| Identity | How it is created | Auth | Credits |
|---|---|---|---|
| **Tenant** | claim page (SSO) → `0x…` eth key + DID | `T3nClient` session (SIWE) | funded (20,000) |
| **User** | any locally generated secp256k1 keypair; DID is minted on first `authenticate()` | `T3nClient` session | **0** |
| **Agent** | `createOrganisation()` → `createAgent()`; key minted in-TEE, never exported | bearer only (`X-T3N-Api-Key`) | **0** |

A fresh user DID also cannot receive a profile: `submitUserInput` fails with
`email_not_verified: caller has no verified email and supplied no proving authenticator.
Run otp-request + otp-verify first`. The claim-page tenant DID works only because SSO
already bound a verified email to it.

---

## 13. Map ACLs are write-only — stale ACLs are undiagnosable — **severity: medium**

`tenant.maps.create()` / `update()` take `readers` / `writers` as `{only: number[]}` of
contract ids. Nothing reads them back. `tenant.maps.getStatus(tail)` returns only a lifecycle
string:

```
maps.getStatus("secrets") -> "active"
```

Combined with #5 (`contract_id` is unreadable after re-registration), this means the most
likely production failure on this platform — a redeploy silently orphaning a map ACL — can be
neither predicted nor diagnosed through any API. You can only prevent it by re-applying ACLs
on every deploy, or detect it *functionally* by having the contract attempt a read and
watching it fail.

Both mitigations are implemented here: `scripts/deploy.ts` re-points every ACL on every run,
and `scripts/doctor.ts` calls `endpoint-list` as a live read probe instead of trusting metadata.

**Suggested fix:** return `readers`/`writers` from `getStatus`, and expose `contract_id` on
`listDetailed()`.

---

## Measured cost of a deployment

| Operation | Approx. tokens |
|---|---|
| Full first deploy (1 register + 3 map creates + 2 seeds + 2 grants) | ~3,250 |
| Redeploy with unchanged wasm (`deploy.ts` skips registration) | ~160 |
| End-to-end demo (6 contract invocations, 1 real outbound call) | ~1,000 |
| Whole build session (spike + gateway + demo + doctor + MCP) | ~6,800 of 20,000 |

Contract registration dominates. The wasm-hash skip in `deploy.ts` exists specifically because
of this: re-running deploy on unchanged code costs ~160 instead of ~1,850.
