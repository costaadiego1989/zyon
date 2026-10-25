import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });
import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";

const p = createPrismaClient();
const MID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

// Switch merchant crypto from mainnet → testnet for local testing
const rules = await (p as any).merchantRule.findUnique({ where: { merchantId: MID } });
const currentCrypto = rules?.cryptoPayments ?? {};
console.log("Current crypto config:", JSON.stringify(currentCrypto, null, 2));

const testConfig = {
  ...currentCrypto,
  network: "testnet",  // switch from mainnet to testnet
  chain: "polygon",    // keep polygon (Amoy testnet)
  enabled: true,
};

await (p as any).merchantRule.update({
  where: { merchantId: MID },
  data: { cryptoPayments: testConfig },
});

console.log("\n✓ Updated to TESTNET:", JSON.stringify(testConfig, null, 2));
console.log("\nChain: Polygon Amoy (testnet, chainId 80002)");
console.log("USDC contract: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582");
console.log("Treasury:", testConfig.treasuryAddress);
console.log("\n⚠ Get test USDC from https://faucet.circle.com/ (Polygon Amoy)");

await p.$disconnect();
