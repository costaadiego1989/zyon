import { ethers } from "hardhat";

/**
 * Deploy ZyonPaymentSplitter to the target network.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network polygon
 *   npx hardhat run scripts/deploy.ts --network polygonAmoy
 *   npx hardhat run scripts/deploy.ts --network base
 *   npx hardhat run scripts/deploy.ts --network baseSepolia
 *
 * Required env:
 *   DEPLOYER_PRIVATE_KEY — wallet with gas for deploy
 *   ZYON_TREASURY_ADDRESS — your fee wallet
 */

const TREASURY = process.env.ZYON_TREASURY_ADDRESS;
const INITIAL_FEE_BPS = 300; // 3%

// Token addresses per chain
const TOKENS: Record<number, string[]> = {
  // Polygon PoS mainnet
  137: [
    "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC
    "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // USDT
  ],
  // Polygon Amoy testnet
  80002: [
    "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", // Test USDC
  ],
  // Base mainnet
  8453: [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
  ],
  // Base Sepolia testnet
  84532: [
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Test USDC
  ],
};

async function main() {
  if (!TREASURY) {
    throw new Error("Set ZYON_TREASURY_ADDRESS env var before deploying.");
  }

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`\n🚀 Deploying ZyonPaymentSplitter`);
  console.log(`   Chain:    ${chainId}`);
  console.log(`   Deployer: ${deployer.address}`);
  console.log(`   Treasury: ${TREASURY}`);
  console.log(`   Fee:      ${INITIAL_FEE_BPS} bps (${INITIAL_FEE_BPS / 100}%)`);

  const tokens = TOKENS[chainId];
  if (!tokens || tokens.length === 0) {
    throw new Error(`No token addresses configured for chain ${chainId}`);
  }
  console.log(`   Tokens:   ${tokens.join(", ")}`);

  const Factory = await ethers.getContractFactory("ZyonPaymentSplitter");
  const contract = await Factory.deploy(TREASURY, INITIAL_FEE_BPS, tokens);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\n✅ Deployed at: ${address}`);
  console.log(`\n📋 Add to .env:`);
  console.log(`   PAYMENT_SPLITTER_ADDRESS=${address}`);
  console.log(`   PAYMENT_SPLITTER_CHAIN_ID=${chainId}`);

  console.log(`\n🔍 Verify on explorer:`);
  console.log(`   npx hardhat verify --network ${network.name} ${address} ${TREASURY} ${INITIAL_FEE_BPS} "[${tokens.map(t => `"${t}"`).join(",")}]"`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
