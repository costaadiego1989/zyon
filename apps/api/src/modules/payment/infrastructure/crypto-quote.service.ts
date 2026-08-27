import { Injectable, Logger } from "@nestjs/common";

export interface CryptoQuoteResult {
  brlPerUsdc: number;
  source: "binance" | "fallback";
  cachedAt: string;
}

@Injectable()
export class CryptoQuoteService {
  private readonly logger = new Logger(CryptoQuoteService.name);
  private cache: { price: number; fetchedAt: number } | null = null;
  private readonly CACHE_TTL_MS = 60_000; // 60s

  async getUsdcBrl(fallback?: number): Promise<CryptoQuoteResult> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < this.CACHE_TTL_MS) {
      return {
        brlPerUsdc: this.cache.price,
        source: "binance",
        cachedAt: new Date(this.cache.fetchedAt).toISOString(),
      };
    }

    try {
      const res = await fetch(
        "https://api.binance.com/api/v3/ticker/price?symbol=USDCBRL",
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) throw new Error(`binance_http_${res.status}`);
      const data = (await res.json()) as { symbol: string; price: string };
      const price = parseFloat(data.price);
      if (!Number.isFinite(price) || price <= 0) throw new Error("binance_invalid_price");
      this.cache = { price, fetchedAt: now };
      this.logger.log("crypto.quote binance brlPerUsdc=" + price);
      return { brlPerUsdc: price, source: "binance", cachedAt: new Date(now).toISOString() };
    } catch (err) {
      this.logger.warn(`crypto.quote binance_failed: ${err instanceof Error ? err.message : String(err)}`);
      const fb = fallback ?? this.cache?.price;
      if (fb && fb > 0) {
        return { brlPerUsdc: fb, source: "fallback", cachedAt: new Date(now).toISOString() };
      }
      throw new Error("crypto_quote_unavailable");
    }
  }
}
