/**
 * End-to-end: an agent sends a real email to a person whose address it never sees.
 *
 * Caller is the tenant DID standing in as data owner, because org-minted agents
 * cannot pay for a call yet (docs/BUGS.md #10). Swap AGENT_KEY in once funded —
 * the grant is already in place, so nothing else changes.
 */
import { readFile } from "fs/promises";
import { getContractVersion } from "@terminal3/t3n-sdk";
import { session, clip } from "./t3n.js";

const cfg = JSON.parse(await readFile("agentgate.config.json", "utf8"));
const { t3n, did, tid, baseUrl } = await session(process.env.T3N_API_KEY!);
const script = `z:${tid}:${cfg.contract.tail}`;
const version = await getContractVersion(baseUrl, script);

const call = async (fn: string, input: unknown) => {
  try { return await t3n.executeAndDecode({ contract_id: script, contract_version: version, function_name: fn, input }); }
  catch (e: any) { return { outcome: "ERROR", reason: clip(e?.message, 200) }; }
};
const show = (label: string, r: any) => {
  const tag = r?.outcome === "ok" ? "✅ ALLOWED" : r?.outcome === "denied" ? "🛑 DENIED " : "⚠️  " + r?.outcome;
  console.log(`\n${tag}  ${label}`);
  console.log(`   ${clip(JSON.stringify(r), 260)}`);
};

console.log(`contract ${script} @ ${version}\ncaller   ${did}\n`);
console.log("── what can this agent reach? ".padEnd(70, "─"));
console.log(clip(JSON.stringify(await call("endpoint-list", {})), 400));

const email = (extra: Record<string, unknown> = {}) => ({
  from: "onboarding@resend.dev",
  to: ["{{profile.verified_contacts.email.value}}"],
  subject: "Your account is provisioned",
  html: "<p>Hi {{profile.first_name}} {{profile.last_name}}, your access is ready.</p>",
  ...extra,
});

console.log("\n── policy enforcement ".padEnd(70, "─"));

show("marker outside the endpoint's allowlist  ({{profile.ssn}})",
  await call("invoke-endpoint", { endpoint: "resend", path: "/emails",
    body: email({ html: "<p>SSN: {{profile.ssn}}</p>" }) }));

show("marker in a non-profile namespace  ({{secret.resend_api_key}})",
  await call("invoke-endpoint", { endpoint: "resend", path: "/emails",
    body: email({ html: "<p>{{secret.resend_api_key}}</p>" }) }));

show("path the tenant never enumerated  (/domains)",
  await call("invoke-endpoint", { endpoint: "resend", path: "/domains", body: {} }));

show("endpoint that does not exist  (stripe)",
  await call("invoke-endpoint", { endpoint: "stripe", path: "/emails", body: email() }));

console.log("\n── the real thing ".padEnd(70, "─"));
show("send to an address the agent never sees", await call("invoke-endpoint",
  { endpoint: "resend", path: "/emails", body: email() }));

console.log("\n── tamper-evident ledger ".padEnd(70, "─"));
const audit: any = await call("audit-list", { limit: 20 });
for (const e of audit?.entries ?? [])
  console.log(`  ${e.outcome.padEnd(8)} ${String(e.status).padStart(3)}  ${e.endpoint}${e.path}  markers=${JSON.stringify(e.markers)}  ${clip(e.detail, 70)}`);
