import "dotenv/config";
import { BASE_UNITS_PER_TOKEN } from "@terminal3/t3n-sdk";
import { session } from "../scripts/t3n.js";
const { t3n } = await session(process.env.T3N_API_KEY!);
const b: any = await t3n.getBalance();
console.log(`  ${(b.available / Number(BASE_UNITS_PER_TOKEN)).toFixed(0)} of 20000 tokens left`);
