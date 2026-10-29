import { Module } from "@nestjs/common";
import { PaymentModule } from "../../payment/payment.module.js";
import { CheckoutModule } from "../../checkout/checkout.module.js";
import { MerchantModule } from "../../merchant/merchant.module.js";
import { AgenticProtocolModule } from "../agentic-protocol/agentic-protocol.module.js";
import { AcpMandateIssuerService } from "./acp-mandate-issuer.service.js";
import { AcpMandatesController } from "./acp-mandates.controller.js";

/**
 * AP2 (Agent Payments Protocol) mandate issuer module.
 *
 * Public endpoints only — no auth guard wired in. The signing keys live in an
 * in-memory `Map<merchantId, KeyObject>` (per-merchant ECDSA P-256 keypairs),
 * regenerated on every process start; mandates are short-lived SD-JWTs issued
 * on demand by the public API.
 */
@Module({
  imports: [PaymentModule, CheckoutModule, MerchantModule, AgenticProtocolModule],
  controllers: [AcpMandatesController],
  providers: [AcpMandateIssuerService],
  exports: [AcpMandateIssuerService],
})
export class AcpMandatesModule {}
