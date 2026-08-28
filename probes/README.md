# Reproductions

One runnable script per finding in [`../docs/BUGS.md`](../docs/BUGS.md). These are
**not** tests — nothing here asserts. Each one makes a real call and prints what the
platform actually returned, so a Terminal 3 engineer can see the bug rather than take
our word for it.

```bash
npx tsx probes/<script>.ts
```

All of them read credentials from `.env`.

## Bug reproductions

| Script | Reproduces | What you should see |
|---|---|---|
| `bug01-content-type-doubling.ts` | **#1** host appends `Content-Type` instead of replacing it | `application/json,application/json` and an unparsed upstream body — then the correct header when the contract sends none |
| `bug02-contract-naming.ts` | **#2** `listContracts()` names 404 in `getContractVersion()` | `tee:user` fails, `tee:user/contracts` resolves; `tee:vc` / `tee:organisation` / `tee:agent-connect` fail both ways |
| `bug08-empty-usage-ledger.ts` | **#8** metering ledger empty despite real spend | `entries: []`, `last_settled_seq_no: 0`, non-zero `version` |
| `bug10-12-agent-invoke.ts` | **#10** minted agent can't pay; **#12** `/api/invoke` is `z:`-only | `InsufficientCredit … required=10000000000, available=0`, then `invoke is restricted to z: (tenant) contracts` |
| `bug11-false-green-delegation.ts` | **#11** `delegation.check` says authorised for a call that 403s | `authorised: true, missing: []` |

`bug01` needs `contract-probe/` built and registered first. The rest need only a funded
`T3N_API_KEY`.

## Utilities

Not bug reports — small tools used while building, kept because they answer questions
the docs don't.

| Script | What it does |
|---|---|
| `identity-model.ts` | shows how tenant / user / agent identities are really created — mints an org + agent and prints the one-time agent key |
| `agent-funded-check.ts` | whether the agent DID can pay yet (**#10**) — `HTTP 200` once funded, `InsufficientCredit` before |
| `profile-upsert.ts` | demonstrates that `submitUserInput` needs no OTP for non-email fields |
| `set-profile.ts` | writes the profile fields that `{{profile.*}}` markers resolve against |
| `balance.ts` | remaining token balance |

> `identity-model.ts` mints a **new** org and agent every run and costs credits. It is
> not idempotent — run it once.
