/**
 * `npm run doctor` — pre-flight for a deployment you did not just create.
 *
 * Catches the failure modes this platform makes easy and silent:
 *   • the built wasm has drifted from what is actually deployed
 *   • map ACLs still point at a contract_id from a previous registration
 *   • a secret or endpoint policy was never seeded
 *   • a grantee has no grant, or a grant names hosts the endpoints do not use
 *   • the balance will not cover the next registration
 */
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { createHash } from "crypto";
import { getContractVersion, BASE_UNITS_PER_TOKEN } from "@terminal3/t3n-sdk";
import { session, expand, clip } from "./t3n.js";

const cfg = expand(JSON.parse(await readFile("agentgate.config.json", "utf8")));
const { t3n, tenant, did, tid, baseUrl } = await session(process.env.T3N_API_KEY!);
const script = `z:${tid}:${cfg.contract.tail}`;

let bad = 0, warn = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const no = (m: string) => { bad++; console.log(`  FAIL  ${m}`); };
const wr = (m: string) => { warn++; console.log(`  warn  ${m}`); };

console.log(`AgentGate doctor — ${script}\n`);

// ── identity & funding ──────────────────────────────────────────────────────
console.log("identity");
const me: any = await tenant.tenant.me();
me?.status === "active" ? ok(`tenant ${did} (${me.label})`) : no(`tenant status ${me?.status}`);
const bal: any = await t3n.getBalance();
const tokens = bal.available / Number(BASE_UNITS_PER_TOKEN);
console.log(`  ---   balance ${tokens.toFixed(0)} tokens`);
if (tokens < 2000) wr(`balance low — a contract registration costs ~1700`);
if (bal.credit_exhausted) no("credit exhausted");

// ── deployed artifact vs built artifact ─────────────────────────────────────
console.log("\nartifact");
const ledger = existsSync("deployments.json") ? JSON.parse(await readFile("deployments.json", "utf8")) : {};
const rec = ledger[script];
if (!rec?.history?.length) { no("no deployments.json entry — run `npm run deploy`"); }
const last = rec?.history?.at(-1);
let liveVersion = "";
try { liveVersion = await getContractVersion(baseUrl, script); ok(`registered on-chain @ ${liveVersion}`); }
catch (e: any) { no(`contract not resolvable: ${clip(e?.message, 90)}`); }
if (last && liveVersion && last.version !== liveVersion)
  wr(`ledger says v${last.version}, network says v${liveVersion} — someone deployed outside this repo`);

if (existsSync(cfg.contract.wasm)) {
  const hash = createHash("sha256").update(await readFile(cfg.contract.wasm)).digest("hex");
  hash === last?.wasm_sha256
    ? ok(`built wasm matches deployed (${hash.slice(0, 12)})`)
    : wr(`built wasm ${hash.slice(0, 12)} != deployed ${String(last?.wasm_sha256).slice(0, 12)} — redeploy pending`);
} else wr(`${cfg.contract.wasm} not built`);

// ── the stale-ACL trap ──────────────────────────────────────────────────────
// There is no API to READ a map's readers/writers back — `maps.getStatus()`
// returns only a lifecycle string (docs/BUGS.md #13). So a stale ACL cannot be
// detected by introspection; it can only be prevented (deploy re-points every
// run) or caught functionally. We do the latter: ask the contract to read one
// of its own maps. If the ACL were stale this returns an access error.
console.log("\nmaps (functional — ACLs are not readable)");
const currentId: number | undefined = last?.contract_id;
const priorIds = (rec?.history ?? []).slice(0, -1).map((h: any) => h.contract_id);
if (priorIds.length)
  console.log(`  ---   tail registered ${priorIds.length + 1}x; superseded ids: ${priorIds.join(", ")}`);
for (const tail of cfg.maps) {
  try {
    const st: any = await tenant.maps.getStatus(tail);
    ok(`${tail} exists (${clip(JSON.stringify(st), 40)})`);
  } catch (e: any) { no(`${tail}: ${clip(e?.message, 90)}`); }
}
try {
  const probe: any = await t3n.executeAndDecode({
    contract_id: script, contract_version: liveVersion,
    function_name: "endpoint-list", input: {},
  });
  (probe?.endpoints?.length ?? 0) > 0
    ? ok(`contract can read its own maps under contract_id ${currentId} (${probe.endpoints.length} endpoint(s))`)
    : no(`contract read its endpoints map but got nothing back — seeded state missing, or ACL points at a superseded id`);
} catch (e: any) {
  no(`contract CANNOT read its own maps — ACLs likely stale after a re-registration. Run \`npm run deploy\` to re-point them. [${clip(e?.message, 90)}]`);
}

// ── seeded state ────────────────────────────────────────────────────────────
console.log("\nseeded state");
for (const k of Object.keys(cfg.secrets)) {
  const v = await tenant.maps.entryGet("secrets", k).catch(() => null);
  v ? ok(`secret ${k} present (${String(v).length} bytes)`) : no(`secret ${k} MISSING — contract calls will fail`);
}
for (const [name, ep] of Object.entries<any>(cfg.endpoints)) {
  const v = await tenant.maps.entryGet("endpoints", name).catch(() => null);
  if (!v) { no(`endpoint ${name} MISSING`); continue; }
  const live = JSON.parse(String(v));
  JSON.stringify(live) === JSON.stringify(ep)
    ? ok(`endpoint ${name} matches config`)
    : wr(`endpoint ${name} differs from agentgate.config.json — redeploy to sync`);
}

// ── grants ──────────────────────────────────────────────────────────────────
console.log("\ngrants");
const pol: any = await t3n.getAgentAuth();
const hosts = new Set(Object.values<any>(cfg.endpoints).map(e => new URL(e.base).host));
for (const g of cfg.grants as any[]) {
  if (!g.grantee) { wr(`grantee unset (${g.note ?? ""})`); continue; }
  const entry = (pol.agents ?? []).find((a: any) => a.agentDid === g.grantee);
  const s = entry?.scripts?.find((x: any) => x.scriptName === script);
  if (!s) { no(`no grant for ${g.grantee.slice(0, 22)}…`); continue; }
  ok(`${g.grantee.slice(0, 22)}… fns=${JSON.stringify(s.functions)} hosts=${JSON.stringify(s.allowedHosts)}`);
  for (const h of hosts) if (!s.allowedHosts?.includes(h)) no(`  grant is missing host ${h} — egress will be denied`);
  if (s.versionReq && liveVersion && s.versionReq !== liveVersion)
    wr(`  grant pins v${s.versionReq} but live is v${liveVersion} — redeploy to re-grant`);
}

console.log(`\n${bad ? `${bad} failure(s)` : "no failures"}, ${warn} warning(s)`);
process.exit(bad ? 1 : 0);
