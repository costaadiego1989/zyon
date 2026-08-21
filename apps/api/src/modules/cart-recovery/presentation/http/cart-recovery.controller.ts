import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { GetRecoveryMetricsUseCase } from "../../application/use-cases/get-recovery-metrics.use-case.js";
import { GetStrategyPreferencesUseCase } from "../../application/use-cases/get-strategy-preferences.use-case.js";
import { UpdateStrategyPreferencesUseCase } from "../../application/use-cases/update-strategy-preferences.use-case.js";

@ApiTags("Cart Recovery")
@Controller("cart-recovery")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT")
export class CartRecoveryController {
  constructor(
    private readonly getRecoveryMetrics: GetRecoveryMetricsUseCase,
    private readonly getStrategyPreferences: GetStrategyPreferencesUseCase,
    private readonly updateStrategyPreferences: UpdateStrategyPreferencesUseCase,
  ) {}

  @Get("metrics")
  @ApiOperation({ summary: "Get recovery metrics and statistics" })
  @ApiOkResponse({ description: "Recovery metrics retrieved" })
  async getMetrics(
    @Req() req: any,
    @Query() query?: { daysBack?: number },
  ) {
    const user = currentUser(req);
    const daysBack = query?.daysBack ?? 30;
    const to = new Date();
    const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000);
    return this.getRecoveryMetrics.execute({
      merchantId: user.merchantId,
      from,
      to,
    });
  }

  @Get("attempts")
  @ApiOperation({ summary: "List recovery attempts" })
  @ApiOkResponse({ description: "Recovery attempts retrieved" })
  async listAttempts(
    @Req() req: any,
    @Query() query?: { status?: string; limit?: number; offset?: number },
  ) {
    const user = currentUser(req);
    const status = query?.status ?? "all";
    const limit = Math.min(query?.limit ?? 50, 100);
    const offset = query?.offset ?? 0;
    return {
      merchantId: user.merchantId,
      status,
      limit,
      offset,
      message: "Recovery attempts endpoint",
    };
  }

  @Get("strategies")
  @ApiOperation({ summary: "Get cart recovery strategy toggles" })
  @ApiOkResponse({ description: "Strategy preferences retrieved" })
  async getStrategies(@Req() req: any) {
    const user = currentUser(req);
    const strategies = await this.getStrategyPreferences.execute({
      merchantId: user.merchantId,
    });
    return { strategies };
  }

  @Patch("strategies")
  @ApiOperation({ summary: "Update cart recovery strategy toggles" })
  @ApiOkResponse({ description: "Strategy preferences updated" })
  async patchStrategies(
    @Req() req: any,
    @Body() body: { strategies?: Record<string, boolean> },
  ) {
    const user = currentUser(req);
    const strategies = await this.updateStrategyPreferences.execute({
      merchantId: user.merchantId,
      strategies: body?.strategies ?? {},
    });
    return { strategies };
  }
}
