import assert from "node:assert/strict";
import test from "node:test";
import { EvmCryptoVerifier } from "./evm-crypto-verifier.js";
const txHash = "0x" + "1".repeat(64),
  blockHash = "0x" + "2".repeat(64);
const from = "0x" + "3".repeat(40),
  to = "0x" + "4".repeat(40),
  token = "0x" + "5".repeat(40);
const quote = {
  chainId: 84532,
  chain: "base",
  evmNetwork: "testnet",
  chainLabel: "Base",
  tokenAddress: token,
  tokenSymbol: "USDC" as const,
  amountAtomic: "1000000",
  amountDisplay: "1",
  destinationAddress: to,
  quoteExpiresAt: new Date(Date.now() + 3600000).toISOString(),
};
const receipt = {
  transactionHash: txHash,
  blockHash,
  blockNumber: "0x10",
  status: "0x1",
  type: "0x2",
  from,
  to: token,
  cumulativeGasUsed: "0x5208",
  gasUsed: "0x5208",
  effectiveGasPrice: "0x1",
  transactionIndex: "0x0",
  logsBloom: "0x" + "0".repeat(512),
  logs: [
    {
      address: token,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x" + from.slice(2).padStart(64, "0"),
        "0x" + to.slice(2).padStart(64, "0"),
      ],
      data: "0x" + BigInt(1000000).toString(16).padStart(64, "0"),
      blockHash,
      blockNumber: "0x10",
      transactionHash: txHash,
      transactionIndex: "0x0",
      logIndex: "0x0",
      removed: false,
    },
  ],
};
async function run(
  t: import("node:test").TestContext,
  mode: "metadata_unavailable" | "mismatch" | "all_failed"
) {
  const oldFetch = globalThis.fetch,
    oldUrl = process.env.BASE_SEPOLIA_RPC_URL;
  process.env.BASE_SEPOLIA_RPC_URL = "https://synthetic-rpc.example.test";
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.BASE_SEPOLIA_RPC_URL;
    else process.env.BASE_SEPOLIA_RPC_URL = oldUrl;
  });
  const methods: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const r = JSON.parse(String(init?.body));
    methods.push(r.method);
    if (
      mode === "all_failed" ||
      (r.method === "eth_getBlockByHash" && mode === "metadata_unavailable")
    )
      return Response.json({
        jsonrpc: "2.0",
        id: r.id,
        error: { code: -32000, message: "synthetic rpc unavailable" },
      });
    return Response.json({
      jsonrpc: "2.0",
      id: r.id,
      result:
        r.method === "eth_getTransactionReceipt"
          ? receipt
          : r.method === "eth_blockNumber"
          ? "0x10"
          : {
              hash: "0x" + "9".repeat(64),
              number: "0x10",
              timestamp: "0x6b000000",
              transactions: [],
            },
    });
  }) as typeof fetch;
  return {
    verify: () =>
      new EvmCryptoVerifier().verifyTransfer({
        txHash,
        walletAddress: from,
        buyerFacing: quote,
      }),
    methods,
  };
}
test("FISCAL-16 actual valid crypto transfer remains verified when optional fiscal block metadata is unavailable", async (t) => {
  const a = await run(t, "metadata_unavailable");
  const result = await a.verify();
  assert.equal(result.from, from);
  assert.equal(result.receipt?.txHash, txHash);
  assert.equal(result.receipt?.occurredAt, undefined);
  assert.ok(a.methods.includes("eth_getBlockByHash"));
});
test("FISCAL-16 single RPC returned wrong block fails deterministically without mismatched fiscal timestamp", async (t) => {
  const a = await run(t, "mismatch");
  await assert.rejects(a.verify(), /crypto_receipt_block_mismatch/);
});
test("FISCAL-16 all RPC attempts failed cannot reuse receipt from a failed attempt", async (t) => {
  const a = await run(t, "all_failed");
  await assert.rejects(a.verify());
  assert.equal(a.methods.includes("eth_getBlockByHash"), false);
});
