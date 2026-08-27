import "dotenv/config";
import { T3nClient, setEnvironment, loadWasmComponent, eth_get_address,
  metamask_sign, createEthAuthInput, fetchTrustedManifest, BASE_UNITS_PER_TOKEN } from "@terminal3/t3n-sdk";
setEnvironment("testnet");
const KEY = process.env.T3N_API_KEY!, address = eth_get_address(KEY);
const t3n = new T3nClient({ trustAnchor: await fetchTrustedManifest("testnet"),
  wasmComponent: await loadWasmComponent(), handlers: { EthSign: metamask_sign(address, undefined, KEY) } });
await t3n.handshake(); await t3n.authenticate(createEthAuthInput(address));
const u: any = await t3n.getUsage({ limit: 100 } as any);
console.log("RAW:", JSON.stringify(u).slice(0,600)); const rows = u?.entries ?? u?.usage ?? [];
const tot: Record<string, {n:number,amt:number}> = {};
for (const r of rows) {
  const k = String(r.reason ?? r.kind ?? "?");
  tot[k] ??= {n:0,amt:0}; tot[k].n++; tot[k].amt += Number(r.amount ?? 0);
}
console.log("entries:", rows.length);
for (const [k,v] of Object.entries(tot).sort((a,b)=>b[1].amt-a[1].amt))
  console.log(`  ${k.padEnd(28)} n=${String(v.n).padStart(3)}  ${(v.amt/Number(BASE_UNITS_PER_TOKEN)).toFixed(2)} tokens`);
console.log("\nsample row:", JSON.stringify(rows[0]));
