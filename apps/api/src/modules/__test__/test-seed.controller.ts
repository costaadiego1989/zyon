import { Controller, ForbiddenException, Post } from "@nestjs/common";
import { EmbedTokenService } from "../embed/domain/embed-token.service.js";

@Controller("__test__")
export class TestSeedController {
  @Post("seed")
  seed(): { merchantId: string; embedToken: string; productId: string } {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException("test_seed_disabled_in_production");
    }
    const merchantId = `e2e_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const tokens = new EmbedTokenService();
    const now = Math.floor(Date.now() / 1000);
    const embedToken = tokens.sign({
      typ: "aacp_embed_v1",
      merchantId,
      issuedAtUnix: now,
      expiresAtUnix: now + 3600,
      nonce: crypto.randomUUID()
    });
    return { merchantId, embedToken, productId: "e2e_product_001" };
  }
}
