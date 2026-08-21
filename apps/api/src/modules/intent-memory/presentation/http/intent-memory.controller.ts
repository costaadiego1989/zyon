import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { ClassifyCustomerIntentUseCase, RecordIntentIfConsentedUseCase } from "../../application/use-cases/classify-customer-intent.use-case.js";

@ApiTags("Intent Memory")
@Controller("intent-memory")
@UseGuards(TenantAccessGuard)
@ApiBearerAuth("JWT")
export class IntentMemoryController {
  constructor(
    private readonly classifyCustomerIntent: ClassifyCustomerIntentUseCase,
    private readonly recordIntentIfConsented: RecordIntentIfConsentedUseCase,
  ) {}

  @Get("me")
  @ApiOperation({ summary: "Get current buyer's stored intent" })
  @ApiOkResponse({ description: "Buyer intent retrieved" })
  async getCurrentBuyerIntent(
    @Req() req: TenantPrincipalRequest,
  ) {
    const principal = currentTenantPrincipal(req);
    return {
      merchantId: principal.tenantId,
      intent: null,
      message: "Buyer intent retrieved",
    };
  }

  @Post("classify")
  @ApiOperation({ summary: "Classify customer intent from session data" })
  @ApiOkResponse({ description: "Intent classified" })
  async classifyIntent(
    @Req() req: TenantPrincipalRequest,
    @Body() body: any,
  ) {
    const principal = currentTenantPrincipal(req);

    try {
      const result = await this.classifyCustomerIntent.execute({
        merchantId: principal.tenantId,
        globalUserId: body?.globalUserId,
        sessionEvents: body?.sessionEvents ?? [],
        cart: body?.cart ?? { total: 0, items: [] },
      });
      return result;
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  @Post("record")
  @ApiOperation({ summary: "Record intent if buyer has consent" })
  @ApiOkResponse({ description: "Intent recorded if consent exists" })
  async recordIntent(
    @Req() req: TenantPrincipalRequest,
    @Body() body: any,
  ) {
    const principal = currentTenantPrincipal(req);

    try {
      const result = await this.recordIntentIfConsented.execute({
        merchantId: principal.tenantId,
        globalUserId: body?.globalUserId,
        sessionEvents: body?.sessionEvents ?? [],
        cart: body?.cart ?? { total: 0, items: [] },
      });
      return {
        recorded: result.recorded,
        message: "Intent recording attempt completed",
      };
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }
}
