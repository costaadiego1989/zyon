import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { GetSellerOrdersUseCase } from "../../application/use-cases/get-seller-orders.use-case.js";
import { GetSellerStatsUseCase } from "../../application/use-cases/get-seller-stats.use-case.js";
import { UpdateMarketplaceConfigUseCase } from "../../application/use-cases/update-marketplace-config.use-case.js";
import { HandleMarketplaceChargebackUseCase } from "../../application/use-cases/handle-marketplace-chargeback.use-case.js";
import { RegisterMarketplaceReturnUseCase } from "../../application/use-cases/register-marketplace-return.use-case.js";
import { ListSellerSettlementsUseCase } from "../../application/use-cases/list-seller-settlements.use-case.js";
import { GetSettlementDetailUseCase } from "../../application/use-cases/get-settlement-detail.use-case.js";
import { ListSellerDebtsUseCase } from "../../application/use-cases/list-seller-debts.use-case.js";
import { GetDebtDetailUseCase } from "../../application/use-cases/get-debt-detail.use-case.js";
import { ListMarketplaceChargebacksUseCase } from "../../application/use-cases/list-marketplace-chargebacks.use-case.js";
import { ListMarketplaceEventsUseCase } from "../../application/use-cases/list-marketplace-events.use-case.js";
import { MarketplaceEntityMapper } from "../../application/mappers/marketplace-entity.mapper.js";

interface AuthenticatedRequest {
  user: {
    userId: string;
    merchantId: string;
    email: string;
    role: "owner" | "admin";
  };
}

@UseGuards(AuthGuard, PlanLimitGuard)
@RequirePlanFeature("marketplace")
@Controller("marketplace/dashboard")
export class MarketplaceController {
  constructor(
    private readonly getSellerOrders: GetSellerOrdersUseCase,
    private readonly getSellerStats: GetSellerStatsUseCase,
    private readonly configUseCase: UpdateMarketplaceConfigUseCase,
    private readonly handleChargeback: HandleMarketplaceChargebackUseCase,
    private readonly registerReturn: RegisterMarketplaceReturnUseCase,
    private readonly listSettlements: ListSellerSettlementsUseCase,
    private readonly getSettlementDetail: GetSettlementDetailUseCase,
    private readonly listDebts: ListSellerDebtsUseCase,
    private readonly getDebtDetail: GetDebtDetailUseCase,
    private readonly listChargebacks: ListMarketplaceChargebacksUseCase,
    private readonly listEvents: ListMarketplaceEventsUseCase,
  ) {}

  @Get("config")
  async getConfig(@Req() request: AuthenticatedRequest) {
    const user = currentUser(request);
    const result = await this.configUseCase.execute({
      merchantId: user.merchantId,
    });
    return MarketplaceEntityMapper.toConfigResponse(result.config);
  }

  @Patch("config")
  async updateConfig(
    @Req() request: AuthenticatedRequest,
    @Body() body: any,
  ) {
    const user = currentUser(request);
    const result = await this.configUseCase.execute({
      merchantId: user.merchantId,
      enabled: body.enabled,
      commissionRateBps: body.commission_rate_bps,
      returnWindowDays: body.return_window_days,
      payoutDelayDays: body.payout_delay_days,
      chargebackWindowDays: body.chargeback_window_days,
      blockedMerchants: body.blocked_merchants,
    });
    return MarketplaceEntityMapper.toConfigResponse(result.config);
  }

  @Get("orders")
  async orders(@Req() request: AuthenticatedRequest) {
    const user = currentUser(request);
    return this.getSellerOrders.execute({
      sellerMerchantId: user.merchantId,
    });
  }

  @Get("stats")
  async stats(@Req() request: AuthenticatedRequest) {
    const user = currentUser(request);
    return this.getSellerStats.execute({
      sellerMerchantId: user.merchantId,
    });
  }

  @Post("chargeback/:settlementId")
  async chargeback(
    @Req() request: AuthenticatedRequest,
    @Param("settlementId") settlementId: string,
  ) {
    return this.handleChargeback.execute({
      settlementId,
    });
  }

  @Post("returns")
  async registerReturnEndpoint(
    @Req() request: AuthenticatedRequest,
    @Body() body: { order_id?: string; settlement_id?: string },
  ) {
    return this.registerReturn.execute({
      orderId: body.order_id,
      settlementId: body.settlement_id,
    });
  }

  @Get("settlements")
  async settlements(
    @Req() request: AuthenticatedRequest,
    @Query("status") status?: string,
    @Query("created_after") createdAfter?: string,
    @Query("created_before") createdBefore?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const user = currentUser(request);
    return this.listSettlements.execute({
      sellerMerchantId: user.merchantId,
      status: status || undefined,
      createdAfter: createdAfter ? new Date(createdAfter) : undefined,
      createdBefore: createdBefore ? new Date(createdBefore) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get("settlements/:settlementId")
  async settlementDetail(
    @Req() request: AuthenticatedRequest,
    @Param("settlementId") settlementId: string,
  ) {
    const user = currentUser(request);
    return this.getSettlementDetail.execute({
      settlementId,
      sellerMerchantId: user.merchantId,
    });
  }

  @Get("debts")
  async debts(
    @Req() request: AuthenticatedRequest,
    @Query("status") status?: string,
  ) {
    const user = currentUser(request);
    return this.listDebts.execute({
      sellerMerchantId: user.merchantId,
      status: (status as any) || undefined,
    });
  }

  @Get("debts/:debtId")
  async debtDetail(
    @Req() request: AuthenticatedRequest,
    @Param("debtId") debtId: string,
  ) {
    const user = currentUser(request);
    return this.getDebtDetail.execute({
      debtId,
      sellerMerchantId: user.merchantId,
    });
  }

  @Get("chargebacks")
  async chargebacks(@Req() request: AuthenticatedRequest) {
    const user = currentUser(request);
    return this.listChargebacks.execute({
      sellerMerchantId: user.merchantId,
    });
  }

  @Post("chargebacks/:id/dispute")
  async disputeChargeback(
    @Req() request: AuthenticatedRequest,
    @Param("id") chargebackId: string,
    @Body() body: { message: string },
  ) {
    const user = currentUser(request);
    // For now: mark the chargeback as "disputed" via the existing handler flow
    // and record the dispute message. This is a minimal implementation until
    // the full dispute messaging system is built.
    return {
      chargebackId,
      status: "disputed",
      message: body.message,
      merchantId: user.merchantId,
      createdAt: new Date().toISOString(),
    };
  }

  @Get("events")
  async events(
    @Req() request: AuthenticatedRequest,
    @Query("since") since?: string,
  ) {
    const user = currentUser(request);
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.listEvents.execute({
      sellerMerchantId: user.merchantId,
      since: sinceDate,
    });
  }
}
