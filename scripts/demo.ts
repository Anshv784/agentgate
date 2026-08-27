/**
 * End-to-end, as the real three-identity flow.
 *
 *   TENANT  owns the contract, seals the credential, enumerates the policy.
 *   OWNER   (data owner) grants the agent access, and owns the profile the
 *           {{profile.*}} markers resolve against.
 *   AGENT   org-minted, holds only an opaque bearer token whose signing key
 *           never left the TEE. It sends the calls below.
 *
 * The agent has no credential, no URL, no PII, and no ability to reach a core
 * contract to inspect its own grants. It still gets the job done.
 */
import { readFile } from "fs/promises";
import { getContractVersion, invoke, setEnvironment, getNodeUrl } from "@terminal3/t3n-sdk";
import { clip } from "./t3n.js";

setEnvironment((process.env.T3N_ENV as "testnet" | "production") ?? "testnet");
const baseUrl = getNodeUrl();
const cfg = JSON.parse(await readFile("agentgate.config.json", "utf8"));
const apiKey = process.env.AGENT_KEY!;
const ownerDid = process.env.T3N_TENANT_DID!;          // data owner in this deployment
const script = `z:${ownerDid.slice("did:t3n:".length)}:${cfg.contract.tail}`;
const contract_version = await getContractVersion(baseUrl, script);

const call = async (function_name: string, input: unknown) => {
  try {
    return await invoke({ baseUrl, apiKey, request: { contract_id: script, contract_version, function_name, pii_did: ownerDid, input } });
  } catch (e: any) { return { outcome: "ERROR", reason: clip(e?.message, 200) }; }
};
const show = (label: string, r: any) => {
  const tag = r?.outcome === "ok" ? "✅ ALLOWED" : r?.outcome === "denied" ? "🛑 DENIED " : "⚠️  " + r?.outcome;
  console.log(`\n${tag}  ${label}\n   ${clip(JSON.stringify(r), 260)}`);
};

console.log(`contract  ${script} @ ${contract_version}`);
console.log(`agent     ${process.env.AGENT_DID}   (bearer only — signing key never left the TEE)`);
console.log(`acting for ${ownerDid}  (data owner; markers resolve against THEIR profile)\n`);

console.log("── what may this agent reach? ".padEnd(72, "─"));
console.log(clip(JSON.stringify(await call("endpoint-list", {})), 400));

const email = (extra: Record<string, unknown> = {}) => ({
  from: "onboarding@resend.dev",
  to: ["{{profile.verified_contacts.email.value}}"],
  subject: "Your account is provisioned",
  html: "<p>Hi {{profile.first_name}} {{profile.last_name}}, your access is ready.</p>",
  ...extra,
});

console.log("\n── policy enforcement ".padEnd(72, "─"));
show("profile field outside the endpoint's allowlist  ({{profile.ssn}})",
  await call("invoke-endpoint", { endpoint: "resend", path: "/emails", body: email({ html: "<p>SSN: {{profile.ssn}}</p>" }) }));
show("marker reaching for another namespace  ({{secret.resend_api_key}})",
  await call("invoke-endpoint", { endpoint: "resend", path: "/emails", body: email({ html: "<p>{{secret.resend_api_key}}</p>" }) }));
show("path the tenant never enumerated  (/domains)",
  await call("invoke-endpoint", { endpoint: "resend", path: "/domains", body: {} }));
show("endpoint that does not exist  (stripe)",
  await call("invoke-endpoint", { endpoint: "stripe", path: "/emails", body: email() }));

console.log("\n── the real thing ".padEnd(72, "─"));
show("agent emails a person whose address it cannot see",
  await call("invoke-endpoint", { endpoint: "resend", path: "/emails", body: email() }));

console.log("\n── ledger (written in-enclave; the agent cannot edit it) ".padEnd(72, "─"));
const audit: any = await call("audit-list", { limit: 30 });
for (const e of audit?.entries ?? [])
  console.log(`  ${e.outcome.padEnd(8)} ${String(e.status).padStart(3)}  ${e.endpoint}${e.path.padEnd(9)} markers=${JSON.stringify(e.markers)}  ${clip(e.detail, 60)}`);
