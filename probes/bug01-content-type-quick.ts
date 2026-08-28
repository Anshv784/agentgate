/**
 * #1 — host appends Content-Type instead of replacing the contract's.
 *
 * Same finding as bug01-content-type-doubling.ts, but reuses the ALREADY-REGISTERED
 * probe contract instead of building and registering one (~1,700 credits). Use this to
 * verify the bug cheaply; use the other script if you need to reproduce from source.
 *
 * probe-egress posts a fixed body ({"probe":"no-placeholders"}) and resolves no profile
 * markers, so nothing personal leaves the enclave.
 */
import "dotenv/config";
import { setEnvironment, getNodeUrl } from "@terminal3/t3n-sdk";

setEnvironment("testnet");
const baseUrl = getNodeUrl();
const apiKey = process.env.AGENT_KEY!;
const TID = process.env.T3N_TENANT_DID!.slice("did:t3n:".length);

for (const send_content_type of [true, false]) {
  const r = await fetch(`${baseUrl}/api/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-T3N-Api-Key": apiKey },
    body: JSON.stringify({
      contract_id: `z:${TID}:probe`,
      contract_version: "0.1.1",
      function_name: "probe-egress",
      pii_did: process.env.T3N_TENANT_DID!,
      input: { url: "https://postman-echo.com/post", send_content_type },
    }),
  });

  let received = "<unparsed>", parsed = "<unparsed>";
  try {
    const echo = JSON.parse(JSON.parse(await r.text()).body ?? "{}");
    received = JSON.stringify(echo?.headers?.["content-type"]);
    parsed = JSON.stringify(echo?.data);
  } catch { /* leave the placeholders */ }

  console.log(`contract sends Content-Type: ${String(send_content_type).padEnd(5)}`);
  console.log(`  upstream received : ${received}`);
  console.log(`  upstream parsed   : ${parsed}\n`);
}
