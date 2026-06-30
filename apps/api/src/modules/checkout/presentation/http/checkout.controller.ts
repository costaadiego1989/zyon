import { Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";
import type {
  ApplyOfferRequest,
  ChatMessageRequest,
  CompleteOrderRequest,
  DecisionRequest,
  MerchantRules,
  ShippingEvaluateRequest,
  StartCheckoutRequest,
  TrackEventRequest,
  UpdateCartRequest,
  UpdateOrderTrackingRequest
} from "@zyon/shared-types";
import { ApplyOfferUseCase } from "../../application/use-cases/apply-offer.use-case.js";
import { CompleteOrderUseCase } from "../../application/use-cases/complete-order.use-case.js";
import {
  GetDashboardOverviewUseCase,
  GetMerchantRulesUseCase,
  UpdateMerchantRulesUseCase
} from "../../application/use-cases/dashboard.use-cases.js";
import { EvaluateShippingUseCase } from "../../application/use-cases/evaluate-shipping.use-case.js";
import { GetDecisionUseCase } from "../../application/use-cases/get-decision.use-case.js";
import { GetCheckoutSessionUseCase } from "../../application/use-cases/get-checkout-session.use-case.js";
import { SendChatMessageUseCase } from "../../application/use-cases/send-chat-message.use-case.js";
import { StartCheckoutUseCase } from "../../application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../application/use-cases/track-checkout-event.use-case.js";
import { UpdateOrderTrackingUseCase } from "../../application/use-cases/update-order-tracking.use-case.js";
import { UpdateCartUseCase } from "../../application/use-cases/update-cart.use-case.js";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";

@NonProductionRoute()
@Controller()
export class CheckoutController {
  constructor(
    private readonly startCheckout: StartCheckoutUseCase,
    private readonly trackEvent: TrackCheckoutEventUseCase,
    private readonly getCheckoutSession: GetCheckoutSessionUseCase,
    private readonly getDecision: GetDecisionUseCase,
    private readonly sendChatMessage: SendChatMessageUseCase,
    private readonly evaluateShipping: EvaluateShippingUseCase,
    private readonly applyOffer: ApplyOfferUseCase,
    private readonly completeOrder: CompleteOrderUseCase,
    private readonly getDashboardOverview: GetDashboardOverviewUseCase,
    private readonly getRules: GetMerchantRulesUseCase,
    private readonly updateRules: UpdateMerchantRulesUseCase,
    private readonly updateOrderTracking?: UpdateOrderTrackingUseCase,
    private readonly updateCart?: UpdateCartUseCase
  ) {}

  @Post("start-checkout")
  start(@Body() body: StartCheckoutRequest) {
    return this.startCheckout.execute(body);
  }

  @Post("track-event")
  track(@Body() body: TrackEventRequest) {
    return this.trackEvent.execute(body);
  }

  @Get("checkout/:merchantId/:sessionId")
  session(@Param("merchantId") merchantId: string, @Param("sessionId") sessionId: string) {
    return this.getCheckoutSession.execute(merchantId, sessionId);
  }

  @Post("decision")
  decision(@Body() body: DecisionRequest) {
    return this.getDecision.execute(body);
  }

  @Post("chat/message")
  chat(@Body() body: ChatMessageRequest) {
    return this.sendChatMessage.execute(body);
  }

  @Post("shipping/evaluate")
  shipping(@Body() body: ShippingEvaluateRequest) {
    return this.evaluateShipping.execute(body);
  }

  @Post("offers/apply")
  offer(@Body() body: ApplyOfferRequest) {
    return this.applyOffer.execute(body);
  }

  @Post("orders/complete")
  complete(@Body() body: CompleteOrderRequest) {
    return this.completeOrder.execute(body);
  }

  @Patch("orders/tracking")
  tracking(@Body() body: UpdateOrderTrackingRequest) {
    if (!this.updateOrderTracking) throw new Error("update_order_tracking_not_configured");
    return this.updateOrderTracking.execute(body);
  }

  @Patch("cart")
  cart(@Body() body: UpdateCartRequest) {
    if (!this.updateCart) throw new Error("update_cart_not_configured");
    return this.updateCart.execute(body);
  }

  @Get("dashboard/overview/:merchantId")
  overview(@Param("merchantId") merchantId: string) {
    return this.getDashboardOverview.execute(merchantId);
  }

  @Get("dashboard/rules/:merchantId")
  rules(@Param("merchantId") merchantId: string) {
    return this.getRules.execute(merchantId);
  }

  @Put("dashboard/rules/:merchantId")
  update(@Param("merchantId") merchantId: string, @Body() body: Partial<MerchantRules>) {
    return this.updateRules.execute(merchantId, body);
  }
}
