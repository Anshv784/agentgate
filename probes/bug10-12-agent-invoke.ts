import "dotenv/config";
import { setEnvironment, getNodeUrl } from "@terminal3/t3n-sdk";
setEnvironment("testnet");
const baseUrl = getNodeUrl(), apiKey = process.env.AGENT_KEY!;
const TID = process.env.T3N_TENANT_DID!.slice("did:t3n:".length);

const cases = [
  { label: "tenant z: contract", contract_id: `z:${TID}:probe`, contract_version: "0.1.1",
    function_name: "probe-egress", pii_did: process.env.T3N_TENANT_DID!,
    input: { url: "https://postman-echo.com/post", send_content_type: false } },
  { label: "core tee:user",      contract_id: "tee:user/contracts", contract_version: "3.6.0",
    function_name: "user-get", input: {} },
];

for (const c of cases) {
  const { label, ...request } = c as any;
  const res = await fetch(`${baseUrl}/api/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-T3N-Api-Key": apiKey },
    body: JSON.stringify(request),
  });
  const body = await res.text();
  console.log(`\n### ${label}\n  HTTP ${res.status}\n  request-id: ${res.headers.get("x-request-id") ?? "-"}\n  body: ${body.slice(0, 500)}`);
}
