/** Re-runs BUGS.md #10 to see whether the agent DID can now pay for a call. */
import "dotenv/config";
import { setEnvironment, getNodeUrl, discoverWhoami } from "@terminal3/t3n-sdk";
setEnvironment("testnet");
const baseUrl = getNodeUrl(), apiKey = process.env.AGENT_KEY!;
console.log("agent whoami:", JSON.stringify(await discoverWhoami({ baseUrl, apiKey })));

const TID = process.env.T3N_TENANT_DID!.slice("did:t3n:".length);
const res = await fetch(`${baseUrl}/api/invoke`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-T3N-Api-Key": apiKey },
  body: JSON.stringify({
    contract_id: `z:${TID}:agentgate`, contract_version: "0.1.0",
    function_name: "endpoint-list", pii_did: process.env.T3N_TENANT_DID!, input: {},
  }),
});
console.log(`\nagent -> agentgate: HTTP ${res.status}`);
console.log((await res.text()).slice(0, 400));
