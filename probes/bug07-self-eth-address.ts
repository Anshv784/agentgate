/**
 * #7 — getSelfEthAddress() does not return the address that authenticated.
 *
 * Read-only: one handshake plus one authenticate. No metered calls.
 */
import "dotenv/config";
import {
  T3nClient, setEnvironment, loadWasmComponent, eth_get_address,
  metamask_sign, createEthAuthInput, fetchTrustedManifest,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet");
const keyAddress = eth_get_address(process.env.T3N_API_KEY!);

const t3n = new T3nClient({
  trustAnchor: await fetchTrustedManifest("testnet"),
  wasmComponent: await loadWasmComponent(),
  handlers: { EthSign: metamask_sign(keyAddress, undefined, process.env.T3N_API_KEY!) },
});
await t3n.handshake();
await t3n.authenticate(createEthAuthInput(keyAddress));

const reported = await (t3n as any).getSelfEthAddress?.();
console.log("eth_get_address(T3N_API_KEY) :", keyAddress, " <- the key that signed in");
console.log("t3n.getSelfEthAddress()      :", reported);
console.log("match                        :",
  String(keyAddress).toLowerCase() === String(reported).toLowerCase());
console.log("t3n.getDid()                 :", String(t3n.getDid()));
