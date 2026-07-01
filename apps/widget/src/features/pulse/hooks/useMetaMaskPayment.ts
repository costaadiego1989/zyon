import { useState } from "react";
import { createWalletClient, custom, parseUnits } from "viem";
import { base } from "viem/chains";

const CCTP_TOKEN_MESSENGER = "0xbd3fa81b58ba92a82136038b25adec7066af3155" as const;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const STELLAR_DOMAIN_ID = 6;

const TOKEN_MESSENGER_ABI = [
  {
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
    ],
    name: "depositForBurn",
    outputs: [{ name: "nonce", type: "uint64" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Decodes a Stellar G-address (Strkey) to its raw 32-byte ed25519 public key,
 * then formats as a 0x-prefixed bytes32 hex string for CCTP mintRecipient.
 * Strkey structure: base32(version_byte[1] + raw_key[32] + crc16[2])
 * Version byte for G-address (ED25519_PUBLIC_KEY) = 0x30. We skip it and
 * take the next 32 bytes as the raw key.
 */
function stellarAddressToBytes32(stellarPublicKey: string): `0x${string}` {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const decoded: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of stellarPublicKey) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      decoded.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  // decoded[0] = version byte (0x30), decoded[1..32] = raw 32-byte key
  const rawKey = decoded.slice(1, 33);
  return ("0x" + rawKey.map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

export type MetaMaskPaymentStatus =
  | "idle"
  | "connecting"
  | "approving"
  | "burning"
  | "submitted"
  | "error";

export interface UseMetaMaskPaymentResult {
  status: MetaMaskPaymentStatus;
  txHash: string | null;
  error: string | null;
  payWithMetaMask: (amountUSDC: string, merchantStellarAddress: string) => Promise<void>;
}

export function useMetaMaskPayment(): UseMetaMaskPaymentResult {
  const [status, setStatus] = useState<MetaMaskPaymentStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function payWithMetaMask(amountUSDC: string, merchantStellarAddress: string) {
    setError(null);
    setTxHash(null);

    try {
      // 1. Connect MetaMask
      setStatus("connecting");
      type WindowEthereum = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      const ethereum = (window as unknown as { ethereum?: WindowEthereum }).ethereum;
      if (!ethereum) {
        throw new Error("MetaMask não encontrado. Instale a extensão MetaMask.");
      }

      const client = createWalletClient({
        chain: base,
        transport: custom(ethereum),
      });

      const [account] = await client.requestAddresses();
      if (!account) throw new Error("Nenhuma conta encontrada na carteira.");

      const amount = parseUnits(amountUSDC, 6); // USDC = 6 decimals
      const mintRecipient = stellarAddressToBytes32(merchantStellarAddress);

      // 2. Approve CCTP TokenMessenger to spend USDC
      setStatus("approving");
      await client.writeContract({
        address: USDC_BASE,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CCTP_TOKEN_MESSENGER, amount],
        account,
      });

      // 3. depositForBurn — burns USDC on Base, Circle attests and mints on Stellar
      setStatus("burning");
      const hash = await client.writeContract({
        address: CCTP_TOKEN_MESSENGER,
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [amount, STELLAR_DOMAIN_ID, mintRecipient, USDC_BASE],
        account,
      });

      setTxHash(hash);
      setStatus("submitted");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Pagamento falhou.");
    }
  }

  return { status, txHash, error, payWithMetaMask };
}
