import { Body, Controller, Header, Headers, Param, Post } from "@nestjs/common";
import { RateLimit } from "../../../../shared/http/rate-limit.guard.js";
import { readTrustedStorefrontOrigin } from "../../../embed/presentation/http/embed-auth.guard.js";
import { ResumeRecoveryCheckoutUseCase } from "../../application/use-cases/resume-recovery-checkout.use-case.js";

@Controller("storefront/:slug/recovery")
export class RecoveryCheckoutController {
  constructor(private readonly resume: ResumeRecoveryCheckoutUseCase) {}
  @Post()
  @RateLimit(20)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  execute(@Param("slug") slug: string, @Headers("origin") origin: string | undefined, @Body() body: { token?: unknown; buyer_access_token?: unknown },
    @Headers() headers: Record<string, string | string[] | undefined> = {}) {
    const verifiedOrigin = readTrustedStorefrontOrigin(headers) ?? origin;
    return this.resume.execute({ slug, origin: verifiedOrigin, token: body?.token, buyerToken: body?.buyer_access_token });
  }
}
