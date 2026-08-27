import "dotenv/config";
import { setEnvironment, getNodeUrl, getContractVersion } from "@terminal3/t3n-sdk";
setEnvironment("testnet");
const clip = (s: unknown, n = 160) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);

// Names exactly as listContracts() reports them, vs the "/contracts" form the docs use.
const names = [
  "tee:user", "tee:user/contracts",
  "tee:org-data", "tee:org-data/contracts",
  "tee:agent-registry", "tee:agent-registry/contracts",
  "tee:vc", "tee:organisation", "tee:agent-connect",
];
for (const n of names) {
  try { console.log(`OK    ${n.padEnd(32)} -> ${await getContractVersion(getNodeUrl(), n)}`); }
  catch (e: any) { console.log(`FAIL  ${n.padEnd(32)} -> ${clip(e?.message)}`); }
}
