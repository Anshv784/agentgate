// Shared session helpers. One place that knows how to build a client, so the
// deploy/doctor/demo scripts can't drift apart.
import "dotenv/config";
// TODO(post-bounty-review): migrate to t3n-sdk 5.21.x and
// host:tenant@2.0.0 after confirming submission compatibility.
import {
  T3nClient, TenantClient, setEnvironment, loadWasmComponent, eth_get_address,
  metamask_sign, createEthAuthInput, fetchTrustedManifest, getNodeUrl,
} from "@terminal3/t3n-sdk";

export const env = () => {
  setEnvironment((process.env.T3N_ENV as "testnet" | "production") ?? "testnet");
  return getNodeUrl();
};

/** Substitute `$VAR` references in a config tree from process.env. */
export function expand<T>(v: T): T {
  if (typeof v === "string") return (v.startsWith("$") ? process.env[v.slice(1)] ?? "" : v) as unknown as T;
  if (Array.isArray(v)) return v.map(expand) as unknown as T;
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)])) as T;
  return v;
}

export async function session(key: string) {
  const baseUrl = env();
  const address = eth_get_address(key);
  const t3n = new T3nClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent: await loadWasmComponent(),
    handlers: { EthSign: metamask_sign(address, undefined, key) },
  });
  await t3n.handshake();
  const did = (await t3n.authenticate(createEthAuthInput(address))).value;
  // baseUrl is passed explicitly: TenantClient can fail at request time
  // without it even after setEnvironment(). See docs/BUGS.md #4.
  const tenant = new TenantClient({ t3n, baseUrl, tenantDid: did });
  return { t3n, tenant, did, tid: did.slice("did:t3n:".length), baseUrl };
}

export const clip = (s: unknown, n = 300) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
