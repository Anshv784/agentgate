# Handover

Written so someone who has never seen this repo can operate it.

## Orientation — what runs where

There are only three moving parts, and you own two of them.

| Part | Where it runs | Who owns it |
|---|---|---|
| The **contract** — all policy, credentials, and the audit ledger | inside a TEE on Terminal 3's nodes | you deploy it; Terminal 3 hosts it |
| The **MCP server** — relays agent calls, holds the T3N session | wherever you start it | you |
| `agentgate.config.json` — every endpoint and grant | your repo | you |

There is no database, no hosted service, and no shared state with anyone else. Deploying
is pushing a WASM binary and some ACLs. If you delete everything and re-run
`npm run deploy`, you get it all back.

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) if you want to know *why* it is shaped this
way. This document is only concerned with keeping it running.

## What must exist

| Thing | Where from | Notes |
|---|---|---|
| `T3N_API_KEY` | [terminal3.io/claim-page](https://www.terminal3.io/claim-page) | eth private key. **Shown once.** Funds all metered calls |
| `RESEND_API_KEY` | resend.com | or replace with whatever endpoint you register |
| Node ≥ 18, Rust + `wasm32-wasip2` | `rustup target add wasm32-wasip2` | only needed to rebuild the contract |

Everything lives in `.env` (gitignored). `.env.example` lists every variable.

## Routine operations

```bash
npm run doctor    # ALWAYS run this first. Non-zero exit = do not proceed
npm run deploy    # idempotent; skips registration when the wasm is unchanged
npm run demo      # end-to-end proof, including denial paths
npm run test      # 9 native policy tests — no network, no credits
```

`deploy` is safe to re-run. It is the repair tool as much as the install tool: it
re-points every map ACL at the current `contract_id` on every run, which is the fix for
the platform's most likely silent failure.

## Changing things

**Add or change an endpoint** — edit `agentgate.config.json`, `npm run deploy`. No Rust,
no contract redeploy, ~800 credits.

**Rotate a credential** — change it in `.env`, `npm run deploy`. Re-seeds the sealed map.

**Change policy logic** — edit `contract/src/policy.rs`, `npm run test`, `npm run build`,
`npm run deploy`. Deploy auto-bumps the patch version, records the new `contract_id`, and
re-points ACLs. Costs ~1,850 credits.

**Revoke an agent** — remove it from `grants` in the config and re-run deploy, or call
`t3n.updateAgentAuth(agentDid, {…, functions: []})`. Takes effect on the next call; no
redeploy, no restart.

## Failure playbook

| Symptom | Cause | Fix |
|---|---|---|
| `InsufficientCredit` | out of tokens, or the *calling* DID has none of its own | top up; note a minted agent DID starts at 0 and needs 10,000 for one call — see `docs/BUGS.md#10` |
| `host/http.egress_denied: host '<x>' not in the authorised_hosts allowlist` | the data owner's grant doesn't list that host | add it to `grantDefaults.allowedHosts`, redeploy |
| `outcome: "denied"` | working as designed — policy refused | read `reason`; widen `allowed_paths` / `allowed_placeholders` if genuinely intended |
| `placeholder-unknown(x)` | the subject's profile has no field `x` | populate via `t3n.submitUserInput()`; a fresh DID needs email OTP first |
| contract can't read its secrets | map ACL points at a superseded `contract_id` | `npm run deploy` |
| upstream 200 but empty body | the host's doubled `Content-Type` — `docs/BUGS.md#1` | don't set `Content-Type` in `extra_headers` |
| HTTP 500, no detail | often egress or ACL surfacing as 500 | capture `request_id`, retry once, then report it |

`npm run doctor` checks for most of these before they bite.

Every error string in this table was observed, not guessed — the egress one was
re-confirmed against the live node on 2026-08-28 by calling a host outside the allowlist.

## Cost model

| Operation | Approx. tokens |
|---|---|
| Redeploy, unchanged wasm | **~800** (measured 2026-08-28) |
| One governed agent call | **0 to the tenant** — billed to the agent DID |
| First deploy | ~3,250 (build estimate, not re-measured) |
| Redeploy, changed wasm | ~1,850 (build estimate, not re-measured) |

Budget is 20,000 free tokens. Registration dominates; the wasm-hash skip in `deploy.ts`
exists for exactly that reason.

Two things to know before you trust any of these. Agent calls bill the **agent's** balance,
not yours — a full `npm run demo` costs your tenant nothing, which is the same accounting
that makes `docs/BUGS.md#10` blocking. And settlement lags: `getUsage()` returns an empty
ledger (`#8`), so a balance read taken straight after an operation can attribute the charge
to the wrong one. Measure from a quiet baseline and confirm with a second read.

## If you take this over

1. Claim your own `T3N_API_KEY` — you become the tenant and own a fresh `z:<your-tid>:`
   namespace. Nothing is shared with ours.
2. `npm run deploy` — creates your contract, maps, and grants from scratch.
3. `npm run doctor` — should report no failures.
4. `deployments.json` is ours; delete it and yours will be written on first deploy.

Nothing in this repo depends on our tenant, our org, or our keys. There is no shared
state and no hosted service to transfer — the contract runs on Terminal 3's nodes, and
the MCP server runs wherever you run it.

## Intent

We would like to keep running AgentGate, and we are applying to Terminal 3's startup
program and listing page. This runbook exists regardless — a project one person can run
is not a project.

## Known open items

- Org-minted agents can't pay for their first call (`docs/BUGS.md#10`). Blocked on
  Terminal 3; grant is pre-applied for when it's resolved.
- The audit ledger records `profile.x` for denials and `x` for successes — cosmetic
  inconsistency in `gateway.rs`, batched for the next contract change rather than
  burning a registration on it.
- `audit-list` scans lexicographically from the start, so `limit` returns the **oldest**
  entries, not the newest. `scripts/demo.ts` slices client-side. A contract-side reverse
  scan is the proper fix; batched with the item above.
- `contract-probe/` is a diagnostic that deliberately echoes resolved PII to a public
  echo service to map the placeholder surface. Kept as evidence for the bug report.
  **Do not run it against a profile with real data.**
