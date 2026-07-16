import { describe, it, expect } from "vitest";
import {
  CHAINS,
  ERC20_TOKENS,
  SUPPORTED_CHAIN_IDS,
  getChain,
  getErc20Token,
  isSupportedChainId,
} from "./chains.js";
import { mainnet, polygon, bsc } from "viem/chains";

describe("chains module", () => {
  it("exposes the three whitelisted chains", () => {
    expect(SUPPORTED_CHAIN_IDS).toEqual([mainnet.id, polygon.id, bsc.id]);
    expect(CHAINS.map((c) => c.id)).toEqual([mainnet.id, polygon.id, bsc.id]);
  });

  it("isSupportedChainId narrows correctly", () => {
    expect(isSupportedChainId(mainnet.id)).toBe(true);
    expect(isSupportedChainId(999999)).toBe(false);
  });

  it("getChain throws for unsupported ids", () => {
    expect(() => getChain(999999)).toThrow(/unsupported_chain_id/);
  });

  it("ERC20_TOKENS has at least USDT and USDC on every supported chain", () => {
    for (const id of SUPPORTED_CHAIN_IDS) {
      const tokens = ERC20_TOKENS[id];
      const symbols = tokens.map((t) => t.symbol);
      expect(symbols).toContain("USDT");
      expect(symbols).toContain("USDC");
    }
  });

  it("USDT/USDC decimals are 6 on Ethereum and Polygon, 18 on BSC", () => {
    expect(getErc20Token(mainnet.id, "USDT").decimals).toBe(6);
    expect(getErc20Token(polygon.id, "USDT").decimals).toBe(6);
    expect(getErc20Token(bsc.id, "USDT").decimals).toBe(18);
    expect(getErc20Token(mainnet.id, "USDC").decimals).toBe(6);
    expect(getErc20Token(bsc.id, "USDC").decimals).toBe(18);
  });

  it("rejects unsupported symbols", () => {
    expect(() => getErc20Token(mainnet.id, "DOGE" as never)).toThrow();
  });
});