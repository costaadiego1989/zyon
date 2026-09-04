import { describe, it, expect } from "vitest";
import {
  type Address,
  type Hash,
  type Log,
  type PublicClient,
  type Transaction,
  type TransactionReceipt,
  parseUnits,
  pad,
  toHex,
  keccak256,
  toBytes,
} from "viem";
import { mainnet, polygon } from "viem/chains";
import {
  DEFAULT_REQUIRED_CONFIRMATIONS,
  intentToExpected,
  verifyIntent,
  verifyTransaction,
} from "./verify.js";
import {
  createErc20PaymentIntent,
  createNativePaymentIntent,
} from "./intent.js";

const MERCHANT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const SENDER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const TX_HASH = ("0x" + "a".repeat(64)) as Hash;

function pad32(addr: string): `0x${string}` {
  return pad(addr as Address, { size: 32 });
}

function buildReceipt(overrides: Partial<TransactionReceipt> = {}): TransactionReceipt {
  return {
    blockHash: keccak256(toBytes("block-hash")),
    blockNumber: 1000n,
    contractAddress: null,
    cumulativeGasUsed: 21000n,
    effectiveGasPrice: 1n,
    from: SENDER,
    gasUsed: 21000n,
    logs: [],
    logsBloom: "0x",
    status: "success",
    to: MERCHANT,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    type: "eip1559",
    ...overrides,
  } as unknown as TransactionReceipt;
}

function buildTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    blockHash: keccak256(toBytes("block-hash")),
    blockNumber: 1000n,
    from: SENDER,
    gas: 21000n,
    hash: TX_HASH,
    nonce: 0,
    to: MERCHANT,
    transactionIndex: 0,
    value: parseUnits("0.01", 18),
    type: "eip1559",
    ...overrides,
  } as unknown as Transaction;
}

interface ClientStub extends PublicClient {
  receipt: TransactionReceipt | null;
  tx: Transaction;
  headBlock: bigint;
  callCount: { getReceipt: number; getTx: number; getBlock: number };
}

function makeClient(opts: {
  receipt?: TransactionReceipt | null;
  tx?: Transaction;
  headBlock?: bigint;
} = {}): ClientStub {
  const receipt = opts.receipt === undefined ? buildReceipt() : opts.receipt;
  const tx = opts.tx ?? buildTx();
  const headBlock = opts.headBlock ?? 1100n;
  const callCount = { getReceipt: 0, getTx: 0, getBlock: 0 };
  const client: ClientStub = {
    receipt,
    tx,
    headBlock,
    callCount,
    getTransactionReceipt: async () => {
      callCount.getReceipt++;
      return receipt;
    },
    getTransaction: async () => {
      callCount.getTx++;
      return tx;
    },
    getBlockNumber: async () => {
      callCount.getBlock++;
      return headBlock;
    },
  } as unknown as ClientStub;
  return client;
}

describe("verifyTransaction — native", () => {
  it("passes when amount, recipient and confirmations all match", async () => {
    const intent = createNativePaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.01",
      reference: "order_n1",
    });
    const expected = intentToExpected(intent);
    const client = makeClient();
    const result = await verifyTransaction(client, TX_HASH, expected);
    expect(result.ok).toBe(true);
  });

  it("fails when recipient does not match", async () => {
    const intent = createNativePaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.01",
      reference: "order_n2",
    });
    const expected = intentToExpected(intent);
    const wrongMerchant = "0x3C44CdDdB6a900fA2b585dd299e03d12FA4293BC" as Address;
    const client = makeClient({ tx: buildTx({ to: wrongMerchant }) });
    const result = await verifyTransaction(client, TX_HASH, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("to_mismatch");
  });

  it("fails when value does not match", async () => {
    const intent = createNativePaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.01",
      reference: "order_n3",
    });
    const expected = intentToExpected(intent);
    const client = makeClient({ tx: buildTx({ value: parseUnits("0.02", 18) }) });
    const result = await verifyTransaction(client, TX_HASH, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("amount_mismatch");
  });

  it("fails when confirmations are insufficient", async () => {
    const intent = createNativePaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.01",
      reference: "order_n4",
    });
    const expected = intentToExpected(intent);
    const client = makeClient({ headBlock: 1005n });
    const result = await verifyTransaction(client, TX_HASH, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("confirmations_insufficient");
  });

  it("fails when receipt status is reverted", async () => {
    const intent = createNativePaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.01",
      reference: "order_n5",
    });
    const expected = intentToExpected(intent);
    const client = makeClient({ receipt: buildReceipt({ status: "reverted" }) });
    const result = await verifyTransaction(client, TX_HASH, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tx_failed");
  });

  it("fails when tx has no recipient (contract creation)", async () => {
    const intent = createNativePaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.01",
      reference: "order_n6",
    });
    const expected = intentToExpected(intent);
    const client = makeClient({ tx: buildTx({ to: null }) });
    const result = await verifyTransaction(client, TX_HASH, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("to_mismatch");
  });

  it("requires DEFAULT_REQUIRED_CONFIRMATIONS of 12 by default", () => {
    expect(DEFAULT_REQUIRED_CONFIRMATIONS).toBe(12n);
  });
});

