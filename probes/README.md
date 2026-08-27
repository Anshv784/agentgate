# Reproductions

One runnable script per finding in [`../docs/BUGS.md`](../docs/BUGS.md). Each is
self-contained and reads credentials from `.env`.

```bash
npx tsx probes/<script>.ts
```

| Script | Reproduces | Expected output |
|---|---|---|
| `bug01-content-type-doubling.ts` | **#1** host appends `Content-Type` instead of replacing it | `application/json,application/json` with an unparsed upstream body; correct header when the contract sends none |
| `bug02-contract-naming.ts` | **#2** `listContracts()` names 404 in `getContractVersion()` | `tee:user` fails, `tee:user/contracts` resolves; `tee:vc` / `tee:organisation` / `tee:agent-connect` fail both ways |
| `bug08-empty-usage-ledger.ts` | **#8** metering ledger empty despite real spend | `entries: []`, `last_settled_seq_no: 0`, non-zero `version` |
| `bug10-12-agent-invoke.ts` | **#10** minted agent can't pay; **#12** `/api/invoke` is `z:`-only | `InsufficientCredit … required=10000000000, available=0`; `invoke is restricted to z: (tenant) contracts` |
| `bug11-false-green-delegation.ts` | **#11** `delegation.check` says authorised for a call that 403s | `authorised: true, missing: []` |
| `identity-model.ts` | how tenant / user / agent identities are really created | mints an org + agent, prints the one-time agent key |
| `profile-upsert.ts` | `submitUserInput` needs no OTP for non-email fields | `{txHash, userFound: true}` |

`bug01` requires `contract-probe/` to be built and registered. The rest need only a
funded `T3N_API_KEY`.

> `identity-model.ts` mints a **new** org and agent every run and costs credits. It is
> not idempotent — run it once.
