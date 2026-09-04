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
import { GetStrategyConfigUseCase } from "../../application/use-cases/get-strategy-config.use-case.js";
import { UpdateStrategyConfigUseCase } from "../../application/use-cases/update-strategy-config.use-case.js";

@ApiTags("Dashboard / Cart Recovery")
@Controller("dashboard/cart-recovery")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT")
export class CartRecoveryDashboardController {
  constructor(
    private readonly getRecoveryMetrics: GetRecoveryMetricsUseCase,
    private readonly getStrategyPreferences: GetStrategyPreferencesUseCase,
    private readonly updateStrategyPreferences: UpdateStrategyPreferencesUseCase,
    private readonly getStrategyConfig: GetStrategyConfigUseCase,
    private readonly updateStrategyConfig: UpdateStrategyConfigUseCase,
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
  @ApiOperation({ summary: "Get cart recovery strategy preferences with config" })
  @ApiOkResponse({ description: "Strategy preferences retrieved" })
  async getStrategies(@Req() req: any) {
    const user = currentUser(req);
    const strategies = await this.getStrategyPreferences.execute({
      merchantId: user.merchantId,
    });
    return { strategies };
  }

  @Patch("strategies")
  @ApiOperation({ summary: "Update cart recovery strategy preferences" })
  @ApiOkResponse({ description: "Strategy preferences updated" })
  async patchStrategies(
    @Req() req: any,
    @Body() body: { strategies?: Record<string, unknown> },
  ) {
    const user = currentUser(req);
    const strategies = await this.updateStrategyPreferences.execute({
      merchantId: user.merchantId,
      strategies: body?.strategies ?? {},
    });
    return { strategies };
  }

  @Get("config")
  @ApiOperation({ summary: "Get strategy config (coupon_code, rule_id, etc)" })
  @ApiOkResponse({ description: "Strategy config retrieved" })
  async getConfig(@Req() req: any) {
    const user = currentUser(req);
    const config = await this.getStrategyConfig.execute({
      merchantId: user.merchantId,
    });
    return { config };
  }

  @Patch("config")
  @ApiOperation({ summary: "Update strategy config (coupon_code, rule_id, etc)" })
  @ApiOkResponse({ description: "Strategy config updated" })
  async patchConfig(
    @Req() req: any,
    @Body() body: {
      active_strategy?: string;
      coupon_code?: string;
      rule_id?: string;
    },
  ) {
    const user = currentUser(req);
    const config = await this.updateStrategyConfig.execute({
      merchantId: user.merchantId,
      active_strategy: body?.active_strategy as any ?? "offer_coupon",
      coupon_code: body?.coupon_code,
      rule_id: body?.rule_id,
    });
    return { config };
  }
}

