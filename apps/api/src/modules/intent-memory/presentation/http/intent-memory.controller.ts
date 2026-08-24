import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
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
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
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
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  @Get("me")
  @ApiOperation({ summary: "Get current buyer's stored intent" })
  @ApiOkResponse({ description: "Buyer intent retrieved" })
  async getCurrentBuyerIntent(
    @Req() req: any,
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
    @Req() req: any,
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
    @Req() req: any,
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

  @Get("records")
  @ApiOperation({ summary: "List all intent records for this merchant" })
  @ApiOkResponse({ description: "Intent records list" })
  async listRecords(@Req() req: any) {
    const user = currentUser(req);
    const records = await this.prisma.customerIntentRecord.findMany({
      where: { merchantId: user.merchantId },
      orderBy: { generatedAt: "desc" },
      take: 100,
    });
    return records.map((r: any) => ({
      id: r.id,
      global_user_id: r.globalUserId,
      primary_intent: r.primaryIntent,
      urgency: r.urgency,
      budget_tier: r.budgetTier,
      pain_points: r.painPoints ?? [],
      created_at: r.generatedAt?.toISOString(),
    }));
  }
}
