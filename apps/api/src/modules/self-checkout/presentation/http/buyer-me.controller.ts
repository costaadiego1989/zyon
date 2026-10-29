import { Controller, Get, Post, Delete, Body, Param, UseGuards, Req, HttpCode, Inject } from "@nestjs/common";
import { BuyerAuthGuard, type BuyerJwtPayload } from "../guards/buyer-auth.guard.js";
import { AddSavedAddressUseCase, type AddSavedAddressInput } from "../../application/use-cases/add-saved-address.use-case.js";
import { RemoveSavedAddressUseCase } from "../../application/use-cases/remove-saved-address.use-case.js";
import { AddSavedPaymentMethodUseCase } from "../../application/use-cases/add-saved-payment-method.use-case.js";
import { DeleteSavedPaymentMethodUseCase } from "../../application/use-cases/delete-saved-payment-method.use-case.js";
import { CreateCheckoutTemplateUseCase, type CreateCheckoutTemplateInput } from "../../application/use-cases/create-checkout-template.use-case.js";
import { ExecuteCheckoutTemplateUseCase, type ExecuteCheckoutTemplateInput } from "../../application/use-cases/execute-checkout-template.use-case.js";
import { ListTemplatesForBuyerUseCase } from "../../application/use-cases/list-templates-for-buyer.use-case.js";
import { UpdateConsentUseCase } from "../../application/use-cases/update-consent.use-case.js";
import { BUYER_WALLET_REPOSITORY, type BuyerWalletRepository } from "../../domain/ports/buyer-wallet-repository.port.js";
import {
  PAYMENT_TOKENIZER,
  type PaymentTokenizerPort,
  type TokenizeCardInput,
} from "../../domain/ports/payment-tokenizer.port.js";

interface AuthReq { buyer: BuyerJwtPayload }

/** Raw card body shape — accepted only at the HTTP edge; never forwarded beyond this layer. */
type AddPaymentMethodBody = TokenizeCardInput & { label: string };

@UseGuards(BuyerAuthGuard)
@Controller("me")
export class BuyerMeController {
  constructor(
    private readonly addAddress: AddSavedAddressUseCase,
    private readonly removeAddress: RemoveSavedAddressUseCase,
    private readonly addPaymentMethod: AddSavedPaymentMethodUseCase,
    private readonly deletePaymentMethod: DeleteSavedPaymentMethodUseCase,
    private readonly createTemplate: CreateCheckoutTemplateUseCase,
    private readonly executeTemplate: ExecuteCheckoutTemplateUseCase,
    private readonly listTemplates: ListTemplatesForBuyerUseCase,
    private readonly updateConsent: UpdateConsentUseCase,
    @Inject(BUYER_WALLET_REPOSITORY) private readonly wallets: BuyerWalletRepository,
    // P2 PCI fix: tokenizer injected here so raw card data never enters the use-case layer.
    @Inject(PAYMENT_TOKENIZER) private readonly tokenizer: PaymentTokenizerPort,
  ) {}

  @Get("wallet/addresses")
  async getAddresses(@Req() req: AuthReq) {
    const wallet = await this.wallets.findByBuyerUserId(req.buyer.sub);
    return wallet?.saved_addresses.map((a) => a.snapshot()) ?? [];
  }

  @Post("wallet/addresses")
  addAddr(@Req() req: AuthReq, @Body() body: Omit<AddSavedAddressInput, "buyer_user_id">) {
    return this.addAddress.execute({ ...body, buyer_user_id: req.buyer.sub });
  }

  @Delete("wallet/addresses/:id")
  @HttpCode(204)
  removeAddr(@Req() req: AuthReq, @Param("id") id: string) {
    return this.removeAddress.execute(req.buyer.sub, id);
  }

  @Get("wallet/payment-methods")
  async getPaymentMethods(@Req() req: AuthReq) {
    const wallet = await this.wallets.findByBuyerUserId(req.buyer.sub);
    return wallet?.saved_payment_methods.map((m) => ({ id: m.id, label: m.label, brand: m.brand, last_four: m.last_four, expires_at: m.expires_at })) ?? [];
  }

  /**
   * P2 PCI fix: tokenize raw card at the HTTP edge (here) before passing to the use-case.
   * PAN and CVV are consumed by the tokenizer and never forwarded to application/domain layers.
   */
  @Post("wallet/payment-methods")
  async addMethod(@Req() req: AuthReq, @Body() body: AddPaymentMethodBody) {
    const token = await this.tokenizer.tokenize({
      card_number: body.card_number,
      expiry_month: body.expiry_month,
      expiry_year: body.expiry_year,
      cvv: body.cvv,
      holder_name: body.holder_name,
    });
    return this.addPaymentMethod.execute({ buyer_user_id: req.buyer.sub, label: body.label, token });
  }

  @Delete("wallet/payment-methods/:id")
  @HttpCode(204)
  deleteMethod(@Req() req: AuthReq, @Param("id") id: string) {
    return this.deletePaymentMethod.execute(req.buyer.sub, id);
  }

  @Get("templates")
  getTemplates(@Req() req: AuthReq) {
    return this.listTemplates.execute(req.buyer.sub);
  }

  @Post("templates")
  createTmpl(@Req() req: AuthReq, @Body() body: Omit<CreateCheckoutTemplateInput, "buyer_user_id">) {
    return this.createTemplate.execute({ ...body, buyer_user_id: req.buyer.sub });
  }

  @Post("templates/:id/execute")
  executeTmpl(
    @Req() req: AuthReq,
    @Param("id") id: string,
    @Body() body: Omit<ExecuteCheckoutTemplateInput, "template_id" | "buyer_user_id">
  ) {
    return this.executeTemplate.execute({ ...body, template_id: id, buyer_user_id: req.buyer.sub });
  }

  @Post("consent")
  consent(@Req() req: AuthReq, @Body() body: { consent_version: string; marketing_opt_in: boolean }) {
    return this.updateConsent.execute({ buyer_user_id: req.buyer.sub, ...body });
  }
}