describe("verifyTransaction — erc20", () => {
  function buildErc20Receipt(tokenAddr: Address, to: Address, value: bigint): TransactionReceipt {
    const TRANSFER_TOPIC = keccak256(toBytes("Transfer(address,address,uint256)"));
    const blockHash = keccak256(toBytes("block-hash")) as `0x${string}`;

    const log: Log<bigint, number, false> = {
      address: tokenAddr,
      blockHash,
      blockNumber: 1000n,
      data: toHex(value, { size: 32 }),
      logIndex: 0,
      transactionHash: TX_HASH,
      transactionIndex: 0,
      removed: false,
      topics: [TRANSFER_TOPIC, pad32(SENDER), pad32(to)],
    };
    return buildReceipt({
      to: tokenAddr,
      logs: [log],
    });
  }

  it("passes for a valid ERC-20 transfer", async () => {
    const intent = createErc20PaymentIntent({
      chainId: polygon.id,
      symbol: "USDC",
      to: MERCHANT,
      amount: "25.5",
      reference: "order_e1",
    });
    const expected = intentToExpected(intent);
    const tokenAddr = intent.token.address;
    const valueWei = parseUnits("25.5", 6);
    const client = makeClient({
      receipt: buildErc20Receipt(tokenAddr, MERCHANT, valueWei),
      tx: buildTx({ to: tokenAddr, value: 0n }),
    });
    const result = await verifyTransaction(client, TX_HASH, expected);
    expect(result.ok).toBe(true);
  });

  it("fails when the recipient in the Transfer log does not match", async () => {
    const intent = createErc20PaymentIntent({
      chainId: polygon.id,
      symbol: "USDC",
      to: MERCHANT,
      amount: "25.5",
      reference: "order_e2",
    });
    const expected = intentToExpected(intent);
    const tokenAddr = intent.token.address;
    const valueWei = parseUnits("25.5", 6);
    const wrongRecipient = "0x3C44CdDdB6a900fA2b585dd299e03d12FA4293BC" as Address;
    const client = makeClient({
      receipt: buildErc20Receipt(tokenAddr, wrongRecipient, valueWei),
      tx: buildTx({ to: tokenAddr, value: 0n }),
    });
    const result = await verifyTransaction(client, TX_HASH, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("to_mismatch");
  });

  it("fails when the transferred value does not match the expected amount", async () => {
    const intent = createErc20PaymentIntent({
      chainId: polygon.id,
      symbol: "USDC",
      to: MERCHANT,
      amount: "25.5",
      reference: "order_e3",
    });
    const expected = intentToExpected(intent);
    const tokenAddr = intent.token.address;
    const client = makeClient({
      receipt: buildErc20Receipt(tokenAddr, MERCHANT, parseUnits("24.0", 6)),
      tx: buildTx({ to: tokenAddr, value: 0n }),
    });
    const result = await verifyTransaction(client, TX_HASH, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("amount_mismatch");
  });

  it("fails when the tx targets a different contract than the expected token", async () => {
    const intent = createErc20PaymentIntent({
      chainId: polygon.id,
      symbol: "USDC",
      to: MERCHANT,
      amount: "25.5",
      reference: "order_e4",
    });
    const expected = intentToExpected(intent);
    const tokenAddr = intent.token.address;
    const valueWei = parseUnits("25.5", 6);
    const wrongToken = "0x000000000000000000000000000000000000dEaD" as Address;
    const client = makeClient({
      receipt: buildErc20Receipt(tokenAddr, MERCHANT, valueWei),
      tx: buildTx({ to: wrongToken, value: 0n }),
    });
    const result = await verifyTransaction(client, TX_HASH, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("token_mismatch");
  });
});

describe("verifyIntent", () => {
  it("fails with 'expired' when the intent has already expired", async () => {
    const intent = createNativePaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.01",
      reference: "order_exp",
      ttlSeconds: 1,
    });
    // backdate so it's expired
    intent.expiresAt = Math.floor(Date.now() / 1000) - 10;
    const client = makeClient();
    const result = await verifyIntent(client, TX_HASH, intent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("exposes the expected descriptor for off-chain reference reconciliation", async () => {
    const intent = createNativePaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.01",
      reference: "order_meta",
    });
    const client = makeClient();
    const result = await verifyIntent(client, TX_HASH, intent);
    if (!result.ok) throw new Error("expected ok");
    expect(result.expected?.reference).toBe("order_meta");
    expect(result.expected?.chainId).toBe(mainnet.id);
  });
});