/**
 * On-chain monitor: watches USDC Transfer events to the merchant treasury on
 * Polygon Amoy testnet. Prints each incoming transfer so you can grab the
 * tx_hash and confirm the payment. Line-buffered output for the Monitor tool.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });

import { createPublicClient, http, parseAbiItem, formatUnits } from "viem";
import { polygonAmoy } from "viem/chains";

const RPC = process.env.POLYGON_AMOY_RPC_URL?.trim() || "https://rpc-amoy.polygon.technology";
const USDC = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"; // Amoy USDC
const TREASURY = (process.argv[2] || "0xace766314108EfE2E2cCE80e15551110BC0EE217").toLowerCase();

const client = createPublicClient({ chain: polygonAmoy, transport: http(RPC) });

console.log(`WATCH_START treasury=${TREASURY} usdc=${USDC} rpc=${RPC}`);

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

let lastBlock = await client.getBlockNumber();
console.log(`WATCH_BLOCK start=${lastBlock}`);

// Poll every 5s for new Transfer logs to treasury (avoids WS dependency on testnet RPC)
setInterval(async () => {
  try {
    const current = await client.getBlockNumber();
    if (current <= lastBlock) return;
    const logs = await client.getLogs({
      address: USDC,
      event: transferEvent,
      args: { to: TREASURY as `0x${string}` },
      fromBlock: lastBlock + 1n,
      toBlock: current,
    });
    for (const log of logs) {
      const from = log.args.from;
      const value = log.args.value ?? 0n;
      console.log(
        `USDC_RECEIVED tx=${log.transactionHash} from=${from} amount=${formatUnits(value, 6)} USDC block=${log.blockNumber}`
      );
    }
    lastBlock = current;
  } catch (err) {
    console.log(`WATCH_ERR ${err instanceof Error ? err.message : String(err)}`);
  }
}, 5000);
