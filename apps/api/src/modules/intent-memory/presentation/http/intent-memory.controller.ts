import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { ClassifyCustomerIntentUseCase, RecordIntentIfConsentedUseCase } from "../../application/use-cases/classify-customer-intent.use-case.js";

@ApiTags("Intent Memory")
@Controller("intent-memory")
@UseGuards(AuthGuard)
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
    @Req() req: Request,
  ) {
    const user = currentUser(req);
    return {
      merchantId: user.merchantId,
      intent: null,
      message: "Buyer intent retrieved",
    };
  }

  @Post("classify")
  @ApiOperation({ summary: "Classify customer intent from session data" })
  @ApiOkResponse({ description: "Intent classified" })
  async classifyIntent(
    @Req() req: Request,
    @Body() body: any,
  ) {
    const user = currentUser(req);

    try {
      const result = await this.classifyCustomerIntent.execute({
        merchantId: user.merchantId,
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
    @Req() req: Request,
    @Body() body: any,
  ) {
    const user = currentUser(req);

    try {
      const result = await this.recordIntentIfConsented.execute({
        merchantId: user.merchantId,
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
