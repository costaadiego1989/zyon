import { USDC_DECIMALS } from "./evm-crypto.constants.js";

export function quoteUsdcFromBrlCents(amountCents: number, brlPerUsdc: number): {
  amountAtomic: string;
  amountDisplay: string;
} {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("crypto_quote_amount_invalid");
  }
  if (!Number.isFinite(brlPerUsdc) || brlPerUsdc <= 0) {
    throw new Error("crypto_brl_per_usdc_required");
  }
  const brlMajor = amountCents / 100;
  const usdcMajor = brlMajor / brlPerUsdc;
  const factor = 10 ** USDC_DECIMALS;
  const amountAtomic = Math.round(usdcMajor * factor).toString();
  if (amountAtomic === "0") {
    throw new Error("crypto_quote_too_small");
  }
  const display = (Number(amountAtomic) / factor).toFixed(2);
  return { amountAtomic, amountDisplay: `${display} USDC` };
}
