import { describe, it, expect } from "vitest";
import { decodeFunctionData, getAddress, parseUnits, zeroAddress } from "viem";
import { mainnet, polygon } from "viem/chains";
import {
  createErc20PaymentIntent,
  createNativePaymentIntent,
  createPaymentIntent,
  encodeIntent,
} from "./intent.js";

const MERCHANT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // hardhat #1

describe("createNativePaymentIntent", () => {
  it("creates a native intent with parsed wei amount", () => {
    const intent = createNativePaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.01",
      reference: "order_123",
    });
    expect(intent.kind).toBe("native");
    expect(intent.chainId).toBe(mainnet.id);
    expect(intent.to.toLowerCase()).toBe(MERCHANT.toLowerCase());
    expect(intent.amount).toBe("0.01");
    expect(intent.reference).toBe("order_123");
    expect(intent.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects unsupported chain ids", () => {
    expect(() =>
      createNativePaymentIntent({
        chainId: 999,
        to: MERCHANT,
        amount: "0.01",
        reference: "order_1",
      }),
    ).toThrow(/unsupported_chain_id/);
  });

  it("rejects invalid recipients", () => {
    expect(() =>
      createNativePaymentIntent({
        chainId: mainnet.id,
        to: "not-an-address",
        amount: "0.01",
        reference: "order_1",
      }),
    ).toThrow(/invalid_recipient/);
  });

  it("rejects non-positive amounts", () => {
    expect(() =>
      createNativePaymentIntent({
        chainId: mainnet.id,
        to: MERCHANT,
        amount: "0",
        reference: "order_1",
      }),
    ).toThrow(/amount_must_be_positive/);
    expect(() =>
      createNativePaymentIntent({
        chainId: mainnet.id,
        to: MERCHANT,
        amount: "-1",
        reference: "order_1",
      }),
    ).toThrow();
  });

  it("rejects malformed references", () => {
    expect(() =>
      createNativePaymentIntent({
        chainId: mainnet.id,
        to: MERCHANT,
        amount: "0.01",
        reference: "order with spaces",
      }),
    ).toThrow(/invalid_reference/);
  });

  it("ttl is honoured", () => {
    const intent = createNativePaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.01",
      reference: "order_1",
      ttlSeconds: 60,
    });
    const now = Math.floor(Date.now() / 1000);
    expect(intent.expiresAt).toBeGreaterThanOrEqual(now);
    expect(intent.expiresAt).toBeLessThanOrEqual(now + 65);
  });
});

describe("createErc20PaymentIntent", () => {
  it("creates an erc20 intent with the token descriptor", () => {
    const intent = createErc20PaymentIntent({
      chainId: polygon.id,
      symbol: "USDC",
      to: MERCHANT,
      amount: "25.5",
      reference: "order_42",
    });
    expect(intent.kind).toBe("erc20");
    expect(intent.token.symbol).toBe("USDC");
    expect(intent.token.decimals).toBe(6);
    expect(intent.chainId).toBe(polygon.id);
    expect(intent.to.toLowerCase()).toBe(MERCHANT.toLowerCase());
  });

  it("rejects unsupported tokens on a chain", () => {
    // USDC is not whitelisted on every chain? It IS on all three. Use an unknown symbol.
    expect(() =>
      createErc20PaymentIntent({
        chainId: mainnet.id,
        symbol: "WBTC" as never,
        to: MERCHANT,
        amount: "1",
        reference: "order_1",
      }),
    ).toThrow();
  });
});

describe("createPaymentIntent dispatch", () => {
  it("dispatches native input to native intent", () => {
    const intent = createPaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.01",
      reference: "order_x",
    });
    expect(intent.kind).toBe("native");
  });

  it("dispatches erc20 input to erc20 intent", () => {
    const intent = createPaymentIntent({
      chainId: mainnet.id,
      symbol: "USDT",
      to: MERCHANT,
      amount: "10",
      reference: "order_y",
    });
    expect(intent.kind).toBe("erc20");
  });
});

describe("encodeIntent", () => {
  it("encodes native intents as value-only transfers", () => {
    const intent = createNativePaymentIntent({
      chainId: mainnet.id,
      to: MERCHANT,
      amount: "0.5",
      reference: "order_n1",
    });
    const enc = encodeIntent(intent);
    expect(getAddress(enc.to)).toBe(getAddress(MERCHANT));
    expect(enc.value).toBe(parseUnits("0.5", 18));
    expect(enc.data).toBeUndefined();
  });

  it("encodes erc20 intents as transfer(to,value) calldata to the token contract", () => {
    const intent = createErc20PaymentIntent({
      chainId: mainnet.id,
      symbol: "USDT",
      to: MERCHANT,
      amount: "100",
      reference: "order_e1",
    });
    const enc = encodeIntent(intent);
    expect(getAddress(enc.to)).toBe(getAddress(intent.token.address));
    expect(enc.value).toBe(0n);
    expect(enc.data).toBeDefined();

    const decoded = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "transfer",
          stateMutability: "nonpayable",
          inputs: [
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
      ],
      data: enc.data!,
    });
    expect(decoded.functionName).toBe("transfer");
    const [toArg, valueArg] = decoded.args as [string, bigint];
    expect(getAddress(toArg)).toBe(getAddress(MERCHANT));
    expect(valueArg).toBe(parseUnits("100", 6));
  });

  it("encodes ERC-20 to the zero-value recipient correctly (regression: no zero address swap)", () => {
    const intent = createErc20PaymentIntent({
      chainId: mainnet.id,
      symbol: "USDC",
      to: zeroAddress,
      amount: "1",
      reference: "order_zero",
    });
    const enc = encodeIntent(intent);
    const decoded = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "transfer",
          stateMutability: "nonpayable",
          inputs: [
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
      ],
      data: enc.data!,
    });
    const [toArg, valueArg] = decoded.args as [string, bigint];
    expect(getAddress(toArg)).toBe(getAddress(zeroAddress));
    expect(valueArg).toBe(parseUnits("1", 6));
  });
});