import "dotenv/config";
import { readFile } from "fs/promises";
import {
  T3nClient, TenantClient, setEnvironment, loadWasmComponent, eth_get_address,
  metamask_sign, createEthAuthInput, fetchTrustedManifest, getNodeUrl, getContractVersion,
} from "@terminal3/t3n-sdk";
const clip = (s: unknown, n = 700) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
process.on("uncaughtException", e => { console.log("UNCAUGHT:", clip((e as any)?.message)); process.exit(1); });

setEnvironment("testnet");
const KEY = process.env.T3N_API_KEY!;
const address = eth_get_address(KEY);
const t3n = new T3nClient({
  trustAnchor: await fetchTrustedManifest("testnet"),
  wasmComponent: await loadWasmComponent(),
  handlers: { EthSign: metamask_sign(address, undefined, KEY) },
});
await t3n.handshake();
const tenantDid = (await t3n.authenticate(createEthAuthInput(address))).value;
const tid = tenantDid.slice("did:t3n:".length);
const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });
const SCRIPT = `z:${tid}:probe`, BIN = "https://postman-echo.com/post";

const wasm = await readFile("contract-probe/target/wasm32-wasip2/release/z_agentgate_probe.wasm");
console.log("register:", clip(JSON.stringify(await tenant.contracts.register({ tail: "probe", version: "0.1.1", wasm })), 200));
const v = await getContractVersion(getNodeUrl(), SCRIPT);
await t3n.updateAgentAuth(tenantDid, {
  scriptName: SCRIPT, versionReq: v,
  functions: ["probe-placeholders", "probe-egress"], allowedHosts: ["postman-echo.com"],
});
console.log("version:", v);

for (const send_content_type of [true, false]) {
  try {
    const r: any = await t3n.executeAndDecode({
      contract_id: SCRIPT, contract_version: v, function_name: "probe-egress",
      input: { url: BIN, send_content_type },
    });
    const body = JSON.parse(r.body);
    console.log(`\n--- contract sets Content-Type: ${send_content_type} ---`);
    console.log("  echoed content-type:", JSON.stringify(body.headers["content-type"]));
    console.log("  echoed parsed body  :", JSON.stringify(body.data));
  } catch (e: any) { console.log(`send_content_type=${send_content_type} ->`, clip(e?.message)); }
}

// With headers suppressed, can we finally SEE the resolved values?
const r: any = await t3n.executeAndDecode({
  contract_id: SCRIPT, contract_version: v, function_name: "probe-placeholders",
  input: { url: BIN, send_content_type: false, markers: ["first_name", "last_name", "verified_contacts.email.value"] },
});
console.log("\n=== resolved values (headers suppressed) ===");
for (const x of r.results ?? []) {
  let shown = x.verdict;
  const m = /\{.*\}/s.exec(String(x.verdict));
  if (m) { try { const b = JSON.parse(m[0]); shown = JSON.stringify(b.data ?? b.json ?? b); } catch {} }
  console.log(`${x.ok ? "OK  " : "FAIL"} ${String(x.marker).padEnd(30)} ${clip(shown, 200)}`);
}
