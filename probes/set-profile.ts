/** Sets the data owner's profile fields that {{profile.*}} markers resolve against. */
import "dotenv/config";
import { session } from "../scripts/t3n.js";
const { t3n, did } = await session(process.env.T3N_API_KEY!);
const r = await t3n.submitUserInput({
  profile: { first_name: "Ansh", last_name: "Verma", country_of_residence: "IN" },
});
console.log(`profile updated for ${did}:`, JSON.stringify(r));
