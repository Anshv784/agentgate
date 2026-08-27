import "dotenv/config";
import { setEnvironment, getNodeUrl, discoverCheckDelegation, discoverListContracts } from "@terminal3/t3n-sdk";
const clip = (s: unknown, n = 500) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
process.on("uncaughtException", e => { console.log("UNCAUGHT:", clip((e as any)?.message)); process.exit(1); });
setEnvironment("testnet");
const baseUrl = getNodeUrl(), apiKey = process.env.AGENT_KEY!;
const SCRIPT = `z:${process.env.T3N_TENANT_DID!.slice("did:t3n:".length)}:probe`;

try {
  const r = await discoverCheckDelegation({ baseUrl, apiKey }, {
    contract: SCRIPT, pii_did: process.env.T3N_TENANT_DID!,
    functions: ["probe-placeholders"], scopes: [],
  });
  console.log("delegation.check:", JSON.stringify(r, null, 1));
} catch (e: any) { console.log("delegation.check FAILED:", clip(e?.message)); }

for (const p of [{}, { scope: "org", org_did: process.env.ORG_DID! }, { scope: "self" }] as any[]) {
  try { console.log(`\ncontracts.list ${JSON.stringify(p)} ->`,
    clip(JSON.stringify((await discoverListContracts({ baseUrl, apiKey }, p)).contracts?.map((c:any)=>c.name)), 400)); }
  catch (e: any) { console.log(`contracts.list ${JSON.stringify(p)} FAILED:`, clip(e?.message, 200)); }
}
