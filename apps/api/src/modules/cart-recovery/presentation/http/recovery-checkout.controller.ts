import { Body, Controller, Header, Headers, Param, Post } from "@nestjs/common";
import { RateLimit } from "../../../../shared/http/rate-limit.guard.js";
import { ResumeRecoveryCheckoutUseCase } from "../../application/use-cases/resume-recovery-checkout.use-case.js";

@Controller("storefront/:slug/recovery")
export class RecoveryCheckoutController {
  constructor(private readonly resume: ResumeRecoveryCheckoutUseCase) {}
  @Post()
  @RateLimit(20)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  execute(@Param("slug") slug: string, @Headers("origin") origin: string | undefined, @Body() body: { token?: unknown; buyer_access_token?: unknown }) {
    return this.resume.execute({ slug, origin, token: body?.token, buyerToken: body?.buyer_access_token });
  }
}
