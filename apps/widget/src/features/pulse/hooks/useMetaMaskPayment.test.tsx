import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeContract = vi.fn();
const requestAddresses = vi.fn();
const switchRequest = vi.fn();

vi.mock("viem", () => ({
  createWalletClient: vi.fn(() => ({ requestAddresses, writeContract })),
  custom: vi.fn((provider) => provider),
  erc20Abi: [{ type: "function", name: "transfer" }],
  isAddress: vi.fn((value: string) => /^0x[a-fA-F0-9]{40}$/.test(value)),
  parseUnits: vi.fn(() => 123000000n),
}));

vi.mock("viem/chains", () => ({
  polygon: { id: 137, name: "Polygon", nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, rpcUrls: { default: { http: ["https://polygon-rpc.com"] } }, blockExplorers: { default: { url: "https://polygonscan.com" } } },
  polygonAmoy: { id: 80002, name: "Polygon Amoy", nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc-amoy.polygon.technology"] } }, blockExplorers: { default: { url: "https://amoy.polygonscan.com" } } },
  base: { id: 8453, name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://mainnet.base.org"] } }, blockExplorers: { default: { url: "https://basescan.org" } } },
  baseSepolia: { id: 84532, name: "Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://sepolia.base.org"] } }, blockExplorers: { default: { url: "https://sepolia.basescan.org" } } },
}));

import { useMetaMaskPayment } from "./useMetaMaskPayment";

describe("useMetaMaskPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchRequest.mockResolvedValue(null);
    requestAddresses.mockResolvedValue(["0x1111111111111111111111111111111111111111"]);
    writeContract
      .mockResolvedValueOnce("0xapprove")
      .mockResolvedValueOnce("0xtransfer");
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      value: { request: switchRequest },
    });
  });

  it("switches to the configured EVM chain, approves USDC, then transfers to treasury", async () => {
    const { result } = renderHook(() => useMetaMaskPayment());

    await act(async () => {
      await result.current.payWithMetaMask(
        "12.30",
        "0x2222222222222222222222222222222222222222",
        "base",
        "testnet",
      );
    });

    expect(switchRequest).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] });
    expect(writeContract).toHaveBeenNthCalledWith(1, expect.objectContaining({
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      functionName: "approve",
      args: ["0x2222222222222222222222222222222222222222", 123000000n],
    }));
    expect(writeContract).toHaveBeenNthCalledWith(2, expect.objectContaining({
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      functionName: "transfer",
      args: ["0x2222222222222222222222222222222222222222", 123000000n],
    }));
    expect(result.current.txHash).toBe("0xtransfer");
    expect(result.current.approvalTxHash).toBe("0xapprove");
    expect(result.current.status).toBe("submitted");
  });
});
