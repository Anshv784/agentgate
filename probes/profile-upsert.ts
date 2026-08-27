import "dotenv/config";
import {
  T3nClient, setEnvironment, loadWasmComponent, eth_get_address,
  metamask_sign, createEthAuthInput, fetchTrustedManifest,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet");
const KEY = process.env.T3N_API_KEY!;
const address = eth_get_address(KEY);
const t3n = new T3nClient({
  trustAnchor: await fetchTrustedManifest("testnet"),
  wasmComponent: await loadWasmComponent(),
  handlers: { EthSign: metamask_sign(address, undefined, KEY) },
});
await t3n.handshake();
const did = (await t3n.authenticate(createEthAuthInput(address))).value;
console.log("did:", did);

const show = async (label: string, fn: () => Promise<unknown>) => {
  try { console.log(`\n### ${label}\n`, JSON.stringify(await fn(), null, 1)?.slice(0, 900)); }
  catch (e: any) { console.log(`\n### ${label}\n !! ${e?.constructor?.name}: ${e?.message}`); }
};

// Does a profile already exist? Try the tee:user read paths.
for (const fn of ["user-get", "user-profile-get", "get-user", "profile-get"]) {
  await show(`tee:user / ${fn}`, () => t3n.executeAndDecode({
    contract_id: "tee:user", function_name: fn, input: {},
  }));
}

// Can we upsert non-email profile fields without an OTP?
await show("submitUserInput(first/last/country)", () => t3n.submitUserInput({
  profile: { first_name: "Test", last_name: "Tenant", country_of_residence: "IN" },
}));
