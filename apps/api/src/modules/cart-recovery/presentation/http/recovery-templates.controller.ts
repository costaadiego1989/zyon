import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RecoveryTemplateLifecycleUseCase } from "../../../whatsapp-templates/application/use-cases/recovery-template-lifecycle.use-case.js";

@Controller("cart-recovery/templates")
@UseGuards(AuthGuard)
export class RecoveryTemplatesController {
  constructor(private readonly lifecycle: RecoveryTemplateLifecycleUseCase) {}
  @Get()
  get(@Req() req: { user?: unknown }) { return this.lifecycle.get(currentUser(req).merchantId); }
  @Put()
  save(@Req() req: { user?: unknown }, @Body() body: unknown) { return this.lifecycle.save(currentUser(req).merchantId, body); }
}
