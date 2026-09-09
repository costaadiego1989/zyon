import { Body, Controller, Get, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RecoveryTemplateLifecycleUseCase } from "../../../whatsapp-templates/application/use-cases/recovery-template-lifecycle.use-case.js";
import { GenerateRecoveryTemplatesUseCase } from "../../application/use-cases/generate-recovery-templates.use-case.js";
import { RateLimit } from "../../../../shared/rate-limit/rate-limit.decorators.js";

@Controller("cart-recovery/templates")
@UseGuards(AuthGuard)
export class RecoveryTemplatesController {
  constructor(
    private readonly lifecycle: RecoveryTemplateLifecycleUseCase,
    private readonly generator: GenerateRecoveryTemplatesUseCase,
  ) {}
  @Get()
  get(@Req() req: { user?: unknown }) { return this.lifecycle.get(currentUser(req).merchantId); }
  @Put()
  save(@Req() req: { user?: unknown }, @Body() body: unknown) { return this.lifecycle.save(currentUser(req).merchantId, body); }
  @Post("generate")
  @RateLimit(3, 60_000)
  generate(@Req() req: { user?: unknown }) { return this.generator.execute(currentUser(req).merchantId); }
}
