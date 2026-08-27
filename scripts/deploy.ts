/**
 * Idempotent deploy.
 *
 * The problem this exists to solve: re-registering a contract tail mints a NEW
 * numeric contract_id, and there is no API to read a tail's current id back
 * (confirmed against SDK 5.2.0 — see docs/BUGS.md #5). Map ACLs are scoped to
 * that id, so every redeploy silently orphans them and the contract loses
 * access to its own secrets.
 *
 * So: this script keeps the id ledger itself (deployments.json, committed), and
 * re-applies map ACLs against the current id on every run. It also skips
 * registration entirely when the wasm hash is unchanged, because registration
 * is the single most expensive metered operation on the platform.
 */
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { createHash } from "crypto";
import { getContractVersion } from "@terminal3/t3n-sdk";
import { session, expand, clip } from "./t3n.js";

const LEDGER = "deployments.json";
const cfg = expand(JSON.parse(await readFile("agentgate.config.json", "utf8")));
const { t3n, tenant, did, tid, baseUrl } = await session(process.env.T3N_API_KEY!);

const wasm = await readFile(cfg.contract.wasm);
const hash = createHash("sha256").update(wasm).digest("hex");
const script = `z:${tid}:${cfg.contract.tail}`;
const ledger = existsSync(LEDGER) ? JSON.parse(await readFile(LEDGER, "utf8")) : {};
const record = (ledger[script] ??= { tail: cfg.contract.tail, history: [] });
const last = record.history.at(-1);

console.log(`tenant ${did}`);
console.log(`script ${script}  wasm ${hash.slice(0, 12)} (${(wasm.length / 1024).toFixed(0)} KiB)`);

// ── 1. register, but only if the artifact actually changed ──────────────────
const bump = (v: string) => { const p = v.split(".").map(Number); p[2]++; return p.join("."); };
let contractId: number | undefined = last?.contract_id;

if (last?.wasm_sha256 === hash && !process.argv.includes("--force")) {
  console.log(`register  SKIP (wasm unchanged, id ${contractId}, v${last.version}) — saves ~1700 credits`);
} else {
  const version = last && last.version >= cfg.contract.version ? bump(last.version) : cfg.contract.version;
  const res = await tenant.contracts.register({ tail: cfg.contract.tail, version, wasm });
  contractId = res.contract_id;
  record.history.push({ version, contract_id: contractId, wasm_sha256: hash, at: new Date().toISOString() });
  console.log(`register  OK   v${version} -> contract_id ${contractId}`);
}
if (contractId === undefined) throw new Error("no contract_id — nothing to grant ACLs to");

// ── 2. maps: create if absent, then ALWAYS re-point ACLs at the current id ──
for (const tail of cfg.maps) {
  try {
    await tenant.maps.create({ tail, visibility: "private", writers: { only: [contractId] }, readers: { only: [contractId] } });
    console.log(`map       CREATE ${tail} -> readers/writers [${contractId}]`);
  } catch (e: any) {
    if (!/already exists/i.test(e?.message ?? "")) throw e;
    // This is the redeploy-safety line. Without it a re-registered contract
    // silently loses access to maps it created under its previous id.
    await tenant.maps.update(tail, { writers: { only: [contractId] }, readers: { only: [contractId] } });
    console.log(`map       REPOINT ${tail} -> readers/writers [${contractId}]`);
  }
}

// ── 3. seed secrets + endpoint policy (control-plane writes bypass the ACL) ──
for (const [k, v] of Object.entries(cfg.secrets as Record<string, string>)) {
  if (!v) { console.log(`secret    SKIP ${k} (not set in env)`); continue; }
  await tenant.maps.entrySet("secrets", k, v);
  console.log(`secret    SET  ${k} = ${v.slice(0, 6)}… (sealed; only the contract can read it)`);
}
for (const [name, ep] of Object.entries(cfg.endpoints as Record<string, unknown>)) {
  await tenant.maps.entrySet("endpoints", name, JSON.stringify(ep));
  console.log(`endpoint  SET  ${name} -> ${(ep as any).base} paths=${JSON.stringify((ep as any).allowed_paths)}`);
}

// ── 4. grants, signed by the data owner ────────────────────────────────────
const version = await getContractVersion(baseUrl, script);
for (const g of cfg.grants as Array<{ grantee: string; note?: string }>) {
  if (!g.grantee) { console.log(`grant     SKIP (grantee unset)`); continue; }
  try {
    await t3n.updateAgentAuth(g.grantee, {
      scriptName: script, versionReq: version,
      functions: cfg.grantDefaults.functions, allowedHosts: cfg.grantDefaults.allowedHosts,
    });
    console.log(`grant     OK   ${g.grantee.slice(0, 20)}… fns=${cfg.grantDefaults.functions.length} hosts=${cfg.grantDefaults.allowedHosts}`);
  } catch (e: any) { console.log(`grant     FAIL ${g.grantee.slice(0, 20)}… ${clip(e?.message, 120)}`); }
}

record.version = version;
await writeFile(LEDGER, JSON.stringify(ledger, null, 2) + "\n");
console.log(`\ndeployed ${script} @ ${version} (contract_id ${contractId}); ledger -> ${LEDGER}`);
