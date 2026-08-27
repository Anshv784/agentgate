import "dotenv/config";
import { randomBytes } from "crypto";
import {
  T3nClient, setEnvironment, loadWasmComponent, eth_get_address, metamask_sign,
  createEthAuthInput, fetchTrustedManifest, getNodeUrl, BASE_UNITS_PER_TOKEN,
} from "@terminal3/t3n-sdk";
const clip = (s: unknown, n = 300) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
process.on("uncaughtException", e => { console.log("UNCAUGHT:", clip((e as any)?.message)); process.exit(1); });
setEnvironment("testnet");

const wasmComponent = await loadWasmComponent();
const trustAnchor = await fetchTrustedManifest("testnet");
const session = async (key: string) => {
  const address = eth_get_address(key);
  const c = new T3nClient({ trustAnchor, wasmComponent, handlers: { EthSign: metamask_sign(address, undefined, key) } });
  await c.handshake();
  const did = (await c.authenticate(createEthAuthInput(address))).value;
  return { c, did, address };
};
const tok = (n: number) => (n / Number(BASE_UNITS_PER_TOKEN)).toFixed(2);

// --- 1. tenant (the claimed key) ---
const { c: t3n, did: tenantDid } = await session(process.env.T3N_API_KEY!);
console.log("TENANT   ", tenantDid, "| balance", tok((await t3n.getBalance() as any).available));

// --- 2. can a locally-generated keypair become a user identity? ---
const userKey = "0x" + randomBytes(32).toString("hex");
try {
  const { c: uc, did: userDid, address } = await session(userKey);
  const ub: any = await uc.getBalance();
  console.log("USER     ", userDid, "| addr", address, "| balance", tok(ub.available));
  console.log("USER_KEY =", userKey);
  try { await uc.submitUserInput({ profile: { first_name: "Dana", last_name: "Okafor", country_of_residence: "IN" } });
        console.log("  profile upsert: OK"); }
  catch (e: any) { console.log("  profile upsert FAILED:", clip(e?.message, 200)); }
} catch (e: any) { console.log("USER  session FAILED:", clip(e?.message)); }

// --- 3. org + agent minting ---
try {
  const orgDid = (await t3n.createOrganisation("AgentGate Demo Org")).value;
  console.log("ORG      ", orgDid);
  const a = await t3n.createAgent(orgDid, "AgentGate Provisioner");
  console.log("AGENT    ", (a.agentDid as any)?.value ?? a.agentDid);
  console.log("AGENT_KEY=", a.apiKey, "| keyId", a.keyId);
  console.log("ORG_DID  =", orgDid);
} catch (e: any) { console.log("ORG/AGENT FAILED:", clip(e?.message, 400)); }

console.log("\nTENANT balance after:", tok((await t3n.getBalance() as any).available));
