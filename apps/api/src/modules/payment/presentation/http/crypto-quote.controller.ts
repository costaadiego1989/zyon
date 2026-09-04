import { Controller, Get } from "@nestjs/common";
import { CryptoQuoteService } from "../../infrastructure/crypto-quote.service.js";

@Controller("crypto")
export class CryptoQuoteController {
  constructor(private readonly quoteService: CryptoQuoteService) {}

  @Get("quote")
  async getQuote() {
    return this.quoteService.getUsdcBrl();
  }
}
